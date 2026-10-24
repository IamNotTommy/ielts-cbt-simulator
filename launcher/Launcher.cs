// 英语机考模拟器 —— 单文件启动器（C# 5 / .NET Framework 4.x，Windows 自带运行时，无需 Node/npm）
//
// v3.3.2（2026-10-16）相对 v3.3.1 的改动：
//   · 精听功能配套接口：/api/lnotes（列出 key）、/api/lnotes/<key>（GET/PUT/DELETE，每篇听力一个
//     JSON，存 精听记录\ 文件夹）、/api/lwords（GET/PUT，精听记录\生词本.json）。
//
// v3.3.1（2026-10-15）相对 v3.3 的改动：
//   · 精读功能配套接口：/api/notes（列出全部精读文件 key）、/api/notes/<key>（GET/PUT/DELETE，
//     每篇阅读一个 JSON 文件，存 精读记录\ 文件夹）、/api/wordbook（GET/PUT，精读记录\词汇句子册.json）。
//
// v3.3（2026-10-15）相对 v3.2.1 的改动：
//   · 本地数据文件夹：新增 /api/store/* 与 /api/media/* 接口，把题库、听力音频/题图、练习记录
//     落到 exe 同目录的「导入题目」「做题记录」两个文件夹（每次导入的 zip 原件也留档在 导入题目\题包）。
//     浏览器 localStorage/IndexedDB 仍是工作缓存，页面打开时会从文件夹恢复——换浏览器、换端口、
//     清浏览器数据都不再丢题库和成绩。数据目录不可写时接口返回 503，页面自动退回旧的纯浏览器存储。
//   · HTTP：支持读取 PUT/POST 请求体（字节级解析，上限 512 MB）；响应头统一走 WriteResponse；
//     /api/ 请求不计入"页面已打开"判定；Host 校验对 /api/ 同样生效。
//   · 自检：新增数据接口往返检查（ping → 写入 → 读回 → 删除 → 404），只动 _selftest 目录。
// v3（2026-10-10）相对 v2 的改动：
//   · 单实例：会话内命名互斥量 + %TEMP% 端口文件，解决"连点两下起两个服务、开到不同端口"的竞态
//   · 实例标识带 会话号+用户哈希，RDP 多会话下不会把别人的实例当成自己的
//   · 端口：区分"被占用"与"被系统保留(10013)"；候选 17301-17320 → 27301-27310 → 37301-37310 → 系统分配
//     端口≠17301 时明确提示"浏览器数据按地址分开存放，本次看不到之前的题库"
//   · 先启动 accept 线程再开浏览器（v2 在开浏览器期间不处理请求，第二个实例的探测会超时误判）
//   · 浏览器：默认关联（默认是 IE 时跳过）→ 注册表 App Paths / StartMenuInternet / 常见安装路径 → explorer.exe；去掉 cmd /c start
//   · 控制台：GBK 控制台保持 936，其余用无 BOM 的 UTF-8；关闭"快速编辑"防止点一下窗口就卡住服务
//   · HTTP：HEAD 返回真实长度；带扩展名的缺失文件返回 404；校验 Host 头（防 DNS 重绑定）
//   · 自检：端口被占时自动换系统分配端口；覆盖 .mjs；自检模式出错不再等按键（避免环境自检卡死）
//
// v3.1（2026-10-11）相对 v3 的改动：
//   · 图形界面：默认双击出现深炭灰色常驻窗口（正在启动 → 运行中 两种状态），不再弹黑色控制台
//   · 再次双击会把已有窗口带到前台并打开浏览器，不会起第二个服务
//   · --console 恢复旧的黑色控制台模式；--selftest / --log 仍走控制台（自动附着到父控制台，否则新建）
//   · 窗口关闭即退出程序；端口、单实例、日志等底层逻辑与 v3 完全一致
//
// v3.2.1（2026-10-11）相对 v3.2 的改动：
//   · 修掉"打开页面后浏览器自己窗口化一下、再挪一下位置"的问题：
//     v3.2 及更早版本把浏览器窗口置前时无条件调用 ShowWindow(SW_RESTORE)，
//     而该 API 的语义是"把最大化/最小化的窗口还原成原来的大小和位置"——对最大化的浏览器执行，
//     等于替用户取消了最大化并挪回旧位置。现在只有窗口"已最小化"时才还原，其余状态一概不动。
//   · 去掉 keybd_event 注入的全局 Alt 按键（会干扰用户当时的键盘/鼠标操作，可能被系统当成窗口拖动）。
//   · 抢不到前台时退化为"闪任务栏图标"，只提示，绝不改变窗口大小/位置。
//   · 枚举目标窗口时过滤掉带主窗口的弹出窗（对话框）和过小窗口，避免误操作别的窗口。
//
// v3.2（2026-10-11）相对 v3.1 的改动（本次）：
//   · 打开浏览器改为"多方式 + 真验证"：每试一种方式，就看本机服务器有没有真的收到页面请求；
//     没收到就自动换下一种（系统默认关联 → 默认浏览器程序 → rundll32 → cmd start → 各浏览器 exe → explorer）。
//     以前只要 Process.Start 不抛异常就宣称"已打开"，浏览器其实没打开时用户会一头雾水。
//   · 启动时检测"完整性级别"（Low/Untrusted = 被自动化工具或沙箱以受限权限启动）：
//     这种权限下 Windows 不允许本程序调起浏览器（点了没反应是必然的），窗口会直接给出说明，
//     并把地址复制到剪贴板、同时在程序目录放一个「打开练习页面.bat」供双击使用。日志里也会记下级别。
//   · 状态文字不再撒谎：只有服务器真的收到页面请求，才显示"页面已在浏览器打开"。
//   · 打开过程中按钮禁用并显示"正在打开浏览器…"，避免连点开出多个标签页。
//
// 用法： 英语机考模拟器.exe [--port=17301] [--no-open] [--quiet] [--selftest] [--log] [--console]

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using WpfShapes = System.Windows.Shapes;

[assembly: AssemblyTitle("英语机考模拟器 启动器")]
[assembly: AssemblyProduct("英语机考模拟器")]
[assembly: AssemblyDescription("在 127.0.0.1 提供内置网页并打开浏览器；不联网，不写系统目录")]
[assembly: AssemblyVersion("3.3.2.0")]
[assembly: AssemblyFileVersion("3.3.2.0")]

internal static class Launcher
{
    private const string Marker = "X-CBT-Simulator";
    private const int DefaultPort = 17301;
    private static readonly Dictionary<string, byte[]> Files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
    private static bool quiet, selfTest;
    private static long served;
    private static long getHits;          // 收到过多少次 GET 请求（页面是否真的被浏览器打开的判据；HEAD 探测不计）
    private static string logPath;
    private static string identity;
    private static Mutex instanceMutex;
    private static bool mutexOwned;
    private static readonly ManualResetEvent guiExit = new ManualResetEvent(false);
    private static GuiWindow guiWin;
    private static string dataRoot;          // 本地数据根目录（exe 同目录；不可写时退回 %TEMP%\CBT模拟器_数据）
    private static bool storeReady;          // 数据目录可用 → /api/store/* 与 /api/media/* 才开放

