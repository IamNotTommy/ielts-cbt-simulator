# 英语机考模拟器 —— Mac 版本开发说明

> 本文写给负责做 Mac 版本的开发者（或 AI）。
> 读完本文你应该能完整理解现有 Windows 版的架构，并据此实现一个功能对等的 macOS 版本。

---

## 一、这个项目是什么

一个雅思英语机考模拟器（听力/阅读/写作练习 + 精读、精听功能），面向普通用户，
**离线运行、免安装**：用户拿到一个文件夹，双击启动器，浏览器自动打开练习页面，
导入 `.zip` 题包后即可做题。题库、音频、成绩、笔记都保存在程序所在文件夹里。

## 二、整体架构（两层，只有一层需要移植）

```
┌─────────────────────────────────────────────┐
│  浏览器（Safari / Chrome / Edge 任意一个）      │
│  └── 网页应用（React SPA，源码/dist 构建产物）   │  ← 跨平台，Mac 版【完全不用改】
├─────────────────────────────────────────────┤
│  127.0.0.1:17301 本机 HTTP 服务               │
│  └── 启动器（Windows 版是 C# 单文件 exe）       │  ← Mac 版【只需要重写这个】
└─────────────────────────────────────────────┘
```

**关键点：前端网页应用与平台完全无关。** 它就是一套静态文件（HTML/JS/CSS），
在浏览器里跑，所有"本地能力"（读题库、存成绩、存音频）都通过 `fetch` 调用
**同源的 `/api/*` HTTP 接口**获得。所以 Mac 版的工作只有一件事：

> **写一个 macOS 上运行的启动器，提供与现有 Windows 启动器完全一致的 HTTP 服务和 API 接口。**

只要接口行为一致，前端一行代码都不用动，功能（包括文件夹数据同步）全部可用。

## 三、启动器要做什么（职责清单）

现有 Windows 启动器源码：`启动器源码/Launcher.cs`（约 2400 行 C#，其中一大半是
Windows 特有的 GUI 窗口和打开浏览器的代码，Mac 版不用照抄）。核心职责是：

1. **在 127.0.0.1 上起一个 HTTP 服务**，默认端口 17301，被占就顺延尝试
   （17301–17320 → 27301–27310 → 37301–37310 → 系统分配端口 0）。
2. **提供网页应用的静态文件**。Windows 版把整个 `dist` 目录嵌进 exe 里；
   Mac 版可以直接从磁盘目录读（更简单），见下文第六节。
3. **实现 `/api/*` 数据接口**（契约见第四节）——这是功能对等的核心。
4. **自动打开浏览器**访问 `http://127.0.0.1:<port>/`。macOS 上一行命令搞定：
   `open http://127.0.0.1:17301/`（`open` 是 macOS 自带命令，会用默认浏览器打开）。
5. **单实例**：重复启动时不要起第二个服务。简单做法：尝试监听默认端口前先
   探测该端口是否已是本程序（见 4.6 的标记头），是的话直接复用并打开浏览器即可。
6. **数据目录初始化**：启动时在程序所在目录创建数据文件夹（见第五节）；
   若不可写（比如放在 /Applications 里权限不够），退回
   `$TMPDIR/CBT模拟器_数据`，此时 `/api/*` 返回 503，前端自动降级为纯浏览器存储。
7. **日志**：把启动信息和异常写入程序目录下的 `启动日志.txt`（写不了就写临时目录）。

## 四、HTTP 契约（必须逐条实现）

### 4.1 静态文件服务

- `GET /` 和任何**不带扩展名**的路径 → 返回 `index.html`（单页应用路由 fallback）。
- `GET /<带扩展名的文件>` → 返回对应文件；文件不存在时返回 **404**（不要回 index.html，
  否则浏览器会报 MIME 错误）。
