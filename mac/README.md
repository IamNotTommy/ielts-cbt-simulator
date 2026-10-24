# 英语机考模拟器 —— macOS 版

这是英语机考模拟器 v2.0 的 macOS 启动器。网页应用与 Windows 版完全相同（同一份 `dist` 构建），
只是把 Windows 的 C# 单文件启动器换成了 macOS 上可运行的 Python 3 脚本。

- 前端：React SPA（阅读、听力、写作、精读、精听、错题复盘、词汇复习、学习分析、备份、搜索）
- 启动器：`launcher.py`（Python 3 标准库，无第三方依赖）
- 数据格式与 Windows 版完全一致，整个文件夹可以在 Windows / macOS 之间拷贝

## 系统要求

- macOS 10.15 Catalina 或更高
- Python 3（macOS 通常自带；如果没有，终端运行 `xcode-select --install`）

## 使用

1. 解压 `ielts-cbt-simulator-2.0.2-mac.zip`，得到 `英语机考模拟器-Mac/` 文件夹。
2. 第一次打开如果被 macOS 拦截（“无法验证开发者”）：
   - 右键 `启动模拟器.command` → **打开** → 再点“打开”；或
   - 先双击 `解除隔离.command`（等价于 Windows 版的“解除锁定”）。
3. 双击 `启动模拟器.command`。
4. 终端会显示 `http://127.0.0.1:17301/`，浏览器会自动打开。
5. 从首页导入你自备的 `.zip` 题包即可开始。

> 关闭终端窗口 = 退出程序。再次双击不会起第二个服务，会直接打开已有实例的页面。

## 数据存在哪

全部在 `英语机考模拟器-Mac/` 文件夹里（与 Windows 版同名）：

```text
导入题目/       数据/tests.json、媒体/、题包/
做题记录/       records.json、写作/<recordId>.json、学习数据.json
精读记录/       <testId>__p<idx>.json、词汇句子册.json
精听记录/       <testId>__s<n>.json、生词本.json
启动日志.txt
```

如果程序目录不可写（例如放进 `/Applications`），会自动退回
`$TMPDIR/CBT模拟器_数据`，界面仍可正常使用，但数据不在程序目录里。

## 与 Windows 版的差异

- 不需要安装 Node/npm，也不需要 exe；网页文件直接读旁边的 `网页应用/` 目录。
- 没有代码签名，所以首次打开需要“右键 → 打开”或运行 `解除隔离.command`。
- 只监听 `127.0.0.1`，局域网/外网无法访问。
- 所有 API 与 Windows 版一致，包括 v2.0 新增的：
  - `GET/PUT /api/store/learning`
  - `GET /api/writing`、`GET/PUT/DELETE /api/writing/<recordId>`

## 常见问题

**双击没反应 / 提示“无法打开”**
在终端进入该文件夹，运行：

```bash
xattr -dr com.apple.quarantine .
chmod +x *.command
```

然后重新双击。

**提示 `python3` 不存在**
运行 `xcode-select --install`，安装完成后重试。

**端口被占用**
启动器会从 17301 开始自动顺延（17301–17320 → 27301–27310 → 37301–37310 → 系统分配）。

**想换端口**

```bash
python3 launcher.py --port=18000
```

**数据目录不可写**
把整个文件夹移到 `~/Downloads` 或 `~/Documents` 再启动。

**题包怎么制作**
见 [`PACK_FORMAT.md`](PACK_FORMAT.md)（或仓库里的 `docs/PACK_FORMAT.md`）。

## 从源码构建 Mac 包

在仓库根目录：

```bash
npm ci
npm run build
bash mac/build-mac.sh
```

输出：`mac-dist/ielts-cbt-simulator-2.0.2-mac.zip`。

`mac/build-mac.sh` 会把仓库根目录的 `dist/` 复制为 `网页应用/`，再连同
`launcher.py`、两个 `.command`、使用说明与题包文档一起打包。

## 许可证

与仓库一致：MIT License。程序不附带任何真题题包，题包需自备。