    [DllImport("kernel32.dll")] private static extern IntPtr GetStdHandle(int n);
    [DllImport("kernel32.dll")] private static extern bool GetConsoleMode(IntPtr h, out uint mode);
    [DllImport("kernel32.dll")] private static extern bool SetConsoleMode(IntPtr h, uint mode);
    [DllImport("kernel32.dll")] private static extern bool AttachConsole(int dwProcessId);
    [DllImport("kernel32.dll")] private static extern bool AllocConsole();
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr hIcon);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] private static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
    [DllImport("user32.dll")] private static extern bool FlashWindowEx(ref FLASHWINFO pwfi);
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct FLASHWINFO
    {
        public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout;
    }
    private const uint GW_OWNER = 4;
    private const uint FLASHW_TRAY = 2;
    private const uint FLASHW_TIMERNOFG = 12;
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr hObject);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr hProcess, int dwFlags, StringBuilder lpExeName, ref int lpdwSize);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint desiredAccess, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr info, int infoLength, out int returnLength);
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [STAThread]
    private static int Main(string[] args)
    {
        int startPort = DefaultPort;
        bool open = true, showLog = false, forceConsole = false;
        foreach (string a in args)
        {
            if (a.StartsWith("--port=", StringComparison.OrdinalIgnoreCase))
            {
                int p;
                if (int.TryParse(a.Substring(7), NumberStyles.Integer, CultureInfo.InvariantCulture, out p) && p > 0 && p < 65536) startPort = p;
            }
            else if (a.Equals("--no-open", StringComparison.OrdinalIgnoreCase)) open = false;
            else if (a.Equals("--quiet", StringComparison.OrdinalIgnoreCase)) quiet = true;
            else if (a.Equals("--selftest", StringComparison.OrdinalIgnoreCase)) { selfTest = true; open = false; quiet = true; }
            else if (a.Equals("--log", StringComparison.OrdinalIgnoreCase)) showLog = true;
            else if (a.Equals("--console", StringComparison.OrdinalIgnoreCase)) forceConsole = true;
        }

        bool consoleMode = selfTest || showLog || forceConsole;
        if (consoleMode)
        {
            EnsureConsole();          // winexe 没有控制台：能附着父控制台就附着，否则新建一个
            SetupConsole();
            Console.WriteLine("英语机考模拟器 正在启动…");
            Console.Out.Flush();
        }

        identity = Process.GetCurrentProcess().SessionId.ToString(CultureInfo.InvariantCulture) + "-" + Fnv(Environment.UserDomainName + "\\" + Environment.UserName);

        InitLog();
        InitStore();
        Log("=== 启动 v3.3 ===");
        Log("exe: " + SafeExePath());
        Log("参数: " + string.Join(" ", args));
        Log("实例标识: " + identity + "  CLR " + Environment.Version + "  " + (IntPtr.Size * 8) + " 位进程  OS " + Environment.OSVersion.VersionString);
        Log("完整性级别: " + IntegrityName(IntegrityRid()) + "（Low / Untrusted 表示被受限权限启动，这种情况 Windows 不允许本程序调起浏览器）");
        if (consoleMode) Line("日志文件：" + (logPath ?? "（无处可写，不记日志）"));

        if (showLog)
        {
            try { Console.WriteLine(File.ReadAllText(logPath, Encoding.UTF8)); } catch { }
            Pause();
            return 0;
        }

        try
        {
            if (selfTest) return SelfTest(startPort);
            return forceConsole ? Run(startPort, open) : GuiRun(startPort, open);
        }
        catch (Exception ex)
        {
            Log("× 未处理异常: " + ex);
            EnsureConsole();
            Line("");
            Line("× 程序出错：" + ex.Message);
            Line("  详细信息已写入日志：" + logPath);
            if (!selfTest) Pause();
            return 1;
        }
    }

    /// winexe 启动时没有控制台。诊断模式（--selftest / --log / --console / 出错兜底）需要输出时调用：
    /// 优先附着到父进程控制台（在 cmd / 脚本里运行时输出在原窗口），附着不上就新建一个控制台窗口。
    private static void EnsureConsole()
    {
        try
        {
            if (!AttachConsole(-1)) AllocConsole();
            Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), Console.OutputEncoding) { AutoFlush = true });
            Console.SetError(new StreamWriter(Console.OpenStandardError(), Console.OutputEncoding) { AutoFlush = true });
            try { Console.SetIn(new StreamReader(Console.OpenStandardInput())); } catch { }
        }
        catch { }
    }

    private static int Run(int startPort, bool open)
    {
        Line("读取内置的网页应用…");
        LoadEmbeddedFiles();
        Log("内嵌资源 " + Files.Count + " 个");

        // ① 单实例：互斥量在会话内唯一。不靠 createdNew 判主（其他进程的残留句柄会让它误报"已存在"），
        //    直接抢所有权：抢到（含原主被强杀后锁被遗弃）说明没有活着的服务主，本实例当主；
        //    抢不到说明有活着的主，走连接/复用分支
        instanceMutex = new Mutex(false, "Local\\CBT-Simulator-" + identity);
        try { mutexOwned = instanceMutex.WaitOne(0); }
        catch (AbandonedMutexException) { mutexOwned = true; }   // 原主崩溃/被强杀，锁已归本线程
        if (!mutexOwned)
        {
            Line("检测到模拟器已在运行，正在连接…");
            int existing = WaitForOwnInstance(8000);
            if (existing > 0)
            {
                instanceMutex.Dispose();   // 连接者用完即放，不留句柄干扰判主
                instanceMutex = null;
                return ReuseInstance(existing, open);
            }
            Line("没连上已有的实例（可能卡住了），继续启动一个新的。");
            Log("互斥量被占但 8 秒内没探测到实例");
            try { mutexOwned = instanceMutex.WaitOne(0); }   // 主可能正好死在探测窗口里，再抢一次
            catch (AbandonedMutexException) { mutexOwned = true; }
        }

        // ② 选端口
        TcpListener listener = null;
        int port = 0;
        foreach (int p in PortCandidates(startPort))
        {
            bool busy;
            string err;
            listener = TryListen(p, out busy, out err);
            if (listener != null) { port = ((IPEndPoint)listener.LocalEndpoint).Port; break; }
            Log("端口 " + p + " 不可用：" + err);
            if (busy && p < startPort + 20 && p >= startPort)
            {
                string who = ProbeMarker(p, 300, 800);
                if (IsMine(who)) { ReleaseInstanceMutex(); return ReuseInstance(p, open); }
                if (who != null) Log("端口 " + p + " 被其他用户/会话的模拟器占用：" + who);
            }
        }

        if (listener == null)
        {
            Line("× 无法在本机监听任何端口（含系统自动分配）。");
            Line("  多半是安全软件或公司策略禁止程序监听本地端口：请把本程序加入信任，");
            Line("  或改用同目录的「备用启动.bat」（PowerShell 版），详细原因见日志。");
            Log("× 全部端口不可用");
            Pause();
            ReleaseInstanceMutex();
            return 1;
        }

        Thread acceptThread = new Thread(delegate() { AcceptLoop(listener); });
        acceptThread.IsBackground = true;
        acceptThread.Start();
        WritePortFile(port);

        string home = "http://127.0.0.1:" + port + "/";
        Line("");
        Line("√ 启动成功");
        Line("  地址 : " + home);
        Line("  用法 : 浏览器打开后，把 .zip 题包拖进方框即可");
        Line("  数据 : 题库与练习记录保存在本程序目录的「导入题目」「做题记录」文件夹里");
        Line("  退出 : 关闭本窗口");
        if (port != DefaultPort)
        {
            Line("");
            Line("! 注意：这次用的端口是 " + port + "，不是默认的 " + DefaultPort + "（数据在文件夹里，不受端口影响）。");
            Line("  查占用者： netstat -ano | findstr :" + DefaultPort);
        }
        Line("");
        Log("监听 " + home);

        if (open)
        {
            string detail;
            string how = OpenBrowserVerified(home, out detail);
            Line(how != null ? "已用「" + how + "」打开浏览器（浏览器确实来取过页面）；若没看到窗口，请手动把上面的地址粘到浏览器。"
                             : "× 没能自动打开浏览器，请手动把下面的地址粘到浏览器：" + home);
            Log("打开浏览器: " + (how ?? "失败") + "  " + detail);
        }
        Line("");
        Line("—— 运行中，下面显示访问日志 ——");

        acceptThread.Join();
        ReleaseInstanceMutex();
        return 0;
    }

    /// 正常退出路径释放互斥量（必须在持有锁的线程——即主线程——调用）。
    /// Ctrl+C/关窗等强杀路径由系统把锁标记为"被遗弃"，下一个实例 WaitOne 时经 AbandonedMutexException 接管。
    private static void ReleaseInstanceMutex()
    {
        try
        {
            Mutex m = instanceMutex;
            instanceMutex = null;
            if (m == null) return;
            if (mutexOwned) { mutexOwned = false; m.ReleaseMutex(); }
            m.Dispose();
        }
        catch { }
    }

    private static int ReuseInstance(int port, bool open)
    {
        string u = "http://127.0.0.1:" + port + "/";
        Line("模拟器已在运行：" + u + (open ? "（已为你打开浏览器）" : ""));
        Log("复用已有实例 " + u);
        if (open)
        {
            string how = OpenBrowserSimple(u);
            if (how == null) Line("× 没能自动打开浏览器，请手动打开：" + u);
            Thread.Sleep(1500);
        }
        return 0;
    }

    private static void AcceptLoop(TcpListener listener)
    {
        ThreadPool.SetMinThreads(16, 16);
        while (true)
        {
            TcpClient client;
            try { client = listener.AcceptTcpClient(); }
            catch (Exception ex) { Log("accept 结束: " + ex.Message); return; }
            ThreadPool.QueueUserWorkItem(delegate(object o) { Serve((TcpClient)o); }, client);
        }
    }

    /* ---------------- 图形界面（方案 C：深炭灰） ---------------- */

    private static int GuiRun(int startPort, bool open)
    {
        guiWin = new GuiWindow();
        Thread life = new Thread(delegate() { GuiLifecycle(startPort, open, guiWin); });
        life.IsBackground = true;
        life.Start();
        try { new Application().Run(guiWin); }
        catch (Exception ex) { Log("界面消息循环异常: " + ex); }
        guiExit.Set();
        try { life.Join(2000); } catch { }
        return 0;
    }

    /// 与控制台版 Run 同一套逻辑，只是把输出换成窗口状态。互斥量由本线程持有并释放。
    private static void GuiLifecycle(int startPort, bool open, GuiWindow win)
    {
        win.SetProgress("正在加载内置应用…", 18);
        LoadEmbeddedFiles();
        Log("内嵌资源 " + Files.Count + " 个");

        instanceMutex = new Mutex(false, "Local\\CBT-Simulator-" + identity);
        try { mutexOwned = instanceMutex.WaitOne(0); }
        catch (AbandonedMutexException) { mutexOwned = true; }
        if (!mutexOwned)
        {
            win.SetProgress("检测到模拟器已在运行，正在连接…", 40);
            int existing = WaitForOwnInstance(8000);
            if (existing > 0)
            {
                instanceMutex.Dispose();
                instanceMutex = null;
                SignalRunningInstance();
                GuiReuse(existing, open, win);
                return;
            }
            Log("互斥量被占但 8 秒内没探测到实例");
            try { mutexOwned = instanceMutex.WaitOne(0); }
            catch (AbandonedMutexException) { mutexOwned = true; }
        }

        win.SetProgress("正在启动本机服务…", 60);
        TcpListener listener = null;
        int port = 0;
        foreach (int p in PortCandidates(startPort))
        {
            bool busy;
            string err;
            listener = TryListen(p, out busy, out err);
            if (listener != null) { port = ((IPEndPoint)listener.LocalEndpoint).Port; break; }
            Log("端口 " + p + " 不可用：" + err);
            if (busy && p < startPort + 20 && p >= startPort)
            {
                string who = ProbeMarker(p, 300, 800);
                if (IsMine(who)) { ReleaseInstanceMutex(); SignalRunningInstance(); GuiReuse(p, open, win); return; }
                if (who != null) Log("端口 " + p + " 被其他用户/会话的模拟器占用：" + who);
            }
        }

        if (listener == null)
        {
            Log("× 全部端口不可用");
            win.ShowError("没能在你的电脑上启动服务",
                "多半是安全软件拦截了本程序。请把本程序加入杀毒软件信任后重试；也可以试试同目录的「备用启动.bat」。");
            ReleaseInstanceMutex();
            return;
        }

        Thread acceptThread = new Thread(delegate() { AcceptLoop(listener); });
        acceptThread.IsBackground = true;
        acceptThread.Start();
        WritePortFile(port);

        string home = "http://127.0.0.1:" + port + "/";
        Log("监听 " + home);

        string warn = RestrictedPermissionsWarning();
        if (port != DefaultPort)
            warn = (warn == null ? "" : warn + "\n") + "注意：本次使用的端口是 " + port + "（不是默认的 " + DefaultPort + "）。题库与练习记录保存在程序目录的文件夹里，不受端口影响。";

        StartShowSignalListener(win);
        win.ShowReady(home, warn);

        guiExit.WaitOne();              // 窗口关闭后主线程会 Set
        try { listener.Stop(); } catch { }
        ReleaseInstanceMutex();
    }

    private static void GuiReuse(int port, bool open, GuiWindow win)
    {
        string u = "http://127.0.0.1:" + port + "/";
        // 第二个实例不做服务，但"打开浏览器"这件事由它来做更靠谱：
        // 它往往是用户自己双击起来的（正常权限），而正在跑的那个可能是被自动化工具以受限权限启动的。
        string how = null;
        if (open)
        {
            how = OpenBrowserSimple(u);
            Log("复用已有实例 " + u + "：由本进程代为打开浏览器 → " + (how ?? "失败"));
        }
        else
        {
            Log("复用已有实例 " + u + "（不打开浏览器，只把已有窗口带到前台）");
        }
        win.ShowAlreadyRunning(u, how != null);
        Thread.Sleep(5000);             // 停留几秒让用户看清状态，然后自动关闭
        win.CloseFromThread();
    }

    /// 第二个实例通过命名事件通知已运行的实例把窗口带到前台
    private static void SignalRunningInstance()
    {
        try
        {
            using (EventWaitHandle ev = EventWaitHandle.OpenExisting("Local\\CBT-Simulator-Show-" + identity))
                ev.Set();
        }
        catch { }
    }

    private static void StartShowSignalListener(GuiWindow win)
    {
        try
        {
            EventWaitHandle ev = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\CBT-Simulator-Show-" + identity);
            Thread t = new Thread(delegate()
            {
                while (!guiExit.WaitOne(0))
                {
                    try { if (!ev.WaitOne()) break; } catch { break; }
                    win.BringToFront();
                }
                try { ev.Dispose(); } catch { }
            });
            t.IsBackground = true;
            t.Start();
        }
        catch (Exception ex) { Log("窗口唤醒事件创建失败: " + ex.Message); }
    }

    private sealed class GuiWindow : Window
    {
        private readonly StackPanel startingPanel;
        private readonly StackPanel runningPanel;
        private readonly ProgressBar bar;
        private readonly TextBlock statusSub;
        private readonly WpfShapes.Ellipse dot;
        private readonly TextBlock runStatus;
        private readonly TextBlock addrText;
        private readonly TextBlock warnText;
        private readonly TextBlock hintText;
        private readonly DispatcherTimer hintTimer;
        private readonly Button actionBtn;
        private readonly Button exitBtn;
        private readonly Button copyBtn;
        private readonly TextBlock footText;
        private readonly DispatcherTimer barTimer;
        private double barTarget;
        private string homeUrl;
        private bool errorState;

        private static SolidColorBrush C(string hex)
        {
            SolidColorBrush b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
            b.Freeze();
            return b;
        }

        public GuiWindow()
        {
            Width = 380;
            Height = 300;
            MinHeight = 300;
            MaxHeight = 620;
            SizeToContent = SizeToContent.Height;      // 提示文字长短不一：让窗口按内容自动长高，避免文字被裁掉
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            Title = "英语机考模拟器";
            FontFamily = new FontFamily("Microsoft YaHei");
            try { Icon = MakeIcon(); } catch { }

            Border root = new Border();
            root.Background = C("#26282C");
            root.BorderBrush = C("#3A3D42");
            root.BorderThickness = new Thickness(1);
            root.CornerRadius = new CornerRadius(6);
            root.SnapsToDevicePixels = true;
            Content = root;

            DockPanel dock = new DockPanel();
            root.Child = dock;

            // 顶部标题栏
            Border titleBar = new Border();
            titleBar.Height = 34;
            titleBar.Background = Brushes.Transparent;   // 透明背景才能接收整条栏的鼠标事件（拖动）
            DockPanel.SetDock(titleBar, Dock.Top);
            DockPanel tb = new DockPanel();
            tb.LastChildFill = false;
            tb.Background = Brushes.Transparent;
            titleBar.Child = tb;
            // 先放右侧按钮（Dock.Right），后放左侧标题，否则末位填充会把按钮顶到文字旁边
            StackPanel tbBtns = new StackPanel();
            tbBtns.Orientation = Orientation.Horizontal;
            DockPanel.SetDock(tbBtns, Dock.Right);
            tbBtns.Children.Add(TitleButton("—", false));
            tbBtns.Children.Add(TitleButton("✕", true));
            tb.Children.Add(tbBtns);
            // 左侧：小图标 + 标题
            StackPanel tbLeft = new StackPanel();
            tbLeft.Orientation = Orientation.Horizontal;
            DockPanel.SetDock(tbLeft, Dock.Left);
            try
            {
                System.Windows.Controls.Image ico = new System.Windows.Controls.Image();
                ico.Source = MakeIcon();
                ico.Width = 16;
                ico.Height = 16;
                ico.Margin = new Thickness(12, 0, 7, 0);
                ico.VerticalAlignment = VerticalAlignment.Center;
                tbLeft.Children.Add(ico);
            }
            catch { }
            TextBlock tbTitle = new TextBlock();
            tbTitle.Text = "英语机考模拟器";
            tbTitle.Foreground = C("#7A7F88");
            tbTitle.FontSize = 11.5;
            tbTitle.VerticalAlignment = VerticalAlignment.Center;
            tbLeft.Children.Add(tbTitle);
            tb.Children.Add(tbLeft);
            titleBar.MouseLeftButtonDown += delegate { try { DragMove(); } catch { } };
            dock.Children.Add(titleBar);

            // 底部安心条
            Border foot = new Border();
            foot.Height = 34;
            foot.BorderBrush = C("#33363B");
            foot.BorderThickness = new Thickness(0, 1, 0, 0);
            DockPanel.SetDock(foot, Dock.Bottom);
            footText = new TextBlock();
            footText.Text = "仅在你的电脑上运行，不会联网";
            footText.Foreground = C("#6A6F76");
            footText.FontSize = 11;
            footText.HorizontalAlignment = HorizontalAlignment.Center;
            footText.VerticalAlignment = VerticalAlignment.Center;
            foot.Child = footText;
            dock.Children.Add(foot);

            // 中部内容
            Grid center = new Grid();
            center.Margin = new Thickness(30, 26, 30, 0);
            dock.Children.Add(center);
            StackPanel col = new StackPanel();
            center.Children.Add(col);

            TextBlock app = new TextBlock();
            app.Text = "英语机考模拟器";
            app.Foreground = C("#E8E9EB");
            app.FontSize = 15;
            app.FontWeight = FontWeights.SemiBold;
            col.Children.Add(app);

            // 状态一：正在启动
            startingPanel = new StackPanel();
            col.Children.Add(startingPanel);
            bar = new ProgressBar();
            bar.Height = 3;
            bar.Minimum = 0;
            bar.Maximum = 100;
            bar.Margin = new Thickness(0, 24, 0, 0);
            bar.Foreground = C("#E8E9EB");
            bar.Background = C("#3A3D42");
            bar.Template = ProgressTemplate();
            startingPanel.Children.Add(bar);
            statusSub = new TextBlock();
            statusSub.Text = "正在启动，请稍候…";
            statusSub.Foreground = C("#7A7F88");
            statusSub.FontSize = 12;
            statusSub.Margin = new Thickness(0, 10, 0, 0);
            startingPanel.Children.Add(statusSub);

            // 状态二：运行中 / 出错
            runningPanel = new StackPanel();
            runningPanel.Visibility = Visibility.Collapsed;
            col.Children.Add(runningPanel);
            StackPanel runRow = new StackPanel();
            runRow.Orientation = Orientation.Horizontal;
            runRow.Margin = new Thickness(0, 20, 0, 0);
            dot = new WpfShapes.Ellipse();
            dot.Width = 8;
            dot.Height = 8;
            dot.Fill = C("#4CC38A");
            dot.VerticalAlignment = VerticalAlignment.Center;
            dot.Margin = new Thickness(0, 0, 8, 0);
            runRow.Children.Add(dot);
            runStatus = new TextBlock();
            runStatus.Foreground = C("#C9CCD1");
            runStatus.FontSize = 13;
            runStatus.TextWrapping = TextWrapping.Wrap;
            runRow.Children.Add(runStatus);
            runningPanel.Children.Add(runRow);
            addrText = new TextBlock();
            addrText.Foreground = C("#7A7F88");
            addrText.FontSize = 12;
            addrText.FontFamily = new FontFamily("Consolas");
            addrText.Margin = new Thickness(16, 10, 0, 0);
            runningPanel.Children.Add(addrText);
            warnText = new TextBlock();
            warnText.Foreground = C("#C9A95C");
            warnText.FontSize = 11.5;
            warnText.TextWrapping = TextWrapping.Wrap;
            warnText.Margin = new Thickness(16, 10, 0, 0);
            warnText.Visibility = Visibility.Collapsed;
            runningPanel.Children.Add(warnText);
            hintText = new TextBlock();
            hintText.Foreground = C("#8FA8C9");
            hintText.FontSize = 11.5;
            hintText.TextWrapping = TextWrapping.Wrap;
            hintText.Margin = new Thickness(16, 8, 0, 0);
            hintText.Visibility = Visibility.Collapsed;
            runningPanel.Children.Add(hintText);

            Grid btnRow = new Grid();
            btnRow.Margin = new Thickness(0, 20, 0, 0);
            btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            btnRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            actionBtn = MakeButton("打开练习页面", C("#E8E9EB"), C("#26282C"), C("#FFFFFF"), null);
            actionBtn.Margin = new Thickness(0, 0, 6, 0);
            actionBtn.Click += delegate
            {
                if (errorState) { OpenLogFile(); return; }
                TryOpenPage();
            };
            Grid.SetColumn(actionBtn, 0);
            btnRow.Children.Add(actionBtn);
            exitBtn = MakeButton("退出程序", Brushes.Transparent, C("#C9CCD1"), C("#33363B"), C("#4A4D53"));
            exitBtn.Margin = new Thickness(6, 0, 0, 0);
            exitBtn.Click += delegate { Close(); };
            Grid.SetColumn(exitBtn, 1);
            btnRow.Children.Add(exitBtn);
            runningPanel.Children.Add(btnRow);

            // 自动打开失败时才出现的「复制地址」按钮（受限权限下最实用的兜底）
            copyBtn = MakeButton("复制地址到剪贴板", Brushes.Transparent, C("#C9CCD1"), C("#33363B"), C("#4A4D53"));
            copyBtn.Margin = new Thickness(0, 8, 0, 0);
            copyBtn.Visibility = Visibility.Collapsed;
            copyBtn.Click += delegate
            {
                CopyAddressToClipboard();
                runStatus.Text = "地址已复制，请在浏览器地址栏 Ctrl+V 打开";
            };
            runningPanel.Children.Add(copyBtn);

            barTimer = new DispatcherTimer();
            barTimer.Interval = TimeSpan.FromMilliseconds(30);
            barTimer.Tick += delegate
            {
                if (bar.Value < barTarget) bar.Value = Math.Min(barTarget, bar.Value + 2);
                else barTimer.Stop();
            };

            hintTimer = new DispatcherTimer();
            hintTimer.Interval = TimeSpan.FromSeconds(10);
            hintTimer.Tick += delegate
            {
                hintText.Visibility = Visibility.Collapsed;
                hintTimer.Stop();
            };
        }

        /// 点「打开练习页面」：后台线程里逐个方式试 + 用服务器是否收到页面请求来验证，
        /// 界面先显示"正在打开浏览器…"，验证失败再如实告知（不再出现"点了没反应"却毫无提示的情况）。
        private void TryOpenPage()
        {
            string url = homeUrl;
            if (url == null) return;
            if (!actionBtn.IsEnabled) return;               // 正在打开中，忽略连点
            actionBtn.IsEnabled = false;
            runStatus.Text = "正在打开浏览器…";
            hintText.Visibility = Visibility.Collapsed;
            ThreadPool.QueueUserWorkItem(delegate
            {
                string detail;
                string how = OpenBrowserVerified(url, out detail);
                Log("按钮打开浏览器: " + (how ?? "失败") + "  " + detail);
                NoteBrowserOpened(how != null, how, detail);
            });
        }

        private void CopyAddressToClipboard()
        {
            try { if (homeUrl != null) Clipboard.SetText(homeUrl); }
            catch (Exception ex) { Log("复制地址到剪贴板失败: " + ex.Message); }
        }

        /// 每次尝试打开浏览器后调用：说清结果（成功=服务器确实收到了页面请求），把地址复制到剪贴板，
        /// 失败时给出可执行的下一步（粘贴地址 / 双击备用入口 / 换正常权限重启）。
        public void NoteBrowserOpened(bool ok, string how, string detail)
        {
            UI(delegate
            {
                actionBtn.IsEnabled = true;
                CopyAddressToClipboard();
                if (ok && !errorState)
                {
                    runStatus.Text = "运行中，页面已在浏览器打开";
                    hintText.Text = "已用「" + how + "」打开页面，地址也已复制到剪贴板。"
                                  + "若浏览器没跳到前台，看任务栏里的浏览器图标即可。";
                }
                else if (!ok && !errorState)
                {
                    runStatus.Text = "没能自动打开浏览器";
                    string bat = WriteFallbackBat(homeUrl);
                    hintText.Text = "地址已复制到剪贴板，Ctrl+V 粘到浏览器地址栏即可打开。"
                                  + (bat != null ? "也可双击程序目录里刚生成的「" + Path.GetFileName(bat) + "」。" : "")
                                  + (IsRestrictedIntegrity()
                                        ? "本程序是被以「受限权限」启动的，请关掉后直接双击「英语机考模拟器.exe」重启。"
                                        : "若反复失败，可把程序目录下的「启动日志.txt」发给作者。");
                    copyBtn.Visibility = Visibility.Visible;
                }
                hintText.Visibility = Visibility.Visible;
                hintTimer.Stop();
                hintTimer.Interval = TimeSpan.FromSeconds(ok ? 12 : 40);
                hintTimer.Start();
            });
        }

        private Border TitleButton(string text, bool isClose)
        {
            Border b = new Border();
            b.Width = 44;
            b.Height = 34;
            b.Background = Brushes.Transparent;
            TextBlock t = new TextBlock();
            t.Text = text;
            t.Foreground = C("#7A7F88");
            t.FontSize = 12;
            t.HorizontalAlignment = HorizontalAlignment.Center;
            t.VerticalAlignment = VerticalAlignment.Center;
            b.Child = t;
            b.Cursor = Cursors.Hand;
            b.PreviewMouseLeftButtonDown += delegate(object s, MouseButtonEventArgs e) { e.Handled = true; };  // 不让按下事件冒泡成拖动
            b.MouseLeftButtonUp += delegate
            {
                if (isClose) Close();
                else WindowState = WindowState.Minimized;
            };
            b.MouseEnter += delegate
            {
                b.Background = isClose ? C("#B13B3B") : C("#3A3D42");
                if (isClose) t.Foreground = Brushes.White;
            };
            b.MouseLeave += delegate
            {
                b.Background = Brushes.Transparent;
                t.Foreground = C("#7A7F88");
            };
            return b;
        }

        private static ControlTemplate ProgressTemplate()
        {
            ControlTemplate tpl = new ControlTemplate(typeof(ProgressBar));
            FrameworkElementFactory track = new FrameworkElementFactory(typeof(Border));
            track.Name = "PART_Track";
            track.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(ProgressBar.BackgroundProperty));
            track.SetValue(Border.CornerRadiusProperty, new CornerRadius(1.5));
            FrameworkElementFactory ind = new FrameworkElementFactory(typeof(Border));
            ind.Name = "PART_Indicator";
            ind.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(ProgressBar.ForegroundProperty));
            ind.SetValue(Border.CornerRadiusProperty, new CornerRadius(1.5));
            track.AppendChild(ind);
            tpl.VisualTree = track;
            return tpl;
        }

        private static Button MakeButton(string text, Brush bg, Brush fg, Brush hoverBg, Brush borderBrush)
        {
            Button b = new Button();
            b.Content = text;
            b.Height = 34;
            b.FontSize = 12.5;
            b.Foreground = fg;
            b.Cursor = Cursors.Hand;
            ControlTemplate tpl = new ControlTemplate(typeof(Button));
            FrameworkElementFactory bd = new FrameworkElementFactory(typeof(Border));
            bd.Name = "bd";
            bd.SetValue(Border.BackgroundProperty, bg);
            bd.SetValue(Border.CornerRadiusProperty, new CornerRadius(4));
            if (borderBrush != null)
            {
                bd.SetValue(Border.BorderBrushProperty, borderBrush);
                bd.SetValue(Border.BorderThicknessProperty, new Thickness(1));
            }
            FrameworkElementFactory cp = new FrameworkElementFactory(typeof(ContentPresenter));
            cp.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
            cp.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
            bd.AppendChild(cp);
            tpl.VisualTree = bd;
            Trigger hover = new Trigger();
            hover.Property = UIElement.IsMouseOverProperty;
            hover.Value = true;
            hover.Setters.Add(new Setter(Border.BackgroundProperty, hoverBg, "bd"));
            tpl.Triggers.Add(hover);
            b.Template = tpl;
            return b;
        }

        private static ImageSource MakeIcon()
        {
            // 与 icon.ico 同款的"答题卡"：炭灰底座 + 白色答题卡 + 绿色对勾
            const int S = 64;
            using (System.Drawing.Bitmap bmp = new System.Drawing.Bitmap(S, S))
            using (System.Drawing.Graphics g = System.Drawing.Graphics.FromImage(bmp))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.Clear(System.Drawing.Color.Transparent);
                float k = S / 256f;
                g.ScaleTransform(k, k);
                System.Drawing.Color dark = System.Drawing.Color.FromArgb(38, 40, 44);
                System.Drawing.Color paper = System.Drawing.Color.FromArgb(232, 233, 235);
                System.Drawing.Color grey1 = System.Drawing.Color.FromArgb(185, 189, 197);
                System.Drawing.Color grey2 = System.Drawing.Color.FromArgb(201, 204, 209);
                System.Drawing.Color grey3 = System.Drawing.Color.FromArgb(221, 217, 207);
                System.Drawing.Color green = System.Drawing.Color.FromArgb(76, 195, 138);

                using (System.Drawing.Drawing2D.GraphicsPath p = RRect(16, 16, 224, 224, 52))
                using (System.Drawing.Brush b = new System.Drawing.SolidBrush(dark)) g.FillPath(b, p);
                using (System.Drawing.Drawing2D.GraphicsPath p = RRect(68, 52, 120, 152, 10))
                using (System.Drawing.Brush b = new System.Drawing.SolidBrush(paper)) g.FillPath(b, p);
                foreach (int y in new int[] { 86, 114 })
                {
                    using (System.Drawing.Brush b = new System.Drawing.SolidBrush(grey1)) g.FillEllipse(b, 87, y - 7, 14, 14);
                    using (System.Drawing.Drawing2D.GraphicsPath p = RRect(108, y - 4.5f, 56, 9, 4.5f))
                    using (System.Drawing.Brush b = new System.Drawing.SolidBrush(grey2)) g.FillPath(b, p);
                }
                using (System.Drawing.Brush b = new System.Drawing.SolidBrush(green)) g.FillEllipse(b, 84, 132, 20, 20);
                using (System.Drawing.Pen pen = new System.Drawing.Pen(System.Drawing.Color.White, 4))
                {
                    pen.StartCap = System.Drawing.Drawing2D.LineCap.Round;
                    pen.EndCap = System.Drawing.Drawing2D.LineCap.Round;
                    g.DrawLines(pen, new System.Drawing.PointF[] {
                        new System.Drawing.PointF(88, 142), new System.Drawing.PointF(93, 147), new System.Drawing.PointF(101, 137) });
                }
                using (System.Drawing.Drawing2D.GraphicsPath p = RRect(108, 137.5f, 56, 9, 4.5f))
                using (System.Drawing.Brush b = new System.Drawing.SolidBrush(grey2)) g.FillPath(b, p);
                using (System.Drawing.Drawing2D.GraphicsPath p = RRect(88, 168, 76, 9, 4.5f))
                using (System.Drawing.Brush b = new System.Drawing.SolidBrush(grey3)) g.FillPath(b, p);

                IntPtr h = bmp.GetHicon();
                try { return Imaging.CreateBitmapSourceFromHIcon(h, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions()); }
                finally { DestroyIcon(h); }
            }
        }

        private static System.Drawing.Drawing2D.GraphicsPath RRect(float x, float y, float w, float h, float r)
        {
            System.Drawing.Drawing2D.GraphicsPath p = new System.Drawing.Drawing2D.GraphicsPath();
            float d = r * 2;
            p.AddArc(x, y, d, d, 180, 90);
            p.AddArc(x + w - d, y, d, d, 270, 90);
            p.AddArc(x + w - d, y + h - d, d, d, 0, 90);
            p.AddArc(x, y + h - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        private void UI(Action a)
        {
            try
            {
                if (Dispatcher.CheckAccess()) a();
                else Dispatcher.BeginInvoke(a);
            }
            catch { }
        }

        public void SetProgress(string status, double target)
        {
            UI(delegate
            {
                barTarget = target;
                statusSub.Text = status;
                if (!barTimer.IsEnabled) barTimer.Start();
            });
        }

        /// 启动完成、浏览器尚未打开：等用户点「打开练习页面」
        public void ShowReady(string url, string warn)
        {
            UI(delegate
            {
                homeUrl = url;
                barTimer.Stop();
                startingPanel.Visibility = Visibility.Collapsed;
                runningPanel.Visibility = Visibility.Visible;
                dot.Fill = C("#4CC38A");
                runStatus.Text = "已就绪，点击下方按钮开始练习";
                addrText.Text = url;
                if (!string.IsNullOrEmpty(warn))
                {
                    warnText.Text = warn;
                    warnText.Visibility = Visibility.Visible;
                }
                footText.Text = "仅在本机运行 · 不会联网 · 关闭窗口即退出";
            });
        }

        public void ShowRunning(string url, string warn)
        {
            UI(delegate
            {
                homeUrl = url;
                barTimer.Stop();
                startingPanel.Visibility = Visibility.Collapsed;
                runningPanel.Visibility = Visibility.Visible;
                dot.Fill = C("#4CC38A");
                runStatus.Text = "运行中，页面已在浏览器打开";
                addrText.Text = url;
                if (!string.IsNullOrEmpty(warn))
                {
                    warnText.Text = warn;
                    warnText.Visibility = Visibility.Visible;
                }
                footText.Text = "仅在本机运行 · 不会联网 · 关闭窗口即退出";
            });
        }

        public void ShowAlreadyRunning(string url, bool opened)
        {
            UI(delegate
            {
                homeUrl = url;
                barTimer.Stop();
                startingPanel.Visibility = Visibility.Collapsed;
                runningPanel.Visibility = Visibility.Visible;
                dot.Fill = C("#4CC38A");
                runStatus.Text = opened ? "模拟器已在运行，已为你打开练习页面" : "模拟器已在运行，已把它的窗口带到前台";
                addrText.Text = url;
                exitBtn.Content = "关闭此窗口";
                if (!opened)
                {
                    hintText.Text = "要打开练习页面，请在已运行的那个窗口上点「打开练习页面」。";
                    hintText.Visibility = Visibility.Visible;
                }
                footText.Text = "仅在本机运行 · 不会联网";
            });
        }

        public void ShowError(string title, string detail)
        {
            UI(delegate
            {
                errorState = true;
                barTimer.Stop();
                startingPanel.Visibility = Visibility.Collapsed;
                runningPanel.Visibility = Visibility.Visible;
                dot.Fill = C("#E05252");
                runStatus.Text = title;
                runStatus.Foreground = C("#E8B4B4");
                addrText.Text = "";
                warnText.Text = detail;
                warnText.Foreground = C("#7A7F88");
                warnText.Visibility = Visibility.Visible;
                actionBtn.Content = "查看日志";
                exitBtn.Content = "退出程序";
                footText.Text = "详细原因已写入日志文件";
            });
        }

        public void BringToFront()
        {
            UI(delegate
            {
                if (!IsVisible) return;
                if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
                Activate();
                Topmost = true;
                Topmost = false;
            });
        }

        public void CloseFromThread()
        {
            UI(delegate { Close(); });
        }

        private void OpenLogFile()
        {
            try { if (logPath != null) Process.Start("notepad.exe", "\"" + logPath + "\""); } catch { }
        }
    }

    /* ---------------- 端口与实例 ---------------- */

    private static IEnumerable<int> PortCandidates(int startPort)
    {
        for (int p = startPort; p < startPort + 20 && p < 65536; p++) yield return p;
        // Hyper-V/WSL/Docker 会成段（通常 100 个）保留端口，换到远处的段再试
        for (int p = 27301; p < 27311; p++) yield return p;
        for (int p = 37301; p < 37311; p++) yield return p;
        yield return 0;
    }

    private static TcpListener TryListen(int port, out bool busy, out string err)
    {
        busy = false; err = null;
        TcpListener l = new TcpListener(IPAddress.Loopback, port);
        try
        {
            // 不设 ExclusiveAddressUse：服务端主动断开会留下 TIME_WAIT，设了之后关窗立刻重开会绑不上 17301
            l.Start();
            return l;
        }
        catch (SocketException ex)
        {
            busy = ex.SocketErrorCode == SocketError.AddressAlreadyInUse;
            err = ex.SocketErrorCode + "(" + ex.ErrorCode + ") " + ex.Message;
            try { l.Stop(); } catch { }
            return null;
        }
    }

    private static string PortFilePath()
    {
        return Path.Combine(Path.GetTempPath(), "CBT模拟器_" + identity + ".port");
    }

    private static void WritePortFile(int port)
    {
        try { File.WriteAllText(PortFilePath(), port.ToString(CultureInfo.InvariantCulture)); }
        catch (Exception ex) { Log("写端口文件失败: " + ex.Message); }
    }

    private static int WaitForOwnInstance(int timeoutMs)
    {
        Stopwatch sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            int p = 0;
            try { p = int.Parse(File.ReadAllText(PortFilePath()).Trim(), CultureInfo.InvariantCulture); } catch { }
            if (p > 0 && IsMine(ProbeMarker(p, 300, 1500))) return p;
            if (IsMine(ProbeMarker(DefaultPort, 300, 1500))) return DefaultPort;
            Thread.Sleep(250);
        }
        return 0;
    }

    private static bool IsMine(string markerValue)
    {
        if (markerValue == null) return false;
        if (markerValue == "1") return true;   // v2 及更早版本没有标识，按"自己"处理
        return markerValue.IndexOf("id=" + identity, StringComparison.Ordinal) >= 0;
    }

    /// 返回对方 X-CBT-Simulator 头的值；不是本程序或连不上返回 null
    private static string ProbeMarker(int port, int connectMs, int readMs)
    {
        try
        {
            using (TcpClient c = new TcpClient())
            {
                IAsyncResult ar = c.BeginConnect(IPAddress.Loopback, port, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(connectMs)) return null;
                c.EndConnect(ar);
                c.ReceiveTimeout = readMs;
                c.SendTimeout = readMs;
                using (NetworkStream ns = c.GetStream())
                {
                    byte[] req = Encoding.ASCII.GetBytes("HEAD / HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\nConnection: close\r\n\r\n");
                    ns.Write(req, 0, req.Length);
                    byte[] buf = new byte[4096];
                    int total = 0, n;
                    while (total < buf.Length && (n = ns.Read(buf, total, buf.Length - total)) > 0) total += n;
                    string head = Encoding.ASCII.GetString(buf, 0, total);
                    foreach (string line in head.Split(new string[] { "\r\n" }, StringSplitOptions.None))
                    {
                        if (line.StartsWith(Marker + ":", StringComparison.OrdinalIgnoreCase))
                            return line.Substring(Marker.Length + 1).Trim();
                    }
                    return null;
                }
            }
        }
        catch { return null; }
    }

    private static string Fnv(string s)
    {
        uint h = 2166136261;
        foreach (byte b in Encoding.UTF8.GetBytes(s ?? "")) { h ^= b; h *= 16777619; }
        return h.ToString("x8", CultureInfo.InvariantCulture);
    }

    /* ---------------- 控制台 / 日志 ---------------- */

    private static void SetupConsole()
    {
        try
        {
            int cp = Console.OutputEncoding.CodePage;
            // GBK/GB18030 控制台能直接显示中文，保持不动（也不会改掉用户 cmd 的代码页）；其余统一 UTF-8
            if (selfTest || (cp != 936 && cp != 54936)) Console.OutputEncoding = new UTF8Encoding(false);
        }
        catch { }
        try { Console.Title = "英语机考模拟器"; } catch { }
        try
        {
            IntPtr h = GetStdHandle(-10);
            uint mode;
            if (GetConsoleMode(h, out mode)) SetConsoleMode(h, (mode & ~0x40u) | 0x80u);   // 关"快速编辑"，否则点一下窗口所有输出都会被挂起
        }
        catch { }
    }

    private static void InitLog()
    {
        List<string> candidates = new List<string>();
        try { candidates.Add(Path.Combine(Path.GetDirectoryName(SafeExePath()) ?? ".", "启动日志.txt")); } catch { }
        try { candidates.Add(Path.Combine(Path.GetTempPath(), "CBT模拟器_启动日志.txt")); } catch { }
        foreach (string c in candidates)
        {
            try
            {
                FileInfo fi = new FileInfo(c);
                if (fi.Exists && fi.Length > 512 * 1024) File.WriteAllText(c, "", Encoding.UTF8);
                File.AppendAllText(c, "", Encoding.UTF8);
                logPath = c;
                return;
            }
            catch { }
        }
    }

    private static void Log(string s)
    {
        if (logPath == null) return;
        lock (Files)
        {
            try { File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + "  " + s + Environment.NewLine, Encoding.UTF8); }
            catch { }
        }
    }

    private static string SafeExePath()
    {
        try { return Assembly.GetExecutingAssembly().Location ?? "?"; } catch { return "?"; }
    }

    private static void Line(string s)
    {
        if (quiet && s.StartsWith("  ")) return;
        try { Console.WriteLine(s); Console.Out.Flush(); } catch { }
    }

    private static void Pause()
    {
        Line("");
        Line("按任意键退出…");
        try { Console.ReadKey(true); } catch { }
    }

    /* ---------------- 自检 ---------------- */

    private static int SelfTest(int startPort)
    {
        Console.WriteLine("== 自检：内嵌资源 + HTTP 服务 ==");
        Console.WriteLine("完整性级别: " + IntegrityName(IntegrityRid()) + "（Low / Untrusted = 被受限权限启动，无法自动打开浏览器）");
        LoadEmbeddedFiles();
        Console.WriteLine("内嵌资源 " + Files.Count + " 个：" + string.Join(", ", new List<string>(Files.Keys).ToArray()));

        bool busy;
        string err;
        TcpListener listener = TryListen(startPort, out busy, out err);
        if (listener == null)
        {
            Console.WriteLine("端口 " + startPort + " 不可用（" + err + "），改用系统分配端口");
            listener = TryListen(0, out busy, out err);
            if (listener == null) { Console.WriteLine("FAIL  无法监听任何本地端口：" + err); return 1; }
        }
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        Thread th = new Thread(delegate() { AcceptLoop(listener); });
        th.IsBackground = true;
        th.Start();
        Console.WriteLine("已监听 127.0.0.1:" + port + "，开始自测…");

        int fail = 0;
        foreach (string path in new string[] { "/", "/index.html", "/nope/spa/route" })
            fail += Check(port, path, "200", "text/html; charset=utf-8", true, null);
        foreach (string k in new List<string>(Files.Keys))
        {
            string mime = MimeOf(k);
            if (mime.StartsWith("application/javascript") || mime.StartsWith("text/css"))
                fail += Check(port, k, "200", mime, false, null);
        }
        fail += Check(port, "/assets/not-exist.js", "404", null, false, null);
        fail += Check(port, "/", "403", null, false, "evil.example.com");
        bool det = IsMine(ProbeMarker(port, 1000, 2000));
        Console.WriteLine((det ? "PASS" : "FAIL") + "  实例检测 → " + det);
        if (!det) fail++;
        fail += CheckStoreApi(port);
        listener.Stop();
        Console.WriteLine(fail == 0 ? "== 自检全部通过 ==" : "== 自检有 " + fail + " 项失败 ==");
        return fail == 0 ? 0 : 1;
    }

    /// 数据接口自检：ping → 媒体写入 → 读回校验内容与 MIME → 删除 → 确认 404。只动 _selftest 目录，不碰真实数据。
    private static int CheckStoreApi(int port)
    {
        int fail = 0;
        Console.WriteLine("数据目录: " + (storeReady ? dataRoot : "(不可用)"));
        if (!storeReady)
        {
            Console.WriteLine("FAIL  本地数据目录不可写（/api 将返回 503，题库/记录只保存在浏览器里）");
            return 1;
        }
        fail += ApiReq(port, "GET", "/api/store/ping", null, null, "200", "X-CBT-Store: 1", "\"ok\":true") ? 0 : 1;
        byte[] payload = Encoding.UTF8.GetBytes("store-api-probe");
        fail += ApiReq(port, "PUT", "/api/media/_selftest/probe.bin", "application/octet-stream", payload, "200", "X-CBT-Store: 1", "\"ok\":true") ? 0 : 1;
        fail += ApiReq(port, "GET", "/api/media/_selftest/probe.bin", null, null, "200", "application/octet-stream", "store-api-probe") ? 0 : 1;
        fail += ApiReq(port, "DELETE", "/api/media/_selftest", null, null, "200", null, "\"ok\":true") ? 0 : 1;
        fail += ApiReq(port, "GET", "/api/media/_selftest/probe.bin", null, null, "404", null, null) ? 0 : 1;
        fail += ApiReq(port, "PUT", "/api/notes/_selftest", null, Encoding.UTF8.GetBytes("{\"notes\":[]}"), "200", null, "\"ok\":true") ? 0 : 1;
        fail += ApiReq(port, "GET", "/api/notes/_selftest", null, null, "200", null, "\"notes\":[]") ? 0 : 1;
        fail += ApiReq(port, "GET", "/api/notes", null, null, "200", null, "_selftest") ? 0 : 1;
        fail += ApiReq(port, "DELETE", "/api/notes/_selftest", null, null, "200", null, "\"ok\":true") ? 0 : 1;
        fail += ApiReq(port, "GET", "/api/wordbook", null, null, "200", null, null) ? 0 : 1;   // 只读，不能 PUT——会覆盖用户真实的词汇句子册
        fail += ApiReq(port, "PUT", "/api/lnotes/_selftest", null, Encoding.UTF8.GetBytes("{\"sentences\":[]}"), "200", null, "\"ok\":true") ? 0 : 1;
        fail += ApiReq(port, "GET", "/api/lnotes/_selftest", null, null, "200", null, "\"sentences\":[]") ? 0 : 1;
        fail += ApiReq(port, "DELETE", "/api/lnotes/_selftest", null, null, "200", null, "\"ok\":true") ? 0 : 1;
        fail += ApiReq(port, "GET", "/api/lwords", null, null, "200", null, null) ? 0 : 1;    // 同理只读
        // 写作答卷：只动 _selftest 这个 recordId，绝不读写真实答卷
        fail += ApiReq(port, "PUT", "/api/writing/_selftest", null, Encoding.UTF8.GetBytes("{\"version\":1,\"recordId\":\"_selftest\",\"tasks\":[]}"), "200", null, "\"ok\":true") ? 0 : 1;
        fail += ApiReq(port, "GET", "/api/writing/_selftest", null, null, "200", null, "\"recordId\":\"_selftest\"") ? 0 : 1;
        fail += ApiReq(port, "GET", "/api/writing", null, null, "200", null, "_selftest") ? 0 : 1;
        fail += ApiReq(port, "DELETE", "/api/writing/_selftest", null, null, "200", null, "\"ok\":true") ? 0 : 1;
        fail += ApiReq(port, "GET", "/api/writing/_selftest", null, null, "404", null, null) ? 0 : 1;
        // 学习数据：GET 只读（不覆盖用户真实文件）；PUT 用 version=2 验证会被拒绝且不落盘
        fail += ApiReq(port, "GET", "/api/store/learning", null, null, "200", null, "\"reviewItems\"") ? 0 : 1;
        fail += ApiReq(port, "PUT", "/api/store/learning", null, Encoding.UTF8.GetBytes("{\"version\":2}"), "400", null, null) ? 0 : 1;
        return fail;
    }

    /// 发一个带方法/请求体的原始请求，核对状态码、响应头包含串、响应体包含串；PASS/FAIL 打印并返回是否通过
    private static bool ApiReq(int port, string method, string path, string mime, byte[] payload, string wantStatus, string wantHeader, string wantInBody)
    {
        try
        {
            using (TcpClient c = new TcpClient())
            {
                c.Connect(IPAddress.Loopback, port);
                using (NetworkStream ns = c.GetStream())
                {
                    ns.ReadTimeout = 5000;
                    StringBuilder sb = new StringBuilder();
                    sb.Append(method).Append(' ').Append(path).Append(" HTTP/1.1\r\n");
                    sb.Append("Host: 127.0.0.1:").Append(port).Append("\r\n");
                    if (payload != null)
                    {
                        sb.Append("Content-Length: ").Append(payload.Length).Append("\r\n");
                        if (mime != null) sb.Append("X-Mime-Type: ").Append(mime).Append("\r\n");
                    }
                    sb.Append("Connection: close\r\n\r\n");
                    byte[] headBytes = Encoding.ASCII.GetBytes(sb.ToString());
                    ns.Write(headBytes, 0, headBytes.Length);
                    if (payload != null) ns.Write(payload, 0, payload.Length);
                    MemoryStream ms = new MemoryStream();
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = ns.Read(buf, 0, buf.Length)) > 0) ms.Write(buf, 0, n);
                    string raw = Encoding.UTF8.GetString(ms.ToArray());
                    bool ok = raw.StartsWith("HTTP/1.1 " + wantStatus, StringComparison.Ordinal)
                              && (wantHeader == null || raw.IndexOf(wantHeader, StringComparison.OrdinalIgnoreCase) >= 0)
                              && (wantInBody == null || raw.IndexOf(wantInBody, StringComparison.Ordinal) >= 0);
                    Console.WriteLine((ok ? "PASS" : "FAIL") + "  " + method + " " + path + " → " + wantStatus
                        + (wantHeader != null ? " | 头含 " + wantHeader : "") + (wantInBody != null ? " | 体含 " + wantInBody : ""));
                    return ok;
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("FAIL  " + method + " " + path + " → 异常 " + ex.Message);
            return false;
        }
    }

    private static int Check(int port, string path, string wantStatus, string wantMime, bool wantIndex, string host)
    {
        try
        {
            using (TcpClient c = new TcpClient())
            {
                c.Connect(IPAddress.Loopback, port);
                using (NetworkStream ns = c.GetStream())
                {
                    ns.ReadTimeout = 3000;
                    byte[] req = Encoding.ASCII.GetBytes("GET " + path + " HTTP/1.1\r\nHost: " + (host ?? "127.0.0.1:" + port) + "\r\nConnection: close\r\n\r\n");
                    ns.Write(req, 0, req.Length);
                    MemoryStream ms = new MemoryStream();
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = ns.Read(buf, 0, buf.Length)) > 0) ms.Write(buf, 0, n);
                    string raw = Encoding.ASCII.GetString(ms.ToArray());
                    int split = raw.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                    string head = split > 0 ? raw.Substring(0, split) : raw;
                    bool ok = head.StartsWith("HTTP/1.1 " + wantStatus, StringComparison.Ordinal)
                              && (wantMime == null || head.IndexOf(wantMime, StringComparison.OrdinalIgnoreCase) >= 0)
                              && (!wantIndex || raw.IndexOf("<!doctype html", StringComparison.OrdinalIgnoreCase) >= 0);
                    Console.WriteLine((ok ? "PASS" : "FAIL") + "  GET " + path + (host != null ? " (Host: " + host + ")" : "") + " → " + wantStatus + " " + (wantMime ?? "") + " | " + Math.Max(0, ms.Length - split - 4) + " B");
                    return ok ? 0 : 1;
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("FAIL  GET " + path + " → 异常 " + ex.Message);
            return 1;
        }
    }

    /* ---------------- 内嵌资源 ---------------- */

    private static void LoadEmbeddedFiles()
    {
        if (Files.Count > 0) return;
        Assembly asm = Assembly.GetExecutingAssembly();
        string map = null;
        using (Stream s = asm.GetManifestResourceStream("webmap"))
        {
            if (s != null) using (StreamReader r = new StreamReader(s, Encoding.UTF8)) map = r.ReadToEnd();
        }
        if (string.IsNullOrEmpty(map)) throw new InvalidOperationException("缺少内嵌资源清单（webmap）");
        foreach (string raw in map.Split('\n'))
        {
            string line = raw.Trim();
            if (line.Length == 0 || line[0] == '#') continue;
            int eq = line.IndexOf('=');
            if (eq <= 0) continue;
            string res = line.Substring(0, eq).Trim();
            string path = Normalize(line.Substring(eq + 1).Trim());
            using (Stream s = asm.GetManifestResourceStream(res))
            {
                if (s == null) continue;
                using (MemoryStream ms = new MemoryStream())
                {
                    s.CopyTo(ms);
                    Files[path] = ms.ToArray();
                }
            }
        }
        if (!Files.ContainsKey("/index.html")) throw new InvalidOperationException("内嵌资源里没有 index.html");
    }

    private static string Normalize(string path)
    {
        if (string.IsNullOrEmpty(path) || path == "/") return "/index.html";
        path = path.Replace('\\', '/');
        if (path[0] != '/') path = "/" + path;
        return path;
    }

    /* ---------------- 本地数据文件夹（题库 + 练习记录落在 exe 同目录） ----------------
       布局：
         导入题目\数据\tests.json     解析后的题库（整量 JSON，前端每次变更后镜像写回）
         导入题目\媒体\<题包id>\...   听力音频、题图（二进制 + .mime 旁注文件）
         导入题目\题包\<文件名>.zip   每次导入时留一份题包原件
         做题记录\records.json        全部练习记录（整量 JSON）
       浏览器里的 localStorage/IndexedDB 仍是工作缓存；文件夹才是长期存放处，
       换浏览器/换端口/清浏览器数据后，页面打开时会从文件夹恢复。 */

    private static string TestsJsonPath() { return Path.Combine(dataRoot, "导入题目", "数据", "tests.json"); }
    private static string HistoryJsonPath() { return Path.Combine(dataRoot, "做题记录", "records.json"); }
    private static string MediaRoot() { return Path.Combine(dataRoot, "导入题目", "媒体"); }
    private static string PackRoot() { return Path.Combine(dataRoot, "导入题目", "题包"); }
    private static string NotesRoot() { return Path.Combine(dataRoot, "精读记录"); }                 // 每篇阅读一个 <key>.json
    private static string WordbookPath() { return Path.Combine(dataRoot, "精读记录", "词汇句子册.json"); }
    private static string LNotesRoot() { return Path.Combine(dataRoot, "精听记录"); }                // 每篇听力一个 <key>.json
    private static string LWordsPath() { return Path.Combine(dataRoot, "精听记录", "生词本.json"); }
    private static string WritingRoot() { return Path.Combine(dataRoot, "做题记录", "写作"); }       // 每场写作一个 <recordId>.json
    private static string LearningPath() { return Path.Combine(dataRoot, "做题记录", "学习数据.json"); } // 错题复盘 + 词汇进度

    private static void InitStore()
    {
        List<string> roots = new List<string>();
        try { roots.Add(Path.GetDirectoryName(SafeExePath()) ?? "."); } catch { }
        roots.Add(Path.Combine(Path.GetTempPath(), "CBT模拟器_数据"));
        foreach (string r in roots)
        {
            try
            {
                Directory.CreateDirectory(Path.Combine(r, "导入题目", "数据"));
                Directory.CreateDirectory(Path.Combine(r, "导入题目", "媒体"));
                Directory.CreateDirectory(Path.Combine(r, "导入题目", "题包"));
                Directory.CreateDirectory(Path.Combine(r, "做题记录"));
                Directory.CreateDirectory(Path.Combine(r, "做题记录", "写作"));
                Directory.CreateDirectory(Path.Combine(r, "精读记录"));
                Directory.CreateDirectory(Path.Combine(r, "精听记录"));
                string probe = Path.Combine(r, "导入题目", "数据", ".probe");
                File.WriteAllText(probe, "", Encoding.UTF8);
                File.Delete(probe);
                dataRoot = r;
                storeReady = true;
                Log("本地数据目录: " + r);
                return;
            }
            catch (Exception ex) { Log("数据目录不可用: " + r + "（" + ex.Message + "）"); }
        }
        Log("× 没有可写的本地数据目录：题库与练习记录将只保存在浏览器里（旧行为）");
    }

    /// 路径段白名单：题包 id 与媒体键只由这些字符构成；别的（含 .. / \）一律拒绝
    private static bool SafeSeg(string s)
    {
        if (string.IsNullOrEmpty(s) || s.Length > 80) return false;
        if (s == "." || s == "..") return false;
        foreach (char c in s)
        {
            bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-';
            if (!ok) return false;
        }
        return true;
    }

    /// 写入先落 .tmp 再改名，避免写到一半被强杀留下半个 JSON
    private static void AtomicWrite(string path, byte[] data)
    {
        string tmp = path + ".tmp";
        File.WriteAllBytes(tmp, data);
        try { File.Replace(tmp, path, null); }
        catch { try { if (File.Exists(path)) File.Delete(path); } catch { } File.Move(tmp, path); }
    }

    /// 学习数据的空结构（文件还不存在时 GET 返回它，前端不需要额外判断 null）
    private static string EmptyLearningJson()
    {
        return "{\"version\":1,\"reviewItems\":[],\"vocabularyProgress\":[],\"processedRecordIds\":[],\"updatedAt\":0}";
    }

    /// PUT /api/store/learning 校验：必须是 JSON 对象且 version=1；三个数组字段可以缺省（前端有默认值），
    /// 但只要给出就必须是数组，避免把错格式写进用户文件。
    private static bool IsLearningJson(byte[] data)
    {
        if (data == null || data.Length == 0 || data[0] != (byte)'{') return false;
        try
        {
            JavaScriptSerializer js = new JavaScriptSerializer();
            js.MaxJsonLength = int.MaxValue;
            Dictionary<string, object> d = js.DeserializeObject(Encoding.UTF8.GetString(data)) as Dictionary<string, object>;
            if (d == null) return false;
            object ver;
            if (!d.TryGetValue("version", out ver) || ver == null) return false;
            if (Convert.ToInt32(ver, CultureInfo.InvariantCulture) != 1) return false;
            foreach (string key in new string[] { "reviewItems", "vocabularyProgress", "processedRecordIds" })
            {
                object v;
                if (d.TryGetValue(key, out v) && v != null && !(v is object[])) return false;
            }
            return true;
        }
        catch { return false; }
    }

    /// 从题库整量 JSON 里挑出所有题包 id（用于清理已删题包的媒体目录）；解析失败返回空集
    private static HashSet<string> TestIdsFromJson(byte[] jsonBytes)
    {
        HashSet<string> ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            JavaScriptSerializer js = new JavaScriptSerializer();
            js.MaxJsonLength = int.MaxValue;
            object[] arr = js.DeserializeObject(Encoding.UTF8.GetString(jsonBytes)) as object[];
            if (arr == null) return ids;
            foreach (object o in arr)
            {
                Dictionary<string, object> d = o as Dictionary<string, object>;
                if (d == null) continue;
                object id;
                if (d.TryGetValue("id", out id) && id != null)
                {
                    string s = Convert.ToString(id, CultureInfo.InvariantCulture);
                    if (SafeSeg(s)) ids.Add(s);
                }
            }
        }
        catch { }
        return ids;
    }

    /// 媒体目录里凡是已不在题库里的题包 id，整个目录清掉
    private static void CleanupMedia(byte[] testsJson)
    {
        try
        {
            HashSet<string> alive = TestIdsFromJson(testsJson);
            string root = MediaRoot();
            if (!Directory.Exists(root)) return;
            foreach (string dir in Directory.GetDirectories(root))
            {
                string name = Path.GetFileName(dir);
                if (name == "_selftest") continue;
                if (!alive.Contains(name)) { Directory.Delete(dir, true); Log("清理已删题包的媒体目录: " + name); }
            }
        }
        catch (Exception ex) { Log("清理媒体目录失败: " + ex.Message); }
    }

    private static int IndexOfHeadEnd(byte[] buf, int len)
    {
        for (int i = 0; i + 3 < len; i++)
            if (buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10) return i;
        return -1;
    }

    private static void WriteResponse(NetworkStream ns, string status, string contentType, byte[] body, bool headOnly, bool api)
    {
        StringBuilder head = new StringBuilder();
        head.Append("HTTP/1.1 ").Append(status).Append("\r\n");
        head.Append("Content-Type: ").Append(contentType).Append("\r\n");
        head.Append("Content-Length: ").Append(body.Length).Append("\r\n");
        head.Append("Cache-Control: no-store, no-cache, must-revalidate\r\n");
        head.Append("Pragma: no-cache\r\n");
        head.Append("X-Content-Type-Options: nosniff\r\n");
        head.Append(Marker).Append(": 3; id=").Append(identity).Append("\r\n");
        if (api) head.Append("X-CBT-Store: 1\r\n");
        head.Append("Connection: close\r\n\r\n");
        byte[] headBytes = Encoding.ASCII.GetBytes(head.ToString());
        ns.Write(headBytes, 0, headBytes.Length);
        if (!headOnly && body.Length > 0) ns.Write(body, 0, body.Length);
        ns.Flush();
    }

    private static byte[] JsonBytes(string s) { return Encoding.UTF8.GetBytes(s); }
    private static byte[] JsonErr(string msg)
    {
        return JsonBytes("{\"ok\":false,\"error\":" + new JavaScriptSerializer().Serialize(msg) + "}");
    }

    /// /api/ 路由：题库与练习记录读写、媒体二进制存取、题包原件留存。所有响应带 X-CBT-Store: 1（前端据此判定功能可用）。
    private static void ServeApi(NetworkStream ns, string method, bool headOnly, string path, string mimeHeader, MemoryStream bodyMs)
    {
        string status = "200 OK";
        string mime = "application/json; charset=utf-8";
        byte[] body = null;
        try
        {
            if (!storeReady)
            {
                status = "503 Service Unavailable";
                body = JsonErr("本地数据目录不可写，题库与记录只保存在浏览器里");
            }
            else if (path.Equals("/api/store/ping", StringComparison.OrdinalIgnoreCase) && method == "GET")
            {
                body = JsonBytes(new JavaScriptSerializer().Serialize(new Dictionary<string, object>
                    { { "ok", true }, { "version", 1 }, { "dir", dataRoot } }));
            }
            else if (path.Equals("/api/store/tests", StringComparison.OrdinalIgnoreCase) && method == "GET")
            {
                body = File.Exists(TestsJsonPath()) ? File.ReadAllBytes(TestsJsonPath()) : JsonBytes("[]");
            }
            else if (path.Equals("/api/store/tests", StringComparison.OrdinalIgnoreCase) && method == "PUT")
            {
                byte[] data = bodyMs != null ? bodyMs.ToArray() : new byte[0];
                if (data.Length == 0 || data[0] != (byte)'[') { status = "400 Bad Request"; body = JsonErr("题库数据必须是 JSON 数组"); }
                else
                {
                    AtomicWrite(TestsJsonPath(), data);
                    CleanupMedia(data);
                    body = JsonBytes("{\"ok\":true}");
                }
            }
            else if (path.Equals("/api/store/history", StringComparison.OrdinalIgnoreCase) && method == "GET")
            {
                body = File.Exists(HistoryJsonPath()) ? File.ReadAllBytes(HistoryJsonPath()) : JsonBytes("[]");
            }
            else if (path.Equals("/api/store/history", StringComparison.OrdinalIgnoreCase) && method == "PUT")
            {
                byte[] data = bodyMs != null ? bodyMs.ToArray() : new byte[0];
                if (data.Length == 0 || data[0] != (byte)'[') { status = "400 Bad Request"; body = JsonErr("练习记录必须是 JSON 数组"); }
                else { AtomicWrite(HistoryJsonPath(), data); body = JsonBytes("{\"ok\":true}"); }
            }
            else if (path.Equals("/api/store/learning", StringComparison.OrdinalIgnoreCase) && method == "GET")
            {
                body = File.Exists(LearningPath()) ? File.ReadAllBytes(LearningPath()) : JsonBytes(EmptyLearningJson());
            }
            else if (path.Equals("/api/store/learning", StringComparison.OrdinalIgnoreCase) && method == "PUT")
            {
                byte[] data = bodyMs != null ? bodyMs.ToArray() : new byte[0];
                if (!IsLearningJson(data)) { status = "400 Bad Request"; body = JsonErr("学习数据必须是 version=1 的 JSON 对象"); }
                else { AtomicWrite(LearningPath(), data); body = JsonBytes("{\"ok\":true}"); }
            }
            else if (path.Equals("/api/writing", StringComparison.OrdinalIgnoreCase) && method == "GET")
            {
                // 列出全部写作答卷 recordId（文件名去 .json）
                List<string> ids = new List<string>();
                string wdir = WritingRoot();
                if (Directory.Exists(wdir))
                    foreach (string f in Directory.GetFiles(wdir, "*.json"))
                    {
                        string k = Path.GetFileNameWithoutExtension(f);
                        if (SafeSeg(k)) ids.Add(k);
                    }
                ids.Sort(StringComparer.OrdinalIgnoreCase);
                body = JsonBytes(new JavaScriptSerializer().Serialize(ids));
            }
            else if (path.StartsWith("/api/writing/", StringComparison.OrdinalIgnoreCase))
            {
                string id = path.Substring("/api/writing/".Length);
                string f = SafeSeg(id) ? Path.Combine(WritingRoot(), id + ".json") : null;
                if (f == null) { status = "400 Bad Request"; body = JsonErr("写作答卷 recordId 不合法"); }
                else if (method == "GET")
                {
                    if (!File.Exists(f)) { status = "404 Not Found"; body = JsonErr("写作答卷不存在"); }
                    else body = File.ReadAllBytes(f);
                }
                else if (method == "PUT")
                {
                    byte[] data = bodyMs != null ? bodyMs.ToArray() : new byte[0];
                    if (data.Length == 0 || data[0] != (byte)'{') { status = "400 Bad Request"; body = JsonErr("写作答卷必须是 JSON 对象"); }
                    else { AtomicWrite(f, data); body = JsonBytes("{\"ok\":true}"); }
                }
                else if (method == "DELETE")
                {
                    if (File.Exists(f)) File.Delete(f);
                    body = JsonBytes("{\"ok\":true}");
                }
                else { status = "405 Method Not Allowed"; body = JsonErr("不支持的方法"); }
            }
            else if (path.StartsWith("/api/media/", StringComparison.OrdinalIgnoreCase))
            {
                string[] segs = path.Substring("/api/media/".Length).Split('/');
                if (method == "PUT" && segs.Length == 2 && SafeSeg(segs[0]) && SafeSeg(segs[1]))
                {
                    string dir = Path.Combine(MediaRoot(), segs[0]);
                    Directory.CreateDirectory(dir);
                    File.WriteAllBytes(Path.Combine(dir, segs[1]), bodyMs != null ? bodyMs.ToArray() : new byte[0]);
                    string mt = SafeMime(mimeHeader);
                    if (mt != null) File.WriteAllText(Path.Combine(dir, segs[1] + ".mime"), mt, Encoding.ASCII);
                    body = JsonBytes("{\"ok\":true}");
                }
                else if (method == "GET" && segs.Length == 2 && SafeSeg(segs[0]) && SafeSeg(segs[1]))
                {
                    string f = Path.Combine(MediaRoot(), segs[0], segs[1]);
                    if (!File.Exists(f)) { status = "404 Not Found"; body = JsonErr("媒体不存在"); }
                    else
                    {
                        body = File.ReadAllBytes(f);
                        string mf = f + ".mime";
                        mime = File.Exists(mf) ? File.ReadAllText(mf, Encoding.ASCII).Trim() : "application/octet-stream";
                    }
                }
                else if (method == "DELETE" && segs.Length == 1 && SafeSeg(segs[0]))
                {
                    string dir = Path.Combine(MediaRoot(), segs[0]);
                    if (Directory.Exists(dir)) Directory.Delete(dir, true);
                    body = JsonBytes("{\"ok\":true}");
                }
                else { status = "400 Bad Request"; body = JsonErr("媒体路径不合法"); }
            }
            else if (path.StartsWith("/api/pack/", StringComparison.OrdinalIgnoreCase) && method == "PUT")
            {
                string name = SafeFileName(path.Substring("/api/pack/".Length));
                if (name == null) { status = "400 Bad Request"; body = JsonErr("文件名不合法"); }
                else
                {
                    File.WriteAllBytes(Path.Combine(PackRoot(), name), bodyMs != null ? bodyMs.ToArray() : new byte[0]);
                    body = JsonBytes("{\"ok\":true,\"name\":" + new JavaScriptSerializer().Serialize(name) + "}");
                }
            }
            else if (path.Equals("/api/wordbook", StringComparison.OrdinalIgnoreCase) && method == "GET")
            {
                body = File.Exists(WordbookPath()) ? File.ReadAllBytes(WordbookPath()) : JsonBytes("[]");
            }
            else if (path.Equals("/api/wordbook", StringComparison.OrdinalIgnoreCase) && method == "PUT")
            {
                byte[] data = bodyMs != null ? bodyMs.ToArray() : new byte[0];
                if (data.Length == 0 || data[0] != (byte)'[') { status = "400 Bad Request"; body = JsonErr("词汇句子册必须是 JSON 数组"); }
                else { AtomicWrite(WordbookPath(), data); body = JsonBytes("{\"ok\":true}"); }
            }
            else if (path.Equals("/api/notes", StringComparison.OrdinalIgnoreCase) && method == "GET")
            {
                // 列出全部精读文件的 key（去掉 .json 后缀），前端据此渲染首页「精读记录」列表
                List<string> keys = new List<string>();
                string dir = NotesRoot();
                if (Directory.Exists(dir))
                    foreach (string f in Directory.GetFiles(dir, "*.json"))
                    {
                        string k = Path.GetFileNameWithoutExtension(f);
                        if (SafeSeg(k)) keys.Add(k);
                    }
                keys.Sort(StringComparer.OrdinalIgnoreCase);
                body = JsonBytes(new JavaScriptSerializer().Serialize(keys));
            }
            else if (path.StartsWith("/api/notes/", StringComparison.OrdinalIgnoreCase))
            {
                string key = path.Substring("/api/notes/".Length);
                string f = SafeSeg(key) ? Path.Combine(NotesRoot(), key + ".json") : null;
                if (f == null) { status = "400 Bad Request"; body = JsonErr("精读文件 key 不合法"); }
                else if (method == "GET")
                {
                    if (!File.Exists(f)) { status = "404 Not Found"; body = JsonErr("精读文件不存在"); }
                    else body = File.ReadAllBytes(f);
                }
                else if (method == "PUT")
                {
                    byte[] data = bodyMs != null ? bodyMs.ToArray() : new byte[0];
                    if (data.Length == 0 || data[0] != (byte)'{') { status = "400 Bad Request"; body = JsonErr("精读文件必须是 JSON 对象"); }
                    else { AtomicWrite(f, data); body = JsonBytes("{\"ok\":true}"); }
                }
                else if (method == "DELETE")
                {
                    if (File.Exists(f)) File.Delete(f);
                    body = JsonBytes("{\"ok\":true}");
                }
                else { status = "405 Method Not Allowed"; body = JsonErr("不支持的方法"); }
            }
            else if (path.Equals("/api/lwords", StringComparison.OrdinalIgnoreCase) && method == "GET")
            {
                body = File.Exists(LWordsPath()) ? File.ReadAllBytes(LWordsPath()) : JsonBytes("[]");
            }
            else if (path.Equals("/api/lwords", StringComparison.OrdinalIgnoreCase) && method == "PUT")
            {
                byte[] data = bodyMs != null ? bodyMs.ToArray() : new byte[0];
                if (data.Length == 0 || data[0] != (byte)'[') { status = "400 Bad Request"; body = JsonErr("听力生词本必须是 JSON 数组"); }
                else { AtomicWrite(LWordsPath(), data); body = JsonBytes("{\"ok\":true}"); }
            }
            else if (path.Equals("/api/lnotes", StringComparison.OrdinalIgnoreCase) && method == "GET")
            {
                List<string> keys = new List<string>();
                string dir = LNotesRoot();
                if (Directory.Exists(dir))
                    foreach (string f in Directory.GetFiles(dir, "*.json"))
                    {
                        string k = Path.GetFileNameWithoutExtension(f);
                        if (SafeSeg(k)) keys.Add(k);
                    }
                keys.Sort(StringComparer.OrdinalIgnoreCase);
                body = JsonBytes(new JavaScriptSerializer().Serialize(keys));
            }
            else if (path.StartsWith("/api/lnotes/", StringComparison.OrdinalIgnoreCase))
            {
                string key = path.Substring("/api/lnotes/".Length);
                string f = SafeSeg(key) ? Path.Combine(LNotesRoot(), key + ".json") : null;
                if (f == null) { status = "400 Bad Request"; body = JsonErr("精听文件 key 不合法"); }
                else if (method == "GET")
                {
                    if (!File.Exists(f)) { status = "404 Not Found"; body = JsonErr("精听文件不存在"); }
                    else body = File.ReadAllBytes(f);
                }
                else if (method == "PUT")
                {
                    byte[] data = bodyMs != null ? bodyMs.ToArray() : new byte[0];
                    if (data.Length == 0 || data[0] != (byte)'{') { status = "400 Bad Request"; body = JsonErr("精听文件必须是 JSON 对象"); }
                    else { AtomicWrite(f, data); body = JsonBytes("{\"ok\":true}"); }
                }
                else if (method == "DELETE")
                {
                    if (File.Exists(f)) File.Delete(f);
                    body = JsonBytes("{\"ok\":true}");
                }
                else { status = "405 Method Not Allowed"; body = JsonErr("不支持的方法"); }
            }
            else
            {
                status = "404 Not Found";
                body = JsonErr("未知接口");
            }
        }
        catch (Exception ex)
        {
            status = "500 Internal Server Error";
            mime = "application/json; charset=utf-8";
            body = JsonErr(ex.Message);
            Log("API 异常 " + method + " " + path + ": " + ex.Message);
        }
        Log("API " + method + " " + path + " → " + status.Substring(0, 3));
        WriteResponse(ns, status, mime, body ?? JsonBytes("{}"), headOnly, true);
    }

    /// Content-Type 旁注：只保留常见字符，防注入到响应头
    private static string SafeMime(string s)
    {
        if (string.IsNullOrEmpty(s) || s.Length > 100) return null;
        foreach (char c in s)
        {
            bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                      || c == '/' || c == '.' || c == '+' || c == '-' || c == '_' || c == ';' || c == '=' || c == ' ';
            if (!ok) return null;
        }
        return s;
    }

    /// 题包文件名：去掉路径与非法字符，只留名字本身（保留中文与空格）
    private static string SafeFileName(string s)
    {
        if (string.IsNullOrEmpty(s)) return null;
        string name = s.Replace('/', '_').Replace('\\', '_').Trim();
        foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        if (name.Length == 0 || name == "." || name == "..") return null;
        if (name.Length > 120) name = name.Substring(name.Length - 120);   // 超长保尾（留扩展名）
        return name;
    }

    /* ---------------- 极简 HTTP 服务（裸 TCP） ---------------- */

    private static void Serve(TcpClient client)
    {
        string urlPath = "/";
        string status = "200 OK";
        try
        {
            client.NoDelay = true;
            using (client)
            using (NetworkStream ns = client.GetStream())
            {
                ns.ReadTimeout = 5000;
                ns.WriteTimeout = 30000;
                /* ---- 读请求头：字节级扫描 \r\n\r\n（PUT 的二进制 body 不能一起 ASCII 解码） ---- */
                byte[] buf = new byte[8192];
                MemoryStream headMs = new MemoryStream();
                int sep = -1;
                while (headMs.Length < 65536)
                {
                    int n = ns.Read(buf, 0, buf.Length);
                    if (n <= 0) break;
                    headMs.Write(buf, 0, n);
                    sep = IndexOfHeadEnd(headMs.GetBuffer(), (int)headMs.Length);
                    if (sep >= 0) break;
                }
                if (sep < 0) return;   // 浏览器的预连接 / 头不完整
                byte[] all = headMs.GetBuffer();
                string req = Encoding.ASCII.GetString(all, 0, sep);
                int bodyHave = (int)headMs.Length - (sep + 4);

                string[] lines = req.Split(new string[] { "\r\n" }, StringSplitOptions.None);
                string[] parts = lines[0].Split(' ');
                string method = parts.Length >= 1 ? parts[0].ToUpperInvariant() : "GET";
                bool isHead = method == "HEAD";
                if (parts.Length >= 2) urlPath = parts[1];
                int q = urlPath.IndexOfAny(new char[] { '?', '#' });
                if (q >= 0) urlPath = urlPath.Substring(0, q);

                string hostHeader = null, mimeHeader = null;
                long contentLength = 0;
                for (int i = 1; i < lines.Length; i++)
                {
                    if (lines[i].StartsWith("Host:", StringComparison.OrdinalIgnoreCase)) hostHeader = lines[i].Substring(5).Trim();
                    else if (lines[i].StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                        long.TryParse(lines[i].Substring(15).Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out contentLength);
                    else if (lines[i].StartsWith("X-Mime-Type:", StringComparison.OrdinalIgnoreCase)) mimeHeader = lines[i].Substring(12).Trim();
                }

                string decoded;
                try { decoded = Uri.UnescapeDataString(urlPath); } catch { decoded = urlPath; }
                bool isApi = decoded.StartsWith("/api/", StringComparison.OrdinalIgnoreCase);
                if (!isHead && !isApi) Interlocked.Increment(ref getHits);   // 页面请求才算"浏览器真的打开了"（HEAD 探测与数据接口不计）

                if (!HostAllowed(hostHeader))
                {
                    WriteResponse(ns, "403 Forbidden", "text/plain; charset=utf-8", new byte[0], true, isApi);
                    return;
                }

                /* ---- PUT/POST 的请求体（题包原件、媒体二进制、整量 JSON） ---- */
                MemoryStream bodyMs = null;
                if ((method == "PUT" || method == "POST") && contentLength > 0)
                {
                    if (contentLength > 512L * 1024 * 1024)
                    {
                        WriteResponse(ns, "413 Request Entity Too Large", "application/json; charset=utf-8", JsonErr("文件过大"), isHead, isApi);
                        return;
                    }
                    ns.ReadTimeout = 120000;   // 题包 zip 可能上百 MB，loopback 很快，超时放宽即可
                    bodyMs = new MemoryStream();
                    if (bodyHave > 0) bodyMs.Write(all, sep + 4, (int)Math.Min(bodyHave, contentLength));
                    long remain = contentLength - bodyMs.Length;
                    while (remain > 0)
                    {
                        int n = ns.Read(buf, 0, (int)Math.Min(buf.Length, remain));
                        if (n <= 0) break;
                        bodyMs.Write(buf, 0, n);
                        remain -= n;
                    }
                    if (remain > 0)
                    {
                        WriteResponse(ns, "400 Bad Request", "application/json; charset=utf-8", JsonErr("请求体不完整"), isHead, isApi);
                        return;
                    }
                }

                if (isApi)
                {
                    ServeApi(ns, method, isHead, decoded, mimeHeader, bodyMs);
                    return;
                }

                byte[] body;
                string sendPath = Normalize(decoded);
                if (!Files.TryGetValue(sendPath, out body))
                {
                    string last = sendPath.Substring(sendPath.LastIndexOf('/') + 1);
                    if (last.IndexOf('.') >= 0)
                    {
                        status = "404 Not Found"; body = new byte[0]; sendPath = ".txt";   // 缺失的 js/css 不能回 index.html，否则报 MIME 错且难排查
                    }
                    else
                    {
                        Files.TryGetValue("/index.html", out body);   // 单页应用路由
                        sendPath = "/index.html";
                    }
                }
                if (body == null) body = new byte[0];

                WriteResponse(ns, status, MimeOf(sendPath), body, isHead, false);
            }

            long count = Interlocked.Increment(ref served);
            if (!quiet && count <= 60) Line("  " + status.Substring(0, 3) + " " + urlPath);
            if (count <= 20) Log(status.Substring(0, 3) + " " + urlPath);
        }
        catch { }
    }

    private static bool HostAllowed(string host)
    {
        if (host == null) return true;   // HTTP/1.0 客户端
        string h = host;
        if (h.StartsWith("[")) { int rb = h.IndexOf(']'); h = rb > 0 ? h.Substring(0, rb + 1) : h; }
        else { int colon = h.IndexOf(':'); if (colon >= 0) h = h.Substring(0, colon); }
        return h == "127.0.0.1" || h.Equals("localhost", StringComparison.OrdinalIgnoreCase) || h == "[::1]";
    }

    private static string MimeOf(string path)
    {
        int dot = path.LastIndexOf('.');
        string ext = dot >= 0 ? path.Substring(dot).ToLowerInvariant() : "";
        switch (ext)
        {
            case ".html": case ".htm": return "text/html; charset=utf-8";
            case ".js": case ".mjs": return "application/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": case ".map": return "application/json; charset=utf-8";
            case ".wasm": return "application/wasm";
            case ".svg": return "image/svg+xml";
            case ".png": return "image/png";
            case ".jpg": case ".jpeg": return "image/jpeg";
            case ".gif": return "image/gif";
            case ".webp": return "image/webp";
            case ".ico": return "image/x-icon";
            case ".woff": return "font/woff";
            case ".woff2": return "font/woff2";
            case ".ttf": return "font/ttf";
            case ".mp3": return "audio/mpeg";
            case ".m4a": return "audio/mp4";
            case ".wav": return "audio/wav";
            case ".txt": case ".md": return "text/plain; charset=utf-8";
            default: return "application/octet-stream";
        }
    }

    /* ---------------- 打开浏览器 ---------------- */

    /* 三种角色分清楚：
       · OpenBrowserVerified —— 正经路径：多种方式依次试，每种都用"本机服务器有没有收到页面请求"来验证，
                                只有真的收到请求才算成功（返回方式名），全失败返回 null。
       · BuildOpenAttempts   —— 候选方式清单（顺序即优先级）。
       · OpenBrowserSimple   —— 老逻辑，只用于"第二个实例复用已有服务"的场景：
                                那时服务器在别人进程里，本进程看不到请求数，没法验证，只能尽力而为。
    */

    private sealed class OpenAttempt
    {
        public string Name;          // 给用户看的方式名
        public Action Run;           // 执行动作
        public int WaitMs;           // 执行后等多久看页面请求
        public OpenAttempt(string name, int waitMs, Action run) { Name = name; WaitMs = waitMs; Run = run; }
    }

    /// 依次尝试各种"打开默认浏览器"的方式，并验证页面是否真的被请求。
    /// 返回成功的方式名；全部没成功返回 null，并把每种方式的结果写进 detail（给界面/日志用）。
    private static string OpenBrowserVerified(string url, out string detail)
    {
        StringWriter notes = new StringWriter();
        long before = Interlocked.Read(ref getHits);
        bool restricted = IsRestrictedIntegrity();
        List<OpenAttempt> list = BuildOpenAttempts(url);
        int tried = 0;
        foreach (OpenAttempt a in list)
        {
            // 受限权限（Low/Untrusted）下前两种也几乎不可能成功，别让用户干等十几秒
            if (restricted && tried >= 2) break;
            tried++;
            try { a.Run(); }
            catch (Exception ex)
            {
                Log("打开方式「" + a.Name + "」抛异常: " + ex.Message);
                notes.Write(a.Name + "：调用失败（" + ex.Message + "）；");
                continue;
            }
            if (WaitForPageRequest(before, a.WaitMs))
            {
                detail = notes.ToString();
                Log("√ 打开页面成功，用的是「" + a.Name + "」（服务器收到了浏览器发来的页面请求）");
                return a.Name;
            }
            Log("方式「" + a.Name + "」执行了但页面没打开（服务器没收到请求），换下一种");
            notes.Write(a.Name + "：命令已执行但页面没打开；");
        }
        detail = notes.ToString();
        Log("× 所有打开方式都没能让浏览器请求页面：" + detail);
        return null;
    }

    /// 等本机服务器收到新的页面请求——这是"浏览器真的打开了这个地址"的唯一可靠证据
    private static bool WaitForPageRequest(long beforeHits, int timeoutMs)
    {
        Stopwatch sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (Interlocked.Read(ref getHits) > beforeHits) return true;
            Thread.Sleep(100);
        }
        return false;
    }

    private static List<OpenAttempt> BuildOpenAttempts(string url)
    {
        List<OpenAttempt> list = new List<OpenAttempt>();

        // ① 交给系统 Shell（"打开"动词），由 Windows 自己调起默认浏览器并把链接传过去——最正统的方式
        string progId = ReadReg(Registry.CurrentUser, @"SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice", "ProgId", RegistryView.Default);
        Log("http 默认关联 ProgId: " + (progId ?? "(未设置)"));
        bool defaultIsIE = progId != null && progId.StartsWith("IE.", StringComparison.OrdinalIgnoreCase);
        if (!defaultIsIE)
        {
            string name = "系统默认浏览器" + (progId != null ? "（" + progId + "）" : "");
            list.Add(new OpenAttempt(name, 5000, delegate
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                QueueForeground(DefaultBrowserExe(progId));
            }));
        }
        else
        {
            Log("默认浏览器是 IE，IE 打不开本程序的页面，跳过它，直接找 Edge / Chrome / Firefox");
        }

        // ② 直接启动默认浏览器的 exe 并带上链接（ProgId 命令里排除 IE）
        string defExe = DefaultBrowserExe(progId);
        if (defExe != null)
        {
            list.Add(new OpenAttempt("默认浏览器程序（" + Path.GetFileName(defExe) + "）", 2500, delegate
            {
                Process.Start(new ProcessStartInfo(defExe, "\"" + url + "\"") { UseShellExecute = false });
                QueueForeground(defExe);
            }));
        }

        // ③ rundll32 的 URL 协议处理器（老牌兜底，不依赖关联注册表）
        list.Add(new OpenAttempt("rundll32 url.dll,FileProtocolHandler", 2000, delegate
        {
            Process.Start(new ProcessStartInfo("rundll32.exe", "url.dll,FileProtocolHandler " + url) { UseShellExecute = false });
        }));

        // ④ cmd /c start（Windows 最原始的"打开"方式）
        list.Add(new OpenAttempt("cmd /c start", 2000, delegate
        {
            Process.Start(new ProcessStartInfo("cmd.exe", "/c start \"\" \"" + url + "\"") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden });
        }));

        // ⑤ 常见浏览器 exe，逐个试（Edge / Chrome / Firefox 及系统登记的其它浏览器）
        foreach (string exe in BrowserCandidates())
        {
            string e = exe;
            list.Add(new OpenAttempt(Path.GetFileName(e), 2000, delegate
            {
                Process.Start(new ProcessStartInfo(e, "\"" + url + "\"") { UseShellExecute = false });
                QueueForeground(e);
            }));
            if (list.Count >= 8) break;   // 最多试这么多种，别让用户等太久
        }

        // ⑥ 最后的兜底：把链接丢给资源管理器转交
        list.Add(new OpenAttempt("explorer.exe 转交", 2000, delegate
        {
            Process.Start(new ProcessStartInfo("explorer.exe", "\"" + url + "\"") { UseShellExecute = false });
        }));

        return list;
    }

    /* ---------------- 受限权限（完整性级别）诊断 ---------------- */

    /// 当前进程的完整性级别 RID：0=Untrusted, 4096=Low, 8192=Medium, 12288=Medium+, 16384=High；取不到返回 -1。
    /// 被自动化工具 / 沙箱以受限权限启动时是 4096 或 0 —— 那种权限下 Windows 不允许本程序调起用户的浏览器。
    private static int IntegrityRid()
    {
        IntPtr token = IntPtr.Zero;
        try
        {
            if (!OpenProcessToken(GetCurrentProcess(), 0x0008, out token)) return -1;   // TOKEN_QUERY
            int len;
            GetTokenInformation(token, 25, IntPtr.Zero, 0, out len);                    // TokenIntegrityLevel = 25
            if (len <= 0) return -1;
            IntPtr buf = Marshal.AllocHGlobal(len);
            try
            {
                if (!GetTokenInformation(token, 25, buf, len, out len)) return -1;
                IntPtr sid = Marshal.ReadIntPtr(buf);                                  // TOKEN_MANDATORY_LABEL.Label.Sid
                if (sid == IntPtr.Zero) return -1;
                int count = Marshal.ReadByte(sid, 1);                                  // SID.SubAuthorityCount
                if (count < 1) return -1;
                return Marshal.ReadInt32(sid, 8 + 4 * (count - 1));                     // 最后一个 SubAuthority
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
        catch { return -1; }
        finally { if (token != IntPtr.Zero) { try { CloseHandle(token); } catch { } } }
    }

    private static string IntegrityName(int rid)
    {
        switch (rid)
        {
            case 0: return "Untrusted(0)";
            case 4096: return "Low(4096)";
            case 8192: return "Medium(8192)";
            case 12288: return "MediumPlus(12288)";
            case 16384: return "High(16384)";
            case 28672: return "System(28672)";
            case -1: return "未知";
            default: return "RID=" + rid;
        }
    }

    /// 是否处于"调不起浏览器"的受限权限
    private static bool IsRestrictedIntegrity()
    {
        int rid = IntegrityRid();
        return rid == 0 || rid == 4096;
    }

    /// 受限权限时给用户的说明（不适用返回 null）
    private static string RestrictedPermissionsWarning()
    {
        int rid = IntegrityRid();
        if (rid != 0 && rid != 4096) return null;
        return "注意：本程序正以「受限权限」运行（完整性级别 " + IntegrityName(rid) + "，多为自动化工具/沙箱启动），"
             + "这种权限下 Windows 不允许它自动打开浏览器。关掉本窗口后，直接双击程序目录里的「英语机考模拟器.exe」重启即可。";
    }

    /// 自动打开失败时，在程序目录放一个双击即用的批处理（用户双击它由资源管理器以正常权限打开链接）
    private static string WriteFallbackBat(string url)
    {
        try
        {
            string dir = Path.GetDirectoryName(SafeExePath());
            if (string.IsNullOrEmpty(dir)) return null;
            string bat = Path.Combine(dir, "打开练习页面.bat");
            string body = "@echo off\r\nrem 英语机考模拟器：自动打开浏览器失败时的备用入口（双击即可）\r\nstart \"\" \"" + url + "\"\r\n";
            File.WriteAllText(bat, body, Encoding.Default);
            Log("已写出备用入口：" + bat);
            return bat;
        }
        catch (Exception ex) { Log("写备用入口失败: " + ex.Message); return null; }
    }

    /// 老逻辑：不做验证，只求尽力打开（第二个实例复用已有服务时用；那时请求数在别的进程里，验证不了）
    private static string OpenBrowserSimple(string url)
    {
        string progId = ReadReg(Registry.CurrentUser, @"SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice", "ProgId", RegistryView.Default);
        Log("http 默认关联 ProgId: " + (progId ?? "(未设置)"));
        bool defaultIsIE = progId != null && progId.StartsWith("IE.", StringComparison.OrdinalIgnoreCase);

        if (!defaultIsIE)
        {
            // 首选：把链接交给系统 Shell（"打开"动词），由 Windows 自己调起默认浏览器并传入链接。
            // 直接启动浏览器 exe 传参在部分环境下会"开了浏览器但没带链接"，只作兜底。
            string defExe = DefaultBrowserExe(progId);
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                if (defExe != null) QueueForeground(defExe);
                return "系统默认浏览器" + (progId != null ? "（" + progId + "）" : "");
            }
            catch (Exception ex) { Log("默认关联打开失败: " + ex.Message); }
            if (defExe != null)
            {
                try
                {
                    Process.Start(new ProcessStartInfo(defExe, "\"" + url + "\"") { UseShellExecute = false });
                    QueueForeground(defExe);
                    return "默认浏览器（" + Path.GetFileName(defExe) + "）";
                }
                catch (Exception ex) { Log("直启默认浏览器失败: " + ex.Message); }
            }
        }
        else
        {
            Line("! 默认浏览器是 IE，IE 打不开本程序的页面，改找 Edge / Chrome / Firefox…");
        }

        foreach (string exe in BrowserCandidates())
        {
            try
            {
                Process.Start(new ProcessStartInfo(exe, "\"" + url + "\"") { UseShellExecute = false });
                QueueForeground(exe);
                return exe;
            }
            catch (Exception ex) { Log("直接启动 " + exe + " 失败: " + ex.Message); }
        }

        if (defaultIsIE)
        {
            Line("× 没找到新版浏览器。请安装 Edge 或 Chrome 后，把下面的地址粘进去。");
            return null;
        }
        try
        {
            Process.Start(new ProcessStartInfo("explorer.exe", "\"" + url + "\"") { UseShellExecute = false });
            return "explorer.exe 转交";
        }
        catch (Exception ex) { Log("explorer 打开失败: " + ex.Message); }
        return null;
    }

    /* ---------------- 浏览器窗口置前 ---------------- */
    // 静态字段持有回调，防止枚举过程中委托被 GC 回收导致静默失败
    private static readonly EnumWindowsProc enumWindowsCb = new EnumWindowsProc(EnumWindowsCallback);
    private static IntPtr enumFound;
    private static string enumProcName;
    private static uint enumExcludePid;
    private static int enumTotal;
    private static readonly List<string> enumSeen = new List<string>();

    /// 从 UserChoice 的 ProgId 解析出默认浏览器的 exe 路径（HKCR\<ProgId>\shell\open\command），排除 IE
    private static string DefaultBrowserExe(string progId)
    {
        if (string.IsNullOrEmpty(progId)) return null;
        try
        {
            using (RegistryKey k = Registry.ClassesRoot.OpenSubKey(progId + @"\shell\open\command"))
            {
                if (k == null) return null;
                string exe = ExeFromCommand(k.GetValue("") as string);
                if (exe == null) return null;
                exe = Environment.ExpandEnvironmentVariables(exe.Trim().Trim('"'));
                if (exe.IndexOf("iexplore", StringComparison.OrdinalIgnoreCase) >= 0) return null;
                return File.Exists(exe) ? exe : null;
            }
        }
        catch { return null; }
    }

    /// 打开浏览器后，后台线程尽力把浏览器窗口抓到前台
    private static void QueueForeground(string exePath)
    {
        try { ThreadPool.QueueUserWorkItem(delegate { BringBrowserToFront(exePath); }); }
        catch (Exception ex) { Log("置前排队失败: " + ex.Message); }
    }

    /// 默认关联打开的通病：浏览器在后台静默开标签页，用户以为"没反应"。这里把浏览器窗口带到前台，
    /// 但**绝不改变窗口的大小/位置状态**：
    ///   · 只有窗口已经最小化时才 ShowWindow(SW_RESTORE)。旧版对最大化窗口也无条件 SW_RESTORE，
    ///     而 SW_RESTORE 的语义是"把最大化/最小化的窗口还原成原来的大小和位置"——于是用户会看到
    ///     浏览器自己"窗口化一下、再挪一下位置"（v3.2.1 修的就是这个）。
    ///   · 不再用 keybd_event 注入 Alt 键：那是全局按键，会干扰用户当时的键盘/鼠标操作
    ///     （比如正按着鼠标左键时被注入 Alt，可能被系统当成窗口拖动）。
    ///   · 抢不到前台就退化成"闪任务栏图标"，只提示，不动窗口。
    private static void BringBrowserToFront(string exePath)
    {
        string procName = null;
        try { procName = Path.GetFileNameWithoutExtension(exePath); } catch { }
        if (string.IsNullOrEmpty(procName)) return;
        uint myPid = (uint)Process.GetCurrentProcess().Id;

        // ① 等窗口出现（浏览器冷启动可能要一两秒）
        IntPtr hwnd = IntPtr.Zero;
        for (int i = 0; i < 12 && hwnd == IntPtr.Zero; i++)
        {
            Thread.Sleep(500);
            hwnd = FindTopWindowOfProcess(procName, myPid);
            if (hwnd != IntPtr.Zero) { if (i <= 1) Log("置前轮询：找到 " + procName + " 窗口 hwnd=" + hwnd); }
            else if (i == 0) Log("置前轮询：暂未找到 " + procName + " 的窗口");
        }
        if (hwnd == IntPtr.Zero) { Log("没能找到 " + procName + " 的窗口（不影响页面打开）"); return; }

        // ② 置前（多试几次，但每次都不碰窗口的大小/位置）
        try
        {
            for (int attempt = 0; attempt < 4; attempt++)
            {
                if (GetForegroundWindow() == hwnd) { Log("浏览器窗口已经在前台"); return; }
                if (IsIconic(hwnd)) ShowWindow(hwnd, 9);        // SW_RESTORE——仅对"最小化"的窗口
                BringWindowToTop(hwnd);
                if (SetForegroundWindow(hwnd)) { Log("已把浏览器窗口带到前台"); return; }

                // 前台锁定：把自己的输入队列挂到当前前台线程再试一次（不发任何键盘事件）
                IntPtr fg = GetForegroundWindow();
                uint dummy;
                uint fgTid = GetWindowThreadProcessId(fg, out dummy);
                uint myTid = GetCurrentThreadId();
                if (fgTid != 0 && fgTid != myTid) AttachThreadInput(myTid, fgTid, true);
                bool ok = SetForegroundWindow(hwnd);
                if (fgTid != 0 && fgTid != myTid) AttachThreadInput(myTid, fgTid, false);
                if (ok) { Log("已把浏览器窗口带到前台（挂接输入队列后）"); return; }

                SwitchToThisWindow(hwnd, true);                 // 另一条老 API，同样不改变窗口状态
                Thread.Sleep(250);
                if (GetForegroundWindow() == hwnd) { Log("已把浏览器窗口带到前台（SwitchToThisWindow）"); return; }
                Thread.Sleep(250);
            }

            // ③ 还是抢不到：闪任务栏图标提示用户（绝不改变窗口大小/位置）
            FLASHWINFO fi = new FLASHWINFO();
            fi.cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO));
            fi.hwnd = hwnd;
            fi.dwFlags = FLASHW_TRAY | FLASHW_TIMERNOFG;
            FlashWindowEx(ref fi);
            Log("不能把浏览器窗口带到前台，改为闪烁任务栏图标提示（窗口大小/位置保持不变）");
        }
        catch (Exception ex) { Log("前置浏览器失败: " + ex.Message); }
    }

    /// EnumWindows 按 Z 序枚举，第一个命中的可见有标题窗口即该浏览器最上层的窗口。
    /// 过滤掉"有主窗口的弹出窗"（对话框等）和过小的窗口，避免把别的窗口当成浏览器主窗口去操作。
    private static IntPtr FindTopWindowOfProcess(string procName, uint excludePid)
    {
        enumFound = IntPtr.Zero;
        enumProcName = procName;
        enumExcludePid = excludePid;
        enumTotal = 0;
        enumSeen.Clear();
        try { EnumWindows(enumWindowsCb, IntPtr.Zero); }
        catch (Exception ex) { Log("枚举窗口异常: " + ex.Message); }
        GC.KeepAlive(enumWindowsCb);
        if (enumFound == IntPtr.Zero)
            Log("枚举诊断: 可见有标题窗口共 " + enumTotal + " 个，进程有 " + string.Join(", ", enumSeen.ToArray()));
        return enumFound;
    }

    /// 窗口是不是"像主窗口"：没有主窗口、且（最小化的或够大的）。最小化的窗口矩形不可靠，不再筛大小。
    private static bool LooksLikeMainWindow(IntPtr hWnd)
    {
        try
        {
            if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero) return false;
            if (IsIconic(hWnd)) return true;
            RECT r;
            if (!GetWindowRect(hWnd, out r)) return true;
            return (r.Right - r.Left) >= 200 && (r.Bottom - r.Top) >= 150;
        }
        catch { return true; }
    }

    private static bool EnumWindowsCallback(IntPtr hWnd, IntPtr lParam)
    {
        if (!IsWindowVisible(hWnd)) return true;
        if (GetWindowTextLength(hWnd) <= 0) return true;
        enumTotal++;
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        if (pid == 0 || pid == enumExcludePid) return true;
        try
        {
            string pn = ProcessNameOfPid((int)pid);
            if (pn != null)
            {
                if (enumSeen.Count < 12 && !enumSeen.Contains(pn)) enumSeen.Add(pn);
                if (string.Equals(pn, enumProcName, StringComparison.OrdinalIgnoreCase) && LooksLikeMainWindow(hWnd))
                {
                    enumFound = hWnd;
                    return false;
                }
            }
        }
        catch (Exception ex)
        {
            if (enumSeen.Count < 12) enumSeen.Add("ERR:" + pid + ":" + ex.GetType().Name + ":" + ex.Message);
        }
        return true;
    }

    /// 用 OpenProcess + QueryFullProcessImageName 取进程名（不经 Process.GetProcessById，后者在本机环境对运行中的进程也误报"未运行"）
    private static string ProcessNameOfPid(int pid)
    {
        IntPtr h = OpenProcess(0x1000, false, pid);   // PROCESS_QUERY_LIMITED_INFORMATION
        if (h == IntPtr.Zero) return null;
        try
        {
            StringBuilder sb = new StringBuilder(1024);
            int size = sb.Capacity;
            if (!QueryFullProcessImageName(h, 0, sb, ref size)) return null;
            return Path.GetFileNameWithoutExtension(sb.ToString());
        }
        finally { CloseHandle(h); }
    }

    private static List<string> BrowserCandidates()
    {
        List<string> list = new List<string>();
        RegistryView[] views = Environment.Is64BitOperatingSystem
            ? new RegistryView[] { RegistryView.Registry64, RegistryView.Registry32 }
            : new RegistryView[] { RegistryView.Default };
        RegistryKey[] hives = new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine };

        foreach (string name in new string[] { "msedge.exe", "chrome.exe", "firefox.exe" })
            foreach (RegistryKey hive in hives)
                foreach (RegistryView v in views)
                    AddExe(list, ReadReg(hive, @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + name, "", v));

        // 系统"默认程序"里登记过的浏览器（含 360、QQ 浏览器等），排除 IE
        foreach (RegistryKey hive in hives)
            foreach (RegistryView v in views)
            {
                try
                {
                    using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive == Registry.CurrentUser ? RegistryHive.CurrentUser : RegistryHive.LocalMachine, v))
                    using (RegistryKey k = baseKey.OpenSubKey(@"SOFTWARE\Clients\StartMenuInternet"))
                    {
                        if (k == null) continue;
                        foreach (string sub in k.GetSubKeyNames())
                        {
                            if (sub.IndexOf("IEXPLORE", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                            using (RegistryKey cmd = k.OpenSubKey(sub + @"\shell\open\command"))
                                if (cmd != null) AddExe(list, ExeFromCommand(cmd.GetValue("") as string));
                        }
                    }
                }
                catch { }
            }

        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (string root in new string[] { pf86, pf, local })
        {
            if (string.IsNullOrEmpty(root)) continue;
            AddExe(list, Path.Combine(root, @"Microsoft\Edge\Application\msedge.exe"));
            AddExe(list, Path.Combine(root, @"Google\Chrome\Application\chrome.exe"));
            AddExe(list, Path.Combine(root, @"Mozilla Firefox\firefox.exe"));
        }
        return list;
    }

    private static void AddExe(List<string> list, string path)
    {
        if (string.IsNullOrEmpty(path)) return;
        path = Environment.ExpandEnvironmentVariables(path.Trim().Trim('"'));
        try
        {
            if (!File.Exists(path)) return;
            foreach (string x in list) if (string.Equals(x, path, StringComparison.OrdinalIgnoreCase)) return;
            list.Add(path);
        }
        catch { }
    }

    private static string ExeFromCommand(string cmd)
    {
        if (string.IsNullOrEmpty(cmd)) return null;
        cmd = cmd.Trim();
        if (cmd.StartsWith("\"")) { int e = cmd.IndexOf('"', 1); return e > 1 ? cmd.Substring(1, e - 1) : null; }
        int i = cmd.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
        return i > 0 ? cmd.Substring(0, i + 4) : null;
    }

    private static string ReadReg(RegistryKey hive, string path, string name, RegistryView view)
    {
        try
        {
            RegistryHive h = hive == Registry.CurrentUser ? RegistryHive.CurrentUser : RegistryHive.LocalMachine;
            using (RegistryKey b = RegistryKey.OpenBaseKey(h, view))
            using (RegistryKey k = b.OpenSubKey(path))
                return k == null ? null : k.GetValue(name) as string;
        }
        catch { return null; }
    }
}