- `HEAD` 请求返回与 GET 相同的头部但不带 body。
- 响应头必须包含：
  - `Content-Type`（按扩展名映射，见下表）
  - `Cache-Control: no-store, no-cache, must-revalidate`（前端经常更新，禁止缓存）
  - `X-Content-Type-Options: nosniff`
  - `X-CBT-Simulator: 3; id=<实例标识>`（单实例探测用，见 4.6）
- **Host 校验**：只接受 Host 为 `127.0.0.1` / `localhost` / `[::1]` 的请求，
  其余返回 403（防 DNS 重绑定攻击，因为服务暴露着文件读写接口）。
- URL 需要 percent-decode；路径要防目录穿越（`..` 一律拒绝）。

MIME 映射（前端用到的）：

| 扩展名 | Content-Type |
|---|---|
| .html | text/html; charset=utf-8 |
| .js / .mjs | application/javascript; charset=utf-8 |
| .css | text/css; charset=utf-8 |
| .json / .map | application/json; charset=utf-8 |
| .wasm | application/wasm |
| .svg / .png / .jpg / .jpeg / .gif / .webp / .ico | image/svg+xml, image/png, image/jpeg, image/gif, image/webp, image/x-icon |
| .woff / .woff2 / .ttf | font/woff, font/woff2, font/ttf |
| .mp3 / .m4a / .wav | audio/mpeg, audio/mp4, audio/wav |
| 其他 | application/octet-stream |

### 4.2 通用规则（所有 /api/* 接口）

- 所有 `/api/*` 响应都要带 **`X-CBT-Store: 1`** 响应头。
  前端用 `GET /api/store/ping` + 检查这个头来判断"文件夹同步功能是否可用"
  （见 `源码/src/lib/serverSync.ts` 的 `serverAvailable()`）。**少了这个头，
  前端会认为没有本地服务，数据只存浏览器**。
- 请求体支持 PUT/POST，最大 512 MB（题包 zip 可能上百 MB）。读请求体必须按
  `Content-Length` 字节级读取（二进制内容，不能按文本解码）。
- 前端上传二进制媒体时用自定义请求头 **`X-Mime-Type`** 传 MIME 类型，
  服务端要把它存成旁注文件（见 4.4）。
