# v2.0（大更新：八项学习功能 + UI 改造 + 启动器 v3.4）

按《DeepSeek_功能实施规格.md》与《UI改造与功能规划方案.md》实施，保留原做题状态机与全部既有能力。

## 新功能

1. **未完成练习中心**：`active-session`（v1）记录范围/阶段/题号/不限时；首页继续卡、题库「继续」、搜索结果统一入口；继续/重新开始/放弃三选一；旧版只有 timer 的存档自动升级，只有非空作答时让用户选择「尝试继续/清除后开始」。
2. **交卷前检查**：`SubmitReviewModal` 显示已答/未答/Flag，题号可点击跳题（最多直接展示 12 个）；写作显示每个 Task 词数与建议最低词数；Full length 阶段按钮改为「结束听力并进入阅读」等。
3. **写作答卷历史与修改稿**：独立 IndexedDB `ielts15-writing.attempts` 保存不可变原稿与题目快照；修改稿独立自动保存（500ms 防抖 + 关闭前 flush）；再次判改只写入 `gradedEssays` 快照，不覆盖原场次成绩；版本对比表 + 左右正文对比。
4. **轻量错题复盘**：交卷同一分支自动收录（幂等 `processedRecordIds`），错因/状态/筛选/统计；单题与同组题重做复用原题组与 `gradeReading`，复盘答案不写正式存档。
5. **词汇间隔复习**：统一词条模型合并精读/精听同词；三档反馈 3/7/14/30/60/120/180 天；again 本次会话最多重现 3 次；句子只浏览不进 SRS。
6. **学习分析看板**：Band 只用整卷、正确率含部分练习、题型只认带 `type` 的新记录、Full length 时长不重复、写作四维来自原场次判改。
7. **全量备份与恢复**：ZIP（manifest + data/* + settings/ui.json + 可选 media/），不含模型配置与 API Key；预检（格式/版本/JSON/媒体路径）、合并计划（新增/保留/使用备份）、完整替换前强制含媒体备份、恢复后 `flushLocalMirrors()` 再刷新。
8. **统一搜索**：题库/练习记录/词汇与批注三组，250ms 防抖、多关键词 AND、上下键 + Enter + Esc、查看全部、三类跳转。

## UI 改造

- 首页：产品报头 + 主导航（练习首页/学习分析/错题复盘/词汇复习）+ 搜索/数据管理/高级设置；新用户首屏聚焦导入，老用户首屏先显示继续练习；题库条目显示进行中与最近成绩，删除确认说明影响范围。
- 成绩页：结论 → 操作条 → 明细；答错/未答/正确率分开，作答回顾支持全部/答错/未答/已标记筛选、粘性表头；Overall 只在所有已考科目都有有效 Band 时显示。
- 顶栏中文化（交卷/返回题库/标记/设置/帮助/隐藏），真实题包不再显示考生编号与 DEMO；返回题库有「答案已自动保存」确认。
- 阅读/写作分栏支持键盘 ←/→ 调整、回车重置 50%，比例写入 `ielts15-ui-settings`。
- 精听窄屏抽屉、词汇翻卡键盘与 reduced-motion 等沿用原实现；新增面板统一 `as-/sr-/wh-/rv-/vc-/an-/dm-/gs-` 前缀样式（`src/styles/app-v2.css`）。

## 数据与接口

- 新增文件：`做题记录\写作\<recordId>.json`（`/api/writing`）与 `做题记录\学习数据.json`（`/api/store/learning`）。
- 启动器 selftest 覆盖 writing/learning（writing 只用 `_selftest`，learning PUT 用 version=2 验证拒绝且不落盘）。
- 删除矩阵：放弃进度只删当前作答/计时；删除记录连带写作答卷正文、保留复盘；清空记录连带清空写作答卷；删除题包删当前进度与媒体、保留历史与写作快照。
- 未完成作答/倒计时仍只保存在浏览器，跨端口需通过「数据管理」备份恢复；题库/历史/写作/学习数据由启动器文件夹自动恢复。

## 验证

- `npm run build` 通过（tsc -b + vite build）。
- `英语机考模拟器.exe --selftest` 全部通过（含新增接口）。
- 浏览器自动化冒烟（puppeteer-core + Chrome）：首页/搜索/分析/复盘/词汇/数据管理/备份导出与合并恢复/阅读交卷与 MD 导出/写作原稿与修改稿持久化/继续与放弃进度/错题重做/SRS 三档评分，全部通过，0 运行时错误。
- 响应式检查：1440×900、1280×720、1024×768、900、768、600、390 均无页面级横向溢出，开始弹窗与分析面板不溢出。

## 首版明确不做

同套题并行多 active-session、写作版本树与逐句 diff、复杂 SM-2/Anki、AI 自动分析评语、云账号与实时多设备同步、增量/定时备份、拼音与 PDF 全文搜索、口语科目。

---

# 新版本 v1.5（Listening + Reading + Writing）

基于旧版本 `ielts-cbt-simulator`（v1.0，仅 Reading + Writing，已冻结）完整复制而来。

按《提示词D_工具升级v1.5》升级：

- [ ] zip 题包导入/导出（manifest.json 校验，缺文件明确指出）
- [ ] 答案按科存放（reading/answers.json、listening/answers.json），旧格式自动迁移
- [ ] 听力模块：顶部音频播放条 + 全宽题目区；实考模式（无暂停/进度条）与练习模式
- [ ] 写作 AI 判分（四维分项 + 强制"仅供参考"标注，不进历史曲线）
- [ ] IndexedDB 音频存储 + 断点恢复

开发顺序见提示词 D 第 6 节。

## 2026-10-16 变更（精听训练系统，配启动器 v3.3.2）

- 新增精听界面 `ListenLabView`：三栏 + 顶栏 + 固定底栏播放器。中栏句子卡三态（遮盖初始态 / 听写+词级 LCS diff+错因标签 / 已掌握绿行）、点词气泡（LLM 释义+音标，缓存进生词本）、按住跟读录音与原音 AB 对比；左栏本篇/全部生词（来源回跳）+ 薄弱句清单（重听≥3 或错≥2 聚合，一键只刷）；右栏重听热力 + 错因分布，点击筛选中栏；底栏 5 档变速直点、AB 循环区间高亮、句子刻度线悬停提示、空格/R/←→ 快捷键；泛听模式收起交互连续播放+全字幕。
- 题包无听力原文与时间轴，因此：`segment.ts` 用 OfflineAudioContext 静音检测自动切句（结果缓存进精听文件）；提供「粘贴听力原文」入口，原文按字符数比例对齐到剔除静音后的语音时间轴；无原文时文本类功能（听写/字幕/查词）禁用并提示，音频类功能照常。
- 数据层 `listenLab.ts`：每篇听力一个文件（`/api/lnotes/<testId>__s<n>` → `精听记录\`），生词本 `/api/lwords`（`精听记录\生词本.json`），跟读录音镜像 `/api/media/<testId>/rec_s*`；localStorage 缓存 + 串行写队列，API 不可用退化纯浏览器存储。
- 入口：成绩单「精听」按钮（听力交卷后，多 section 弹选择层）+ 首页「精听训练」区块（含册数→Test→Part 三级选择器 `ListenLabPicker`）。

## 2026-10-16 变更（精读功能，配启动器 v3.3.1）

- 交互调整：去掉批注框与锚点之间的连线层（iv-lines SVG 删除）；高亮本体即批注开关（点击展开/收起，iv-flow 平滑流入动效：上浮+轻放大一次收住，无抖动）；划词工具条改用 iv-rise 平滑浮现动效。
- 精读记录区新增「导入精读 JSON」：校验 testId/passageIdx/notes 结构（`normalizeIntensiveImport`），套题名/篇名以本地题库补全，已有批注时覆盖前确认；导入即落盘 精读记录\ 并联动词汇册。
- 新增精读界面 `IntensiveView`：三栏布局（批注边栏｜文章+题目｜批注边栏），划词弹「单词（蓝）/句子（琥珀）」工具条，单词自动收敛词边界、句子自动扩句边界；批注框落在靠近锚点一侧的边栏，同色系、自适应高度、✕ 折叠成色点、带弹性过冲 + 轻微震动的 pop 动效（`prefers-reduced-motion` 下关闭）。
- 入口：成绩单「精读」按钮（多篇先选篇）与首页「精读记录」列表（此入口批注默认折叠）；词汇句子册词条可「跳转到原文」定位到锚点并闪烁。
- 数据层 `src/lib/intensive.ts`：每篇精读一个文件（`/api/notes/<testId>__p<idx>`，存 `精读记录\` 文件夹），词汇句子册整册 `/api/wordbook`（`精读记录\词汇句子册.json`）；按 `kind+text` 去重合并、出处追踪、删批注联动清理；localStorage 为缓存，API 不可用时退化为纯浏览器存储。
- 精读界面题目区只读渲染并显示标准答案；localStorage 有本场作答时标 ✓/✗/未答。
- 修复：精读界面与词汇册弹层的 z-index 从 60/70 提到 1200/1210——原来低于成绩单的 `.overlay`（900），从成绩单点「精读」选篇后整层被成绩单盖住，表现为"点了直接消失"。

## 2026-10-15 变更（本地文件夹同步，配启动器 v3.3）

- 新增 `src/lib/serverSync.ts`：启动器 v3.3 起在 exe 同目录提供「导入题目」「做题记录」两个文件夹及 `/api/store/*`、`/api/media/*`、`/api/pack/*` 接口。页面打开时从文件夹恢复题库与练习记录（文件夹空而浏览器有数据则反向播种），之后的导入/交卷/删除都会镜像写回文件夹；每次导入 zip 还会在 `导入题目\题包\` 留一份原件。
- `store.ts` / `history.ts` 变更后镜像整量 JSON；`media.ts` 的音频与题图保存时镜像为文件，IndexedDB 未命中时从文件夹回源并回填缓存；删除题包连带删文件夹里的媒体。
- API 不存在时（如「备用启动.bat」的 PowerShell 服务）自动退化为纯浏览器存储，行为与旧版一致。
- 换浏览器、清浏览器数据、换端口不再丢题库与成绩；笔记/高亮/草稿与 AI 模型配置仍只存浏览器本地。

## 2026-10-06 变更（本轮）

- 练习模式听力**不限时**：顶栏显示 `∞`，不走字、不收卷、不计时存档；Full length 下仅听力段不限时，进入阅读恢复正常计时。不限时段的"实际用时"改用每题用时合计（原先会永远显示 32:00）。
- 填空字数上限按官方措辞解释：`ONE WORD AND/OR A NUMBER` 允许"一个词 + 一个数字"（如 `12 March`、`17th October`），不再误报；提示文案修正单复数（`1 WORDS` → `1 WORD`）并补句点；输入框宽度仍按指令原值，不因放宽而变宽。
- 写作 AI 判改改为**显式选择**流程：
  - 含写作的卷子点「开始」时，若判改模型没配全/填错 → 弹出配置窗（要判改 / 不判改 + Base URL / API Key / 模型名），字段级红字校验，不合法不放行；
  - 交卷后到结算画面，若此前选了「不判改」→ 自动再弹一次，可**现场判改**；成绩单上也保留「现场判改」入口；
  - 现场判改出分后，写作 Band 会正确计入 Overall（此前被"考前是否选择判改"挡住，显示 Not graded）。
- 新增轻量错误边界 `ErrorProbe`，避免弹窗渲染异常时静默丢 UI。

## 2026-10-07 变更（D1–D4 拍板后的实现 + 判分口径收口）

**交互（交接报告 issue-04 / 05 / 06）**

- **当前题只由主动导航更新**（D1 选①）：点底部题号、`←`/`→`、Review 勾选才会改「当前题」；作答与输入框聚焦**不再**改它（真机行为）。连带 ⚑ Flag、题号高亮、箭头可用态在所有题型上表现一致。
- **滚动与当前题解耦**（D2 选①）：删除 `useEffect([current])` 的"自动居中"，改为显式命令 `jump()` → `scrollToQuestion`，滚动方式 `block:'nearest'`（目标已在视口内则完全不动）。作答/聚焦时**视口一动不动**。
- 底部题号条横向滚动（E2）、听力切 Section 定位、阅读切 Part 定位均保留。

**视觉（D3 选①：补真机作答反馈）**

- 已答题：题号上方 30×3px **黄色短条**（#f2c200）+ 题干/空位输入框**浅灰底**（#f1f3f5）；表格匹配题在首格加黄边。依据 `shots\official_06_listening_answered.jpg` 实测。

**配对题（D4 选①，issue-01 / issue-02）**

- 新增题型 `matchingFeatures`：`matching_features` / `matching_sentence_endings` 不再借用"段落标题匹配"渲染器。
- 每题右侧一个**下拉框、只显示字母**（—/A/B/C…），选项原文以**纯文本列表**展示（不可拖拽）；**同一字母可重复使用**。
- 段落标题匹配（`matchingHeadings`）语义不变：选项仍"用掉即置灰、不可拖动"，仅在题面写 `NB You may use any letter more than once` 时才可重复。
- 新增验收脚本 `scripts\verify-matching-ui.cjs`（旧 `test-q17-reuse.cjs` 已不适用拖拽 UI，被它取代）。

**判分口径（issue-07 + 清理写死的题目数据）**

- 单选/多选旧存档：标准答案为单字母 A–E 时，取作答首个字母再比（`B 20 years.` 现在判对，老答卷零迁移）。
- **一个题号两个空**（阅读 Q26、听力 Q27）：作答存 `值1 | 值2`，`scoring.ts` 通用展开成 `x y` / `x and y` / `x to y` / `x-y` 及其逆序候选，再与题包 `answers.json` 的等价写法比对 —— **判分函数里不再出现任何题目专属数据**（原先写死的 `farmers`/`consumers`、`1882 (to/-) (18)83` 两条特例已删除；顺序能否互换由题包数据决定）。
- 标题匹配允许作答带尾点（选项印作 `ii. XXX`，答案键为 `ii`）。

**听力（另一处实测 bug）**

- 实考/练习的读题与检查倒计时原本**慢约 3 倍**（30 秒走 90 秒）：`ListeningView` 的倒计时 `useEffect` 依赖数组里放了整个 props 对象 `p`，App 每次重渲染都把未到点的 1 秒定时器清掉重设。已移除该依赖，`onAutoEnd` 改走 `useRef`。

**题包（数据侧，不属于本仓库）**

- `题包\剑7_Test2_题包_deepseek版.zip`：阅读三篇正文由**页面渲染图逐字转录**（两套独立转录交叉核对，差异回原图 400+ dpi 判定），修正了 OCR 草稿里的 `when It was built` / `At the end of Phase II, It was clear` / `Lt would have been` / `March 1993. Focused` 等错误；破折号统一为图上实印的「空格 + en dash + 空格」。旧 OCR 草稿备份在 `产出\_历史\`。

## 2026-10-07 第二轮（Test 1 / 3 / 4 实机跑测中发现的 4 个缺陷）

跑测方式：`scripts\run-pack-e2e.cjs <pack>` —— 答案直接从题包 `answers.json` 读，脚本里不写任何题目专属数据，
依次检查 导入诊断 → 音频逐 Section 播放 → 按官方答案填满 80 题 → 交卷逐题判定 + Band → 反向对照（全答错须 0 分）
→ 重复选项可用性 → 页面错误/资源 404。

| # | 缺陷 | 现象 | 修复 |
|---|---|---|---|
| 1 | 听力单科成绩卡标签写死 | 只考听力时分数卡写 "Reading Band (official conversion)"（**分数本身是对的**，`bandForListening` 已生效） | `ResultsView.tsx`：`listeningDone && !readingDone` 时显示 "Listening Band (official conversion)" |
| 2 | 选项是对象时**整页崩** | 题包里 options 写成 `{label:'A', text:'…'}` 时，渲染器对选项调用 `.split()` → 白屏（`Y.split is not a function`），该篇 27 题全部无法作答 | `adapter.ts` 新增 `toOptions()`：字符串原样、`{label,text}` 拼成 `"A …"`、其余丢弃；所有 options/choices 入口统一走它。`QuestionGroups.tsx` 的 `valueOf` 再加一层 `String()` 兜底（覆盖已存在 localStorage 的旧存档） |
| 3 | `body` 顶掉 `content` → **空位全部消失** | 题包把"表格/摘要的小标题"写进 `body`、真正的题干写进 `content` 时，适配器优先取 `body`，于是只渲染一行标题、`[Qn]` 空位全丢（考生无从作答） | `adapter.ts`：优先取**非空 content**，只有 content 缺失才回退 body |
| 4 | 词库摘要题的选项**只能选一次** | 官方答案允许同一选项重复（Test 4 阅读 Q30-34 的 B 用两次），但词库池 "用掉即置灰 + 不可拖/不可点" → 第二处填不进去，成绩少 1 分 | `QuestionGroups.tsx` 词库池改为**可重复使用**（已用过的仅变淡，`.used-once`），提示文案改为"已放入 n / m 个不同选项（同一选项可重复使用）"。**段落标题匹配（matchingHeadings）仍保持"用掉即锁死"**，不受影响 |

> 缺陷 4 与交接报告 issue-01 同源：D4 当时只把 `matchingFeatures`（配对题）改成可重复，**词库摘要题漏改**。
> 现在两类"选项可复用"的题型语义一致，端到端逐组验证（`--repeat-check`）。

## 2026-10-07 第三轮：题图从 localStorage 迁到 IndexedDB（修"导入超配额"）

**现象**（用户实测）：导入 `剑7_Test4_题包_deepseek版.zip` 报
`题包导入失败：Failed to execute 'setItem' on 'Storage': Setting the value of 'ielts15-tests' exceeded the quota.`

**根因**：题包里的题图（Test 4 的平面图 673 KB + 写作图表 749 KB）被 `importZip` 转成 base64 data URL 后
**内联写进了 localStorage**。localStorage 配额约 5 MB，而音频早就走了 IndexedDB，图片这一路漏了 ——
Test 2（约 0.4 MB）+ Test 3（约 2.6 MB）+ Test 4（约 1.9 MB）累计必然爆。

**修复**：
1. `lib/media.ts`：IndexedDB 升到 **v2**，新增 `images` 对象存储（升级时对已存在的 store 做存在性判断，避免 `createObjectStore` 抛错）；
   新增 `saveImage/loadImage/deleteTestMedia`（删除题包时连音频一起清）。
2. `lib/store.ts`：`StoredTest` 新增 `images: ImageSlot[]`（记录每张图属于哪里、媒体键是什么）；
   新增 `collectInlineImages / stripInlineImages / attachImages / offloadImages / hydrateTest / migrateInlineImages`。
   写 localStorage 前把图片替换为空串，读题库时再从 IndexedDB 填回内存。
3. `components/Home.tsx`：导入/抽取/修正保存一律走"图片入库 + 剥离后写 localStorage"；
   题库列表在挂载与刷新时 `hydrateTest` 补回图片；**并在挂载时做一次性迁移**，
   把历史版本内联在 localStorage 里的题图搬到 IndexedDB（用户刷新一次页面即可自动腾出空间）。
   配额仍溢出时给出人话提示："本地存储已满：请在「我的题库」里删除不再需要的旧题包，然后重新导入。"
4. 新增验收脚本：`scripts\probe-image-storage.cjs`（图片补回 + 旧数据迁移）、
   `scripts\probe-multi-pack-storage.cjs`（连续导入四套题包）；`run-pack-e2e.cjs` 也加了
   "localStorage 无内联图片 / 体积 < 2 MB / 题图能在界面上解码"三项断言。

**实测**：连续导入 Test 1-4 四套题包 → localStorage 累计 **303 KB**（旧实现 5 MB+ 直接爆），
残留内联图片 0 处，8 个题图槽位全部能在 IndexedDB 里取到真图（998 / 813 / 213 / 518 KB），
听力地图与写作图表在界面上正常渲染；迁移路径实测 374 KB → 81 KB。

**自愈与可诊断性（同日追加）**：
- **每次导入题包前**都先跑一次迁移（幂等）→ 即使 localStorage 里全是旧版内联图片，导入也能自己腾出空间；
  若保存仍因配额失败，会"迁移 → 重试一次 → 再给人话提示"，不再把 DOMException 抛给用户。
- 首页页脚显示**构建时间戳**（`build 2026-10-07 12:45`，由 `vite.config.ts` 的 `define: __BUILD_TIME__` 注入）——
  用于判断浏览器里跑的到底是不是最新构建（浏览器缓存排查）。
- 验收脚本：`scripts\probe-quota-recovery.cjs` —— 构造 3.1 MB 的"旧版内联图片"存储后导入新题包，
  实测最终 **236 KB / 内联 0 处 / 三套题包齐全 / 无报错**。


---

## 2026-10-07（第二轮）· 滚动定位、原卷 Example 显示、答案等价写法

### 1. 修复「点开始后自动跳到中间」

**根因**：第一轮做"当前题只在主动导航时改变"时引入的 `scrollTargetRef`（记录跳题目标）**只写不清**。
同一页面会话里先做过一套题、点过题号，再开新题时 `opened` 从 false→true 会再次触发滚动 effect，
它拿着**上一套题遗留的题号**又滚一次；听力界面四个 Section 同时存在 DOM 里，于是内容区直接跳到中段。
另外底部题号条用 `scrollIntoView({block:'nearest'})`，会连带滚动最近的祖先滚动容器，布局不同则表现不同。

**修复**：`App.tsx` 里滚动目标改为**只消费一次**（用完立刻清空），并在开考重置时显式清空；
`BottomNav.tsx` 改为只滚题号条自身（`scrollTo({left})` 计算居中），不再调用 `scrollIntoView`。

**验收**：`scripts/probe-start-scroll.cjs`（给所有滚动 API 打点）——开考前后内容区 `scrollTop` 全程 0，
唯一滚动调用是题号条自身的 `scrollTo{left:0}`；`scripts/probe-triggers.cjs` 确认点题号/上下题/切 Section 仍正常滚动。

### 2. 原卷 Example（Sample）在界面上单独显示、且不计分

- `types.ts` 新增 `QuestionGroup.exampleText`；`lib/adapter.ts` 支持三种原卷写法——
  `{"paragraph","answer"}`、`{"label","answer"}`、`{"text"}`（整行原文），统一生成 `exampleText`；
  **不再**把示例追加进 `instruction`。
- `components/QuestionGroups.tsx` 在题组指令下方单独渲染一行 `.group-example`（左侧细框、标注 Example），
  `App.css` 补样式。示例天然不进 `blank_numbers`，因此不参与判分。
- 四套题包的原卷示例：Test 1 听力 S1 `Distance: 147 miles` + 阅读 P2 `Example B → iii`；
  Test 2 阅读 P3 `Example Section A → vi` / `Section D → ix`（听力表单内的示例行本就在 content 里）；
  Test 3 阅读 P2 `Example Section G → viii`；Test 4 听力 S1 `Surname: Yuichini`（在 content 里）。
- 验收：`scripts/probe-example-render.cjs`（Test 1、Test 3 实测通过：Example 行单独渲染、指令不再被污染）。

### 3. 答案「可接受多答案」按证据补齐（题包侧）

新增 `scripts/audit-answer-variants.py`：对四套 8 份 answers.json 逐条与录音原文（Tapescript）/
阅读原文比对，检查单复数、英美拼写、数字↔数词、缩写↔全称。审计出 12 条建议，
**逐条回图核对答案所在句子**后采纳 12 处、驳回 9 处（驳回理由与被拒条目全部留档）。
详见 `相关资料/05_校对与验收/答案变体审计_2026-10-07.md`。

### 4. 四套题全量回归（本轮）

`run-pack-e2e.cjs --repeat-check --reverse` 四套全部 **ALL PASS**（听力 40/40、阅读 40/40、反向 0 判对、
题图解码、四段音频可播、无页面错误）；`probe-drag-drop.cjs` 覆盖 Test 1/2/3/4 的配对题与词库题拖拽（含同一选项重复使用）。
新增 `scripts/dump-question-text.cjs`：把界面上真正显示的题面逐 Section/Passage 导出成文本，用于人工通读核对
（产物在 `相关资料/05_校对与验收/题面通读/`）。


### 5. 质检回修：两个"题面不显示"的代码级缺陷（同日）

**5.1 `sentence_completion` 未取组正文 → 题干整段消失**

`lib/adapter.ts` 的 `sentence_completion` 分支只把 `questions[].text` 拆成前后文，
**完全不看组 `content`**。于是当题包把句子写在 `content`、`questions[].text` 只写 `Blank 21` 时
（Test 4 听力 Questions 21-22 就是这样），界面只剩 "Blank 21"，考生无法作答。

修复：把 summary/notes/table 那套"统一正文"逻辑抽成 `applyBodyGroup()`；
`sentence_completion` 若检测到 `content` 里有 `[Qn]` 且每题文本没有占位符，就走同一条渲染，
否则维持按题渲染（Test 1 阅读 Q10-13 属后者，未受影响）。

**5.2 阅读题图从未被使用 → 地图/示意图静默丢弃（两处漏网）**

- `lib/zipPack.ts`：zip 内 `figure_image` 路径 → data URL 的转换**只写在听力循环里**，阅读段落没有这一步。
- `lib/store.ts`：图片槽位收集/回填只处理 writing（`figureImage`）与 listening（原始结构的 `figure_image`），
  阅读存的是**适配后**结构（`passages[].groups[].figureImage`），既没被收集、又被 `stripInlineImages` 清空，永远回不来。

修复：阅读段落同样做路径→data URL 转换；`collectInlineImages` / `attachImages` 增加 `reading/<篇>/<组>` 槽位。
实测 Test 3 阅读 P2 的 "Early Population Movement to the Americas" 地图（1283×1300，268 KB）已在 Q20-21 上正常渲染。

### 6. 质检回修：题包数据（同日）

| 题包 | 修复 |
|---|---|
| Test 1 | 听力 S1 的 6-10 组 `content` 末尾误挂的 `Example: Distance 147 miles` 删除（示例只应属于 1-5 组）；阅读 P2 补 2 条脚注（`* underground stores of water`、`* 1 gallon: 4.546 litres`） |
| Test 2 | 听力 S2 的 `context` 原写成 Test 1 S1 的标题（Transport from Airport to Milton），改为实际内容（游船/观光） |
| Test 3 | 阅读 P2 新增地图 `reading/fig_p2_map.png` 并挂到 20-21 组；补 6 条脚注（New World / modern Native American / Inuit and Aleut / DNA / crown-root / incisor-premolar-molar） |
| Test 4 | 阅读 P2 补 3 条脚注（spawners / spawn / MSC） |

四套题最终回归：`run-pack-e2e.cjs --repeat-check --reverse` **全部 ALL PASS**
（Test 2 的同号双空题需带 `--fills=…v2.fills.json`）。


### 7. 界面收尾：表格排版、标题格式、同号双空、词库提示（同日）

| 项目 | 之前 | 现在 |
|---|---|---|
| **文字+表格混排** | 整块 `whiteSpace: pre-line`，靠空格硬排 → 列串位、长句撑爆 | 正文里 `\|` 分隔行渲染成真表格：表头底色、`border-collapse`、单元格 `white-space:normal`+`word-break`、外层 `overflow-x:auto`（窄屏横向滚动）、`[Qn]` 输入框直接落在单元格内 |
| **阅读正文里的表格** | 只渲染一行标题（数据丢失） | `ReadingView` 也用 `buildBodyBlocks()`；Test 4 阅读 P3 的 `Table 1: Proofreading Errors and Noise` 已从 PDF 补数据并渲染成表格 |
| **表格列对齐** | 剥掉首尾 `\|` 会吃掉空的左上格 → 表头比数据少一列 | `splitRow()`：只有"两端都有 `\|`"才当边框剥掉，否则保留空单元格 |
| **题组标题** | 一律 `Questions X-Y` / `Questions 40` | `rangeTitle()`：单题 `Question 40`；两连号 `Questions 27 and 28`；三题及以上 `Questions 1-5`（与卷面一致） |
| **同号双空题** | 同一题号显示两次 | 题号只在第一个空显示（卷面同样只印一次）；输入框新增 `data-q` / `data-occ`，供验收脚本稳定定位 |
| **词库提示** | `已放入 0 / 11 个不同选项（同一选项可重复使用）` | `已用 X / Y 个选项 · 同一选项可重复使用` |

**回归**：四套题 `run-pack-e2e --repeat-check --reverse` **全部 ALL PASS**（Test 2 的同号双空题带 `--fills`）。
新增探针 `scripts/probe-ui-details.cjs`（检查正文表格数、同号双空题号个数、组标题格式、段落标签间距）。


### 8. 拖拽反馈：轻微但有感（同日）

原先落位后只有"槽里多出文字 + 选项变淡"，反馈偏弱。补上状态，但**刻意做得克制**：

| 阶段 | 反馈 |
|---|---|
| **拖动中** | 被拖的那一枚选项 `.dragging`：透明度 0.45 + 轻微缩小（知道自己拖的是哪一枚） |
| **拖到槽上** | 槽 `.over`：虚线变**实线蓝框** + 底色略深（沿用原配色）+ 放大 3%（**不加发光、不换色**）；空槽文字由 `…` 变成 `松开放入` |
| **落位成功** | 槽 `.just-dropped`：**一次很轻的脉冲**（缩到 0.97 → 弹到 1.02 → 回到 1，底色轻闪一下），**0.35 秒结束** |
| **落位之后** | 配对题选项置灰锁定（`.used`）；词库题选项变淡（`.used-once`，仍可重复使用） |

> 迭代记录：第一版做过"绿框脉冲 + 右上角绿色 ✓ 徽标 + 发光"，实际观感过于夸张（用户反馈"太诡异/夸张"），
> 已全部去掉对勾与绿框，只保留沿用原配色的极轻微脉冲。

点选模式（点选项 → 点空位）走同一条路径，同样有落位脉冲。
实现：`QuestionGroups.tsx` 的 `dropFlash`（380ms 后自动清除）与 `draggingChip` 两个状态；
`App.css` 的 `.dragging` / `.over` / `.just-dropped` 与 `dropSettle` 动画。

**验收**：`scripts/probe-drag-drop.cjs` 断言四段状态（`.dragging` / `.over` / `.just-dropped` / 落库），
配对题与词库题两条路径全部 PASS，并自动截图到 `相关资料\08_截图\自动截图\拖拽反馈_*.png`；
四套题端到端回归 **全部 ALL PASS**。


## 9. 表格渲染修复（2026-10-08 晚）

用户反馈"表格错位"。定位到**两类原因**，都已修：

1. **渲染器（真 bug）**：笔记题/表格填空题共用的 listify 断行规则（在 :+大写、•、句号+大写处插入换行）被应用到了**表格行**上，
   一行表格会被拆成多行 → 表格被切成碎片，看起来错位。现改为 **含 | 的行不做 listify**。
2. **表格块识别**：连续含 | 的行整体视为一个表格块（此前"只有一个非空格"的续行会被判成普通文字、甩到表格外）。
   另对列数不齐的块**自动补齐到最大列数**（表格永不缺格）。
3. **列宽**：单元格加 min-width:108px，避免窄列被挤成每行几个字符（超出时外层横向滚动）。

**数据侧同时修了 3 处**：剑21 Test2 阅读 P1 表头缺一列、剑21 Test3 听力 S2（matching_features 组正文多余，已清空）、
剑7 Test2 听力 S2 表头/数据/续行列数混排（重排为整齐三列表格）。

**回归**：剑21 四套 + 剑7 四套，全部 听力 40/40 + 阅读 40/40 ALL PASS；截图见 相关资料/08_截图/自动截图/表格修正4_*.png。


## 10. 音频接入 + 导出/修正/高亮（2026-10-08 深夜）

1. **听力音频**：用户提供的 16 个 mp3（剑21 Test1–4 × Section1–4）按 `listening/sectionN.mp3` 装入四个题包；
   实机验证：4 段音频全部可解码并在走（每节 370–560 秒，符合真实 Section 长度）。
2. **导出 zip 变完整**：`exportZip()` 重写——现在导出 **听力 4 节 JSON + 音频 + 听力答案 + 阅读 3 篇 + 阅读答案 +
   写作 2 题 + Task1 图表 + 全部题图 + manifest**，不再"音频不进导出"。
   题图从 IndexedDB 取出落成 PNG，并把 JSON 里 `figure_image` 指向包内路径，保证再导入 1:1 还原。
   往返实测：导出包 19 项 / 45.9 MB，重新导入后音频正常、听力 40/40、阅读 40/40。
3. **高亮只剩黄色**：批注工具条去掉绿/粉两色，只留黄色 Highlight（旧的绿/粉存档也按黄色渲染）。
4. **修正界面升级**：新增标签页 —— 阅读 / **听力（原来完全不能改）** / **答案（听力+阅读 80 空）** /
   **媒体（上传替换音频、替换题图）** / **提示（逐条标记已处理）**；阅读的修改会同步写回导出所用的原始结构。
5. **打包器修 bug**：`build_pack.py` 此前只扫听力段的题图，阅读段的图（如剑21 Test4 的流程图）会漏打 → 已补上。


## 11. 假告警修复："含图已用占位框代替"（2026-10-08）

**现象**：剑21 Test4 导入后在题库行显示 "1 条待确认"，点开是
Questions 8-10：flow_chart_completion 含图，已用占位框代替 —— 但该题组的流程图**已经打进题包**（修正→媒体 里能看到图）。

**根因**：适配器对 low_chart_completion / diagram_labelling **无条件**推这条提示，从不检查 igure_image 是否存在。
题包早期确实没图，这条提示当时是对的；后来图补进题包，它就变成了误导性假告警。

**修复**：
1. 适配器改为**只在题组确实没有图时**提示，并把文案改成可操作："需要配图，但题包里没有图（已用占位框代替，可在「修正 → 媒体」补图）"；
2. 题库行不再只显示"N 条待确认"，而是**直接显示第一条问题的内容**（悬停看全部），点击即打开「修正 → 提示」；
3. 「修正 → 提示」新增**重新诊断**：按当前题库内容重跑校验/适配，清掉题包更新前遗留的旧记录（无需重新导入）。

**验证**：剑21 四套 + 剑7 四套导入诊断均为 **0 条**；把 T4 的图故意移除后能正确报出该提示（条件判断有效）；
剑21 Test4 含音频复跑 40/40 + 40/40 ALL PASS，流程图题渲染的是真图 + 题干。


## 12. 表格"错位"的真正根因：多行单元格被拆成独立行（2026-10-08）

用户抽查反馈：剑21 Test1/Test2 听力仍有表格错位。逐条查证后定位到**两类**问题：

1. **表格被切成一段段**（T2 听力 S1 最明显）：录入时把"多行单元格"写成了**独立行**（有的还夹着空行），
   例如 Notes 列里的 `There are no places at present.`、`• use a drill, saw and 10 [Q10] .`。
   渲染器此前只把"连续含 `|` 的行"当一个表格块，于是这些续行落到表格**外面**，表格被拆成多个碎片。
   **修复**：表格块内遇到非 `|` 的行（含空行）一律并入**上一行最后一个非空单元格**
   （单元格内换行，`white-space: pre-wrap` 如实显示）；只有 `NB/Note/Example/...` 开头或短句以 `:` 结尾时才判定表格结束。
2. **笔记题行距翻倍**（T1 听力 S4 最明显）：`listify` 的列表标记断行规则对**已经在行首的 `•`** 又插了一次换行，
   每个要点前多出一个空行。**修复**：列表标记已在行首时不再插换行（用 replace 的 offset 判断）。

**验证**：
- 静态扫描（模拟同一套分块规则）八套题 **0 处表格会被截断**；
- 截图对比：`08_截图/自动截图/错位_T2听力S1_修复前.png` ↔ `错位_T2听力S1_修复后.png`（碎片 → 6 行完整表格）；
  `T1听力S4_行距修复后.png`（行距恢复正常）；
- 剑21 四套（含音频）+ 剑7 四套全量回归 **ALL PASS**。

**排查中确认的事实**：用户的 `localhost:4173` 与开发目录提供的 bundle 是同一个（`index-CQj_t07w.js`），
即用户看到的确实是当前构建；T1 听力唯一的表格（S1 Q1-6）本身正确，T1 的观感问题来自上面的第 2 类。


## 13. 剑16/17 制包带出的三种题型渲染修正（2026-10-09）

1. **`list_selection` 按"每题独立题干"判断渲染方式**：卷面 "Choose FOUR answers from the box … next to questions 27-30"
   是**每题选一个字母**（与匹配特征同构），此前被当成整组共享多选（所有题共用一份答案、互相覆盖），
   现按"每题题干是否各不相同"区分：独立题干 → 每题一个字母下拉；共用题干 → 整组多选（Choose TWO/THREE）。
2. **`diagram_labelling` / `flow_chart_completion` 支持"空位在图上"**：正文无 `[Qn]` 且组级带字母选项表时，
   渲染为"配图 + 每题一个字母下拉"（剑16 T4 听力 S2 园区平面图 A–I）。
3. **打包器占位符检查放宽**：问句式填空（题干即完整问句）与带配图的题组不再要求正文含 `[Qn]`。


## 14. 判改窗泄露修复 + 完整对错表 + 真实用时 + 首页视觉改版（2026-10-10 / 10-11）

1. **判改窗泄露修复**：交卷后不再自动弹出「判改模型配置」窗，收卷屏也不再出现「现场判改」入口。
   判改配置只存在浏览器本地（`ielts15-llm-config`），任何界面都不回显 Base URL / API Key / 模型名（探针脚本 `scripts\probe-llm-leak.cjs` 逐界面扫描）。
2. **完整逐题对错表**：交卷时把听力 40 行 + 阅读 40 行的逐题明细写进练习记录（`ielts15-history`），
   首页「练习记录 → 看对错表」用成绩单同一套表格组件渲染（列：Q / Your answer / Result / Time）。
   为防 localStorage 配额，只有**最近 20 条**保留明细，更早的自动裁掉（`score/total/band` 保留），
   老记录按钮显示「这场没存明细」且为 disabled，点了不报错。
3. **用时改为真实墙钟**：练习记录 `durationSec` 与成绩单「Time used」不再按 1.5 小时虚高计算。
4. **首页视觉改版**：初始界面改成"官方机考界面"的观感 —— 深炭灰报头 + 强调红细线/主按钮 +
   直角化卡片 + 发丝分割线 + 中性灰文字；开始练习弹窗的选中态同步换色。
   考试界面（顶栏 / 底栏 / 题干 / 成绩单 / 对错表）本轮未改动。
5. **界面与交付物去品牌词**（见第 15 节）：报头不再出现第三方考试的文字标识或图形，界面文案、
   免责声明、下载文件名、exe 名、使用说明与工具脚本一律不含该名称。
6. **发布包排除规则**：`scripts\`（含泄露探针与测试残留）、开发期自动备份文件（`*.bak_*` 与 v2 备份）、
   运行时产生的日志与自检报告文件、`_advtest\`、`dist` 下的 sourcemap，一律不进发布包。


## 15. 去品牌词（2026-10-11）

**动机**：交付物里不出现任何第三方考试机构的名称与标识，避免商标/关联性误认。

**改动范围**

1. **界面可见文案**：报头的文字标识整块删除（`.hero-mark` 及其样式一并移除）；标题改为
   「英语机考模拟器」；浏览器 `<title>` 同步；页脚与开始练习弹窗的免责声明改成
   「非官方练习界面 · 与任何考试主办方无关联，未使用其商标与标识」/「not affiliated with any
   examination body」（不再点名任何机构）。
2. **交付文件名与说明文档**：exe 改名 `英语机考模拟器.exe`；发布包改名
   `英语机考模拟器_发布包_YYYY-MM-DD_HHMM.zip`；`使用说明.txt`、`备用启动.ps1`、
   `环境自检.ps1/.bat`、`build-launcher.ps1`、`Launcher.cs`（控制台标题/日志名/互斥量/实例探测头）
   里出现的旧名称全部替换。
3. **源码内的说明性文字**：`scoring.ts` / `store.ts` / `types/extracted.ts` 注释、`llm.ts` 提示词、
   `prompts/extract.md`、`assets/bandDescriptors.json` 的备注、CSS 变量 `--ielts-red` → `--accent-red`。
4. **保留不动（有意为之）**：浏览器本地存储键名 `ielts15-*`、IndexedDB 库名 `ielts15-media`、
   分栏键 `ielts-cbt-split`、以及本仓库/包名 `ielts-cbt-simulator-v1.5-listening`。
   —— 这些改动会让所有人已有的题库、作答、成绩、对错表**全部读不出来**，属于数据兼容红线。
5. **不在本次范围**：题包（`.zip`）内部的试卷名称（制包时写进 manifest 的 "Cambridge … · Test N"）来自题包数据本身，
   要改必须按制包流程重新生成全部题包与题包合集。


## 16. 写作判改重新开放 + 评分理由 MD 报告（2026-10-11）

1. **WRITING_GRADING 开关**：`src/lib/features.ts` 新增 `export const WRITING_GRADING = true;`（`ADVANCED` 保持 `false`）。
   判改相关门控从 `ADVANCED` 改挂 `WRITING_GRADING`：Home.tsx「高级：写作判分模型」槽位表单、
   StartModal.tsx 判改提示行与 `gradeWriting` 计算、App.tsx 五处（判改弹窗节点、startTest、判改 useEffect、
   交卷后自动弹窗 useEffect、writingGradeSlot）。PDF 抽取 / JSON 导入 / 演示题 / 导出题包仍由 `ADVANCED` 保持关闭。
2. **评分理由 Markdown 报告**：判改出分后立即调 `gradeWritingRationale`（`src/lib/llm.ts`）生成中文 MD 报告 ——
   每篇 Task 一节、四维小节含"得分 → 官方档位描述要点 → 定档理由（引用原文证据）→ 提半分建议"，
   末节制明 Task 2 权重 2/3 折算与"AI 评分仅供参考，非官方成绩"声明。
   模型生成失败时用 `buildGradingMdFallback`（`src/lib/reportMd.ts`）纯本地拼同结构报告（reason/evidence + 内置
   Band Descriptors 摘要），报告末尾标注"（本报告为离线简版：模型生成详细理由失败）"，绝不让 MD 缺失。
3. **页面内展开/下载**：新组件 `src/components/WritingReportBox.tsx`，渲染在 WritingGradeBox 下方，
   提供「展开查看 / 收起」（等宽 `<pre>` 可滚动展示 MD 原文，不新增 markdown 渲染依赖）与「下载 .md」
   （`写作判改报告-${test.name}.md`）；报告生成中显示"报告生成中…"。样式加在 `src/App.css`（`.ai-report-*`，沿用 ai-grade-box 风格）。
   开考 / 重来时 `wGradeMd` 与 `wGradeMdState` 同步重置。
4. **修：自动判改时不再误弹「现场判改」窗**：交卷瞬间判改 useEffect 与自动弹窗 useEffect 同一帧执行，
   后者看到的还是判改前的旧状态（`wGradeState==='idle'`），于是考前已配置好模型的卷子也会多弹一次窗
   （实测剑21 Test 1 写作）。现加守卫：`session.gradeWriting && wGradeState !== 'error'` 时不自动弹
   （判改失败仍允许弹出作为重试入口）。


## 17. 收卷卡滚动修复 + 写作判改入练习记录（2026-10-11）

1. **收卷卡顶部滚不到修复**：`.overlay` 加 `overflow-y: auto`（全局弹窗同享），新增 `.overlay > * { margin: auto; }` ——
   内容矮时 margin auto 照样居中，内容高时从顶部起可全程滚动（修 flex 居中把超高内容上半截推出视口的经典 bug，
   判改区 + MD 报告展开后收卷卡 "Test ended" 标题被切的问题即此）。
   配套：`.ended-card` 规则里去掉已是死代码的 `margin: 90px auto`（三张卡都在 overlay 内、且此前都被内联 `margin: 0` 覆盖），
   App.tsx 三张 `.ended-card` 上的内联 `style={{ margin: 0 }}` 删除，统一受 `.overlay > *` 管；
   `.result-card`（自带 max-height:90vh 内滚）与 `.modal` 表现不变。
2. **写作判改结果存入练习记录**：`PracticeRecord` 新增 `writingBand` / `writingGrade` / `writingReportMd` 可选字段；
   `history.ts` 新增 `updateRecord(id, patch)`（配额失败时退化为裁掉全表 table 与 MD 再写一次）；
   `withoutTables` 同策略裁掉 `writingReportMd`（约 12 KB/条，只有最近 20 条保留；grade/Band 体积小全留）。
   App.tsx 用 `recordIdRef` 记住本次交卷的记录 id，判改与 MD 报告（含离线兜底版）都完成后回写
   `writingGrade` / `writingBand`（与成绩单同一 Task2 权重 2/3 折算）/ `writingReportMd`，落库失败不影响界面。
3. **首页回看**：「练习记录」scoreText 有 band 显示 `写作 Band X.X`；`hasDetail` 扩展为"有逐题表或有 writingGrade"，
   无表但有判改的记录按钮显示「看判改」可点；详情弹窗在对错表下方渲染 WritingGradeBox + WritingReportBox
   （可展开/下载 `写作判改报告-*.md`），有判改时不再显示"这场没存明细"提示。
   红线保持："AI grading is for reference only" 标注原样保留；判改只作字段存档与回看，不新增任何趋势图。
