#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""英语机考模拟器 —— macOS 启动器（Python 3 标准库，无第三方依赖）

职责与 Windows 版 Launcher.cs 对齐：
  · 在 127.0.0.1 上提供静态网页（网页应用/ 目录，直接读磁盘，不嵌入二进制）
  · 提供 /api/* 数据接口（题库、成绩、写作答卷、学习数据、媒体、精读、精听、题包原件）
  · 自动打开默认浏览器、单实例、数据目录初始化、原子写、路径安全校验
  · 数据目录与 Windows 版完全一致，整个文件夹可以在 Windows/macOS 之间拷贝

用法：
  python3 launcher.py [--port=17301] [--no-open] [--quiet]
"""

import argparse
import getpass
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

APP_NAME = "英语机考模拟器"
DEFAULT_PORT = 17301
MAX_BODY = 512 * 1024 * 1024

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_ROOT = os.path.join(BASE_DIR, "网页应用")
MARKER_HEADER = "X-CBT-Simulator"
MARKER_PREFIX = "3; id="
INSTANCE_ID = hashlib.sha1(
    ("%s@%s" % (getpass.getuser() or "user", socket.gethostname())).encode("utf-8")
).hexdigest()[:12]

DATA_ROOT = BASE_DIR
STORE_READY = False
LOG_PATH = os.path.join(BASE_DIR, "启动日志.txt")
PORT_FILE = os.path.join(tempfile.gettempdir(), "ielts-cbt-simulator-mac.port")
QUIET = False
LOG_LOCK = threading.Lock()

MIME = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".pdf": "application/pdf",
}

SEG_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
MIME_RE = re.compile(r"^[A-Za-z0-9/.+_;= -]{1,100}$")


# ---------------------------------------------------------------- 日志

def pick_log_path():
    for root in (BASE_DIR, tempfile.gettempdir()):
        try:
            path = os.path.join(root, "启动日志.txt")
            with open(path, "a", encoding="utf-8"):
                pass
            return path
        except OSError:
            continue
    return None


def log(message):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + message
    with LOG_LOCK:
        if not QUIET:
            try:
                print(line, flush=True)
            except Exception:
                pass
        if LOG_PATH:
            try:
                with open(LOG_PATH, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
            except OSError:
                pass


# ---------------------------------------------------------------- 数据目录

def _data(*parts):
    return os.path.join(DATA_ROOT, *parts)


def tests_path():
    return _data("导入题目", "数据", "tests.json")


def history_path():
    return _data("做题记录", "records.json")


def writing_root():
    return _data("做题记录", "写作")


def learning_path():
    return _data("做题记录", "学习数据.json")


def media_root():
    return _data("导入题目", "媒体")


def pack_root():
    return _data("导入题目", "题包")


def notes_root():
    return _data("精读记录")


def wordbook_path():
    return _data("精读记录", "词汇句子册.json")


def lnotes_root():
    return _data("精听记录")


def lwords_path():
    return _data("精听记录", "生词本.json")


def init_store():
    """在程序目录创建数据文件夹；不可写时退回临时目录；仍失败则 API 返回 503。"""
    global DATA_ROOT, STORE_READY
    candidates = [BASE_DIR, os.path.join(tempfile.gettempdir(), "CBT模拟器_数据")]
    for root in candidates:
        try:
            for rel in (
                ("导入题目", "数据"),
                ("导入题目", "媒体"),
                ("导入题目", "题包"),
                ("做题记录",),
                ("做题记录", "写作"),
                ("精读记录",),
                ("精听记录",),
            ):
                os.makedirs(os.path.join(root, *rel), exist_ok=True)
            probe = os.path.join(root, "导入题目", "数据", ".probe")
            with open(probe, "w", encoding="utf-8") as f:
                f.write("")
            os.remove(probe)
            DATA_ROOT = root
            STORE_READY = True
            log("本地数据目录: " + root)
            return
        except OSError as exc:
            log("数据目录不可用: %s（%s）" % (root, exc))
    STORE_READY = False
    log("× 没有可写的本地数据目录：题库与记录只保存在浏览器里")


# ---------------------------------------------------------------- 通用工具

def atomic_write(path, data):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        try:
            os.fsync(f.fileno())
        except OSError:
            pass
    os.replace(tmp, path)


def read_json_file(path, default):
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def json_bytes(obj):
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


def safe_seg(value):
    return bool(value) and value not in (".", "..") and bool(SEG_RE.match(value))


def safe_file_name(name):
    if not name:
        return None
    name = name.replace("/", "_").replace("\\", "_").strip()
    for ch in '<>:"|?*' + "".join(chr(i) for i in range(32)):
        name = name.replace(ch, "_")
    if not name or name in (".", ".."):
        return None
    if len(name) > 120:
        name = name[-120:]
    return name


def safe_mime(value):
    if not value or len(value) > 100:
        return None
    return value if MIME_RE.match(value) else None


def cleanup_media(raw_tests):
    try:
        items = json.loads(raw_tests.decode("utf-8-sig"))
        if not isinstance(items, list):
            return
        alive = set()
        for item in items:
            if isinstance(item, dict) and isinstance(item.get("id"), str) and safe_seg(item["id"]):
                alive.add(item["id"])
        root = media_root()
        if not os.path.isdir(root):
            return
        for name in os.listdir(root):
            if name == "_selftest":
                continue
            if name not in alive:
                target = os.path.join(root, name)
                if os.path.isdir(target):
                    shutil.rmtree(target, ignore_errors=True)
                    log("清理已删题包的媒体目录: " + name)
    except Exception as exc:  # 清理失败不影响主流程
        log("清理媒体目录失败: " + str(exc))


def list_keys(root):
    keys = []
    if os.path.isdir(root):
        for name in os.listdir(root):
            if not name.lower().endswith(".json"):
                continue
            key = name[:-5]
            if safe_seg(key):
                keys.append(key)
    keys.sort(key=str.lower)
    return keys


def read_body(handler):
    raw_len = handler.headers.get("Content-Length")
    if raw_len is None:
        return b""
    try:
        length = int(raw_len)
    except ValueError:
        return None
    if length < 0 or length > MAX_BODY:
        return None
    chunks = []
    left = length
    while left > 0:
        chunk = handler.rfile.read(min(262144, left))
        if not chunk:
            break
        chunks.append(chunk)
        left -= len(chunk)
    return b"".join(chunks)


# ---------------------------------------------------------------- HTTP handler

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "CBTSimulator/3"
    sys_version = ""

    # 统一由 _send 记录，避免默认的 stderr 日志
    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        self._dispatch(head_only=False)

    def do_HEAD(self):
        self._dispatch(head_only=True)

    def do_PUT(self):
        self._dispatch(head_only=False)

    def do_POST(self):
        self._dispatch(head_only=False)

    def do_DELETE(self):
        self._dispatch(head_only=False)

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain; charset=utf-8")

    # ---- 基础响应 ----
    def _send(self, status, body, content_type, api=False, head_only=False):
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body) if body is not None else 0))
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header(MARKER_HEADER, MARKER_PREFIX + INSTANCE_ID)
            if api:
                self.send_header("X-CBT-Store", "1")
            self.send_header("Connection", "close")
            self.end_headers()
            if body and not head_only:
                self.wfile.write(body)
            self.close_connection = True
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            log("%s %s → %s" % (self.command, self.path, status))

    def _json(self, obj, status=200, head_only=False):
        self._send(status, json_bytes(obj), "application/json; charset=utf-8", api=True, head_only=head_only)

    def _json_err(self, status, message):
        self._json({"ok": False, "error": message}, status)

    def _host_ok(self):
        host = self.headers.get("Host", "")
        if not host:
            return False
        if host.startswith("["):
            end = host.find("]")
            hostname = host[1:end] if end > 0 else host
        else:
            hostname = host.rsplit(":", 1)[0] if ":" in host else host
        return hostname.strip().lower().rstrip(".") in ("127.0.0.1", "localhost", "::1")

    # ---- 路由 ----
    def _dispatch(self, head_only):
        if not self._host_ok():
            self._send(403, b"", "text/plain; charset=utf-8", head_only=head_only)
            return
        raw_path = urlsplit(self.path).path
        path = unquote(raw_path)
        if "\x00" in path:
            self._send(404, b"", "text/plain; charset=utf-8", head_only=head_only)
            return
        if path.startswith("/api/"):
            method = "GET" if head_only else self.command
            if method not in ("GET", "PUT", "POST", "DELETE", "HEAD"):
                self._json_err(405, "不支持的方法")
                return
            body = b""
            if method in ("PUT", "POST"):
                body = read_body(self)
                if body is None:
                    self._json_err(413, "请求体过大或长度不合法")
                    return
            self._api(path, method, body, head_only)
            return
        if self.command not in ("GET", "HEAD"):
            self._send(405, b"", "text/plain; charset=utf-8", head_only=head_only)
            return
        self._static(path, head_only)

    def _static(self, path, head_only):
        rel = path.lstrip("/")
        ext = os.path.splitext(os.path.basename(rel))[1].lower()
        if rel == "" or not ext:
            rel = "index.html"
            ext = ".html"
        root = os.path.realpath(WEB_ROOT)
        full = os.path.realpath(os.path.join(root, rel.replace("/", os.sep)))
        if not (full == root or full.startswith(root + os.sep)):
            self._send(403, b"", "text/plain; charset=utf-8", head_only=head_only)
            return
        if not os.path.isfile(full):
            self._send(404, b"", "text/plain; charset=utf-8", head_only=head_only)
            return
        try:
            with open(full, "rb") as f:
                data = f.read()
        except OSError:
            self._send(404, b"", "text/plain; charset=utf-8", head_only=head_only)
            return
        self._send(200, data, MIME.get(ext, "application/octet-stream"), head_only=head_only)

    # ---- API ----
    def _api(self, path, method, body, head_only):
        if not STORE_READY:
            self._json_err(503, "本地数据目录不可写，题库与记录只保存在浏览器里")
            return

        # 题库 / 成绩 / 学习数据
        if path == "/api/store/ping" and method == "GET":
            self._json({"ok": True, "version": 1, "dir": DATA_ROOT}, head_only=head_only)
            return
        if path == "/api/store/tests" and method == "GET":
            self._json_or_empty(tests_path(), [], head_only)
            return
        if path == "/api/store/tests" and method == "PUT":
            data = body.lstrip(b"\xef\xbb\xbf")
            if not data.startswith(b"["):
                self._json_err(400, "题库数据必须是 JSON 数组")
                return
            atomic_write(tests_path(), body)
            cleanup_media(body)
            self._json({"ok": True}, head_only=head_only)
            return
        if path == "/api/store/history" and method == "GET":
            self._json_or_empty(history_path(), [], head_only)
            return
        if path == "/api/store/history" and method == "PUT":
            data = body.lstrip(b"\xef\xbb\xbf")
            if not data.startswith(b"["):
                self._json_err(400, "练习记录必须是 JSON 数组")
                return
            atomic_write(history_path(), body)
            self._json({"ok": True}, head_only=head_only)
            return
        if path == "/api/store/learning" and method == "GET":
            default = {"version": 1, "reviewItems": [], "vocabularyProgress": [],
                       "processedRecordIds": [], "updatedAt": 0}
            self._json_or_empty(learning_path(), default, head_only)
            return
        if path == "/api/store/learning" and method == "PUT":
            if not valid_learning(body):
                self._json_err(400, "学习数据必须是 version=1 的 JSON 对象")
                return
            atomic_write(learning_path(), body)
            self._json({"ok": True}, head_only=head_only)
            return

        # 写作答卷
        if path == "/api/writing" and method == "GET":
            self._json(list_keys(writing_root()), head_only=head_only)
            return
        if path.startswith("/api/writing/"):
            record_id = path[len("/api/writing/"):]
            if not safe_seg(record_id):
                self._json_err(400, "写作答卷 recordId 不合法")
                return
            target = os.path.join(writing_root(), record_id + ".json")
            if method == "GET":
                self._send_file(target, "application/json; charset=utf-8", head_only)
                return
            if method == "PUT":
                data = body.lstrip(b"\xef\xbb\xbf")
                if not data.startswith(b"{"):
                    self._json_err(400, "写作答卷必须是 JSON 对象")
                    return
                atomic_write(target, body)
                self._json({"ok": True}, head_only=head_only)
                return
            if method == "DELETE":
                if os.path.isfile(target):
                    os.remove(target)
                self._json({"ok": True}, head_only=head_only)
                return

        # 媒体
        if path.startswith("/api/media/"):
            self._media(path, method, body, head_only)
            return

        # 题包原件
        if path.startswith("/api/pack/") and method == "PUT":
            name = safe_file_name(path[len("/api/pack/"):])
            if name is None:
                self._json_err(400, "文件名不合法")
                return
            atomic_write(os.path.join(pack_root(), name), body)
            self._json({"ok": True, "name": name}, head_only=head_only)
            return

        # 精读词汇册 / 精听生词本
        if path == "/api/wordbook" and method == "GET":
            self._json_or_empty(wordbook_path(), [], head_only)
            return
        if path == "/api/wordbook" and method == "PUT":
            if not body.lstrip(b"\xef\xbb\xbf").startswith(b"["):
                self._json_err(400, "词汇句子册必须是 JSON 数组")
                return
            atomic_write(wordbook_path(), body)
            self._json({"ok": True}, head_only=head_only)
            return
        if path == "/api/lwords" and method == "GET":
            self._json_or_empty(lwords_path(), [], head_only)
            return
        if path == "/api/lwords" and method == "PUT":
            if not body.lstrip(b"\xef\xbb\xbf").startswith(b"["):
                self._json_err(400, "听力生词本必须是 JSON 数组")
                return
            atomic_write(lwords_path(), body)
            self._json({"ok": True}, head_only=head_only)
            return

        # 精读 / 精听文件
        if path == "/api/notes" and method == "GET":
            self._json(list_keys(notes_root()), head_only=head_only)
            return
        if path.startswith("/api/notes/"):
            self._item_file(path, "/api/notes/", notes_root(), "精读文件", method, body, head_only)
            return
        if path == "/api/lnotes" and method == "GET":
            self._json(list_keys(lnotes_root()), head_only=head_only)
            return
        if path.startswith("/api/lnotes/"):
            self._item_file(path, "/api/lnotes/", lnotes_root(), "精听文件", method, body, head_only)
            return

        self._json_err(404, "未知接口")

    def _media(self, path, method, body, head_only):
        rest = path[len("/api/media/"):]
        segs = rest.split("/")
        if method == "PUT" and len(segs) == 2 and safe_seg(segs[0]) and safe_seg(segs[1]):
            folder = os.path.join(media_root(), segs[0])
            os.makedirs(folder, exist_ok=True)
            target = os.path.join(folder, segs[1])
            atomic_write(target, body)
            mime = safe_mime(self.headers.get("X-Mime-Type", ""))
            if mime:
                with open(target + ".mime", "w", encoding="ascii") as f:
                    f.write(mime)
            self._json({"ok": True}, head_only=head_only)
            return
        if method == "GET" and len(segs) == 2 and safe_seg(segs[0]) and safe_seg(segs[1]):
            target = os.path.join(media_root(), segs[0], segs[1])
            if not os.path.isfile(target):
                self._json_err(404, "媒体不存在")
                return
            ctype = "application/octet-stream"
            try:
                with open(target + ".mime", "r", encoding="ascii") as f:
                    ctype = f.read().strip() or ctype
            except OSError:
                pass
            self._send_file(target, ctype, head_only)
            return
        if method == "DELETE" and len(segs) == 1 and safe_seg(segs[0]):
            folder = os.path.join(media_root(), segs[0])
            if os.path.isdir(folder):
                shutil.rmtree(folder, ignore_errors=True)
            self._json({"ok": True}, head_only=head_only)
            return
        self._json_err(400, "媒体路径不合法")

    def _item_file(self, path, prefix, root, label, method, body, head_only):
        key = path[len(prefix):]
        if "/" in key or not safe_seg(key):
            self._json_err(400, label + " key 不合法")
            return
        target = os.path.join(root, key + ".json")
        if method == "GET":
            if not os.path.isfile(target):
                self._json_err(404, label + "不存在")
                return
            self._send_file(target, "application/json; charset=utf-8", head_only)
            return
        if method == "PUT":
            data = body.lstrip(b"\xef\xbb\xbf")
            if not data.startswith(b"{"):
                self._json_err(400, label + "必须是 JSON 对象")
                return
            atomic_write(target, body)
            self._json({"ok": True}, head_only=head_only)
            return
        if method == "DELETE":
            if os.path.isfile(target):
                os.remove(target)
            self._json({"ok": True}, head_only=head_only)
            return
        self._json_err(405, "不支持的方法")

    def _json_or_empty(self, path, default, head_only):
        if os.path.isfile(path):
            try:
                with open(path, "rb") as f:
                    data = f.read()
                if data.strip():
                    self._send(200, data, "application/json; charset=utf-8", api=True, head_only=head_only)
                    return
            except OSError:
                pass
        self._json(default, head_only=head_only)

    def _send_file(self, path, content_type, head_only):
        try:
            with open(path, "rb") as f:
                data = f.read()
            self._send(200, data, content_type, api=True, head_only=head_only)
        except OSError:
            self._json_err(404, "文件不存在")


def valid_learning(body):
    try:
        obj = json.loads(body.decode("utf-8-sig"))
        if not isinstance(obj, dict) or obj.get("version") != 1:
            return False
        for key in ("reviewItems", "vocabularyProgress", "processedRecordIds"):
            if key in obj and not isinstance(obj[key], list):
                return False
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- 启动

def read_port_file():
    try:
        with open(PORT_FILE, "r", encoding="ascii") as f:
            port = int(f.read().strip())
        return port if 1 <= port <= 65535 else None
    except Exception:
        return None


def write_port_file(port):
    try:
        with open(PORT_FILE, "w", encoding="ascii") as f:
            f.write(str(port))
    except OSError:
        pass


def clear_port_file(port):
    if read_port_file() == port:
        try:
            os.remove(PORT_FILE)
        except OSError:
            pass


def existing_instance(extra_port=None):
    ports = []
    saved = read_port_file()
    if saved:
        ports.append(saved)
    if extra_port and extra_port not in ports:
        ports.append(extra_port)
    for port in range(17301, 17321):
        if port not in ports:
            ports.append(port)
    for port in ports:
        try:
            conn = HTTPConnection("127.0.0.1", port, timeout=0.15)
            conn.request("HEAD", "/", headers={"Host": "127.0.0.1:%d" % port})
            resp = conn.getresponse()
            marker = resp.getheader(MARKER_HEADER, "")
            conn.close()
            if marker.startswith(MARKER_PREFIX) and marker.split("id=", 1)[-1].strip() == INSTANCE_ID:
                return port
        except Exception:
            continue
    return None


def bind_server(extra_port=None):
    ports = []
    if extra_port:
        ports.append(extra_port)
    for start in (17301, 27301, 37301):
        ports.extend(range(start, start + 20))
    for port in ports:
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            httpd.daemon_threads = True
            return httpd, port
        except OSError:
            continue
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    httpd.daemon_threads = True
    return httpd, httpd.server_address[1]


def open_browser(url):
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", url])
        elif os.name == "nt":
            os.startfile(url)  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", url])
        return True
    except Exception as exc:
        log("打开浏览器失败: %s" % exc)
        return False


def main():
    global QUIET, LOG_PATH
    # Windows 控制台可能是 GBK/cp1252；macOS 是 UTF-8。统一成 UTF-8，避免中文 print 崩溃。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass
    parser = argparse.ArgumentParser(description=APP_NAME + " macOS 启动器")
    parser.add_argument("--port", type=int, default=0, help="首选端口（默认从 17301 开始顺延）")
    parser.add_argument("--no-open", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--quiet", action="store_true", help="不在终端打印每条请求")
    args = parser.parse_args()

    QUIET = args.quiet
    LOG_PATH = pick_log_path()

    if not os.path.isdir(WEB_ROOT) or not os.path.isfile(os.path.join(WEB_ROOT, "index.html")):
        print("找不到网页应用目录：%s" % WEB_ROOT, file=sys.stderr)
        print("请确认压缩包完整（网页应用/index.html 存在）。", file=sys.stderr)
        return 1

    log("%s 正在启动…" % APP_NAME)
    init_store()

    port = existing_instance(args.port or None)
    if port:
        url = "http://127.0.0.1:%d/" % port
        log("已有实例在运行，直接打开页面: " + url)
        print("已有实例在运行：" + url)
        if not args.no_open:
            open_browser(url)
        return 0

    httpd, port = bind_server(args.port or None)
    write_port_file(port)
    url = "http://127.0.0.1:%d/" % port
    log("已监听 %s，数据目录: %s" % (url, DATA_ROOT))
    print("")
    print("  %s 已启动" % APP_NAME)
    print("  地址: " + url)
    print("  数据: " + DATA_ROOT)
    print("  关闭此窗口即退出程序")
    print("")

    if not args.no_open:
        if not open_browser(url):
            print("没能自动打开浏览器，请手动访问上面的地址。")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("收到中断，退出")
    finally:
        httpd.server_close()
        clear_port_file(port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