- 所有 JSON 写入要先写 `.tmp` 再改名（原子写），防止中途被杀留下半个文件。
- 数据目录不可写时，所有 `/api/*` 返回 **503**，body 为 `{"ok":false,"error":"..."}`。
- 路径段安全校验（防目录穿越）：题包 id、媒体文件名、笔记 key 只允许
  `[A-Za-z0-9._-]`，长度 ≤ 80，不允许 `.` / `..` / `/` / `\`。

### 4.3 题库与成绩

数据根目录记为 `DATA_ROOT`（程序所在目录，见第五节）。

| 方法与路径 | 行为 |
|---|---|
| `GET /api/store/ping` | 返回 `{"ok":true,"version":1,"dir":"<DATA_ROOT>"}` |
| `GET /api/store/tests` | 返回 `DATA_ROOT/导入题目/数据/tests.json` 原文；文件不存在返回 `[]` |
| `PUT /api/store/tests` | body 是题库整量 JSON（必须以 `[` 开头，否则 400）；原子写入 tests.json；**然后清理媒体目录**：`导入题目/媒体/` 下凡是不在新题库 id 列表里的题包目录整个删掉（`_selftest` 除外） |
| `GET /api/store/history` | 返回 `DATA_ROOT/做题记录/records.json`；不存在返回 `[]` |
| `PUT /api/store/history` | 同上规则，原子写入 records.json |

### 4.4 媒体文件（听力音频、题图）

key 形如 `<题包id>/<文件名>`（两段路径，各自过安全校验）：

| 方法与路径 | 行为 |
|---|---|
| `PUT /api/media/<testId>/<name>` | body 二进制写入 `导入题目/媒体/<testId>/<name>`；若请求带 `X-Mime-Type` 头，把其值写入同名 `<name>.mime` 旁注文件（只保留 `[A-Za-z0-9/.+_-;= ]` 字符，防头注入） |
| `GET /api/media/<testId>/<name>` | 返回文件内容，Content-Type 取 `.mime` 旁注文件（没有则 application/octet-stream）；不存在返回 404 |
| `DELETE /api/media/<testId>` | 删除整个 `导入题目/媒体/<testId>/` 目录 |

### 4.5 题包原件、精读、精听

| 方法与路径 | 行为 |
|---|---|
| `PUT /api/pack/<文件名>` | 把导入的题包 zip 原件存到 `导入题目/题包/<文件名>`。文件名清洗：去路径、非法字符换成 `_`、长度超 120 截尾；**允许中文和空格**。返回 `{"ok":true,"name":"<清洗后的名字>"}` |
| `GET /api/wordbook` / `PUT` | 读写 `精读记录/词汇句子册.json`（JSON 数组，PUT 校验 `[` 开头） |
| `GET /api/notes` | 列出 `精读记录/` 下所有 `.json` 文件的 key（去扩展名、过安全校验、排序），返回 JSON 字符串数组 |
| `GET/PUT/DELETE /api/notes/<key>` | 读写删 `精读记录/<key>.json`（PUT 要求 `{` 开头的 JSON 对象；GET 不存在返回 404） |
| `GET /api/lwords` / `PUT` | 读写 `精听记录/生词本.json`（同上，JSON 数组） |
| `GET /api/lnotes` | 列出 `精听记录/` 下所有 `.json` 的 key |
| `GET/PUT/DELETE /api/lnotes/<key>` | 读写删 `精听记录/<key>.json`（规则同 /api/notes） |

未知 `/api/*` 路径返回 404，body `{"ok":false,"error":"未知接口"}`。

### 4.6 实例标记头

每个响应都带 `X-CBT-Simulator: 3; id=<实例标识>`。实例标识用来区分"端口被本程序
占着"还是"被别的程序占着"——第二次启动时向 17301 发 `HEAD /`，读到这个头且 id
匹配就说明已有实例在跑，直接打开浏览器复用它。Mac 版可以简化：标识直接用
用户名哈希即可，不必像 Windows 版那样区分多会话。

## 五、数据目录布局（与 Windows 版完全一致，文件夹名字不要改）

```
<程序所在目录>/
├── 导入题目/
│   ├── 数据/tests.json        ← PUT /api/store/tests 写入
│   ├── 媒体/<题包id>/<文件>    ← PUT /api/media/... 写入（+ .mime 旁注）
│   └── 题包/<文件名>.zip       ← PUT /api/pack/... 写入
├── 做题记录/records.json       ← PUT /api/store/history 写入
├── 精读记录/
│   ├── <key>.json             ← /api/notes/*
│   └── 词汇句子册.json          ← /api/wordbook
├── 精听记录/
│   ├── <key>.json             ← /api/lnotes/*
│   └── 生词本.json             ← /api/lwords
└── 启动日志.txt
```

启动时创建这些目录并做一次"写入探测"（写个临时文件再删掉），失败则换
`$TMPDIR/CBT模拟器_数据`，再失败则 `storeReady=false`，所有 `/api/*` 返回 503。

**注意**：用户可能把整个文件夹拷到 Windows 机器上继续用（或反过来），所以文件名、
JSON 格式必须跨平台一致。JSON 一律 UTF-8 无 BOM。

## 六、Mac 版实现建议

### 推荐方案：Python 3 脚本 + .command / .app 包装

macOS 自带 Python 3（`/usr/bin/python3`，Catalina 及以后都有；稳妥起见可以检测，
没有就提示用户安装 Xcode 命令行工具）。Python 标准库的 `http.server` /
`socketserver` 完全够用，不需要任何第三方依赖。

结构建议：

```
英语机考模拟器-Mac/
├── 启动模拟器.command        ← 双击入口：#!/bin/bash + exec python3 launcher.py
├── launcher.py               ← HTTP 服务 + API + open 浏览器 + 单实例 + 数据目录
├── 网页应用/                  ← 源码/dist 的整个内容（index.html + assets/...）
└── （运行后生成上面第五节的 5 个数据文件夹）
```

- `.command` 文件双击会在 Terminal 里运行，用户能看到状态和日志，退出即关窗。
  需要 `chmod +x`。
- 想更"像 Mac 应用"，可以用 Automator 或手写 Info.plist 把它包成 `.app`，
  但第一版用 `.command` 足够。
- **不要**把网页文件嵌进二进制：直接读旁边的 `网页应用/` 目录即可。这也对应
  Windows 版的"备用启动.ps1"模式（直接读 `源码/dist`），已被验证可行。

### 网页文件从哪来

本发布包里的 `源码/dist/` 就是构建好的前端，直接整个复制过来用。
如需重新构建：`源码/` 下 `pnpm install && pnpm build`（需要 Node 20+）。

### 前端联调自查清单

1. `curl -i http://127.0.0.1:17301/api/store/ping` → 200 且响应头有 `X-CBT-Store: 1`。
2. 浏览器打开页面 → 首页正常渲染（说明静态服务 + SPA fallback 正常）。
3. 导入一个题包 zip → 程序目录应出现 `导入题目/题包/<名字>.zip`、`媒体/` 和
   `数据/tests.json`（说明 PUT body 二进制读取、X-Mime-Type 旁注都对）。
4. 做一次练习交卷 → `做题记录/records.json` 被更新。
5. 清掉浏览器数据再打开 → 题库和成绩自动从文件夹恢复（说明 GET 恢复链路通）。
6. 双击第二次启动 → 不起第二个服务，直接打开已有实例的页面。

### Mac 特有的坑

- **Gatekeeper / 隔离属性**：从网盘/微信下载的文件会被打上
  `com.apple.quarantine` 扩展属性，相当于 Windows 的"来自 Internet"标记。
  `.command` / 未签名 `.app` 双击可能被拦。给用户的一行解决办法：
  `xattr -dr com.apple.quarantine <文件夹>`（相当于 Windows 版的"解除锁定.bat"）。
- **端口 17301**：Mac 上没有 Windows 那种 Hyper-V 保留段问题，顺延逻辑可以简化，
  被占了就 +1 重试即可。
- **路径**：一律用 `/`；中文文件夹名在 macOS 上没问题，但注意 macOS 的 Unicode
   normalization（NFD）——比较文件名时用 `unicodedata.normalize('NFC', s)` 归一化。
- **打开浏览器**：`subprocess.run(["open", url])` 即可，不需要 Windows 版那套
  六种方式轮换的复杂逻辑；`open` 失败再提示用户手动复制地址。
- **SIP / 权限**：程序目录若在 `~/Downloads` 等位置没有问题；若用户把文件夹放进
  `/Applications` 需要写权限，此时数据目录回退到 `$TMPDIR` 的逻辑会兜住。
- **不要监听 0.0.0.0**：只绑 `127.0.0.1`，防火墙不会弹窗，也没有安全问题。

## 七、参考文件

| 文件 | 作用 |
|---|---|
| `启动器源码/Launcher.cs` | Windows 启动器完整实现（API 部分在 `ServeApi` 方法，可直接对照翻译） |
| `备用启动.ps1` | 精简版启动器（只含静态文件服务，展示了最小骨架） |
| `源码/src/lib/serverSync.ts` | 前端调用 /api/store、/api/media、/api/pack 的确切方式 |
| `源码/src/lib/intensive.ts` | 前端调用 /api/notes、/api/wordbook 的方式（精读） |
| `源码/src/lib/listenLab.ts` | 前端调用 /api/lnotes、/api/lwords 的方式（精听） |
| `使用说明.txt` | 用户视角的完整功能说明 |
