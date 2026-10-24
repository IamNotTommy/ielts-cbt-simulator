# 英语机考模拟器：八项功能实施规格

> 本文档交给编码模型直接实施。目标是在现有项目上渐进增加：未完成练习中心、交卷前检查、写作答卷历史、轻量错题复盘、学习分析看板、词汇间隔复习、全量备份与恢复、统一搜索。
>
> 不是产品头脑风暴。本文中的数据结构、首版边界、阶段顺序和验收条件均应执行；遇到与源码不一致的地方，先以实际源码核实，再做最小兼容调整，不要借机重写应用。

---

## 0. 给实施者的硬性要求

### 0.1 工作方式

1. 按本文第 12 章的阶段顺序实施，每个阶段完成后先构建、做该阶段验收，再进入下一阶段。
2. 不要一次性重写 `App.tsx`、`Home.tsx` 或全部 CSS。优先新增数据层和子组件，通过小接口接入现有页面。
3. 不更换 React、TypeScript、Vite、Tailwind、Radix UI、JSZip、Recharts 等现有技术栈，不新增依赖。
4. 不执行 git commit、push、reset、rebase，不删除用户数据，不调用真实收费 LLM 接口做测试。
5. 不读取、打印或打包 API Key。写作再次判改的代码可以复用现有配置，但自动化验收使用模拟结果。
6. 保留 `ADVANCED`、`WRITING_GRADING` 功能开关。判改相关 UI 在 `WRITING_GRADING=false` 时不得出现，写作原稿历史仍应可用。
7. 保留实考模式限制，不在实考过程中加入答案、AI 建议、暂停或跳过等练习能力。
8. 新功能使用中文管理界面；题干和考试材料保持英文。
9. 所有新增持久化字段必须可选或有默认值，旧版本数据不得因缺字段而崩溃。
10. 如果标准构建失败，先修复；不得通过删功能、跳过 TypeScript 或关闭检查来伪装完成。

### 0.2 现有工程事实

- 前端：`源码/src`。
- 构建：`cd 源码 && npm run build`，即 `tsc -b && vite build`。
- 开发：`npm run dev`，Vite 端口 3000。
- 当前没有项目测试脚本，不要自行引入新测试框架。按本文手工验收矩阵执行。
- `npm run lint` 只有在现有 ESLint 配置实际可用时才作为门禁；若配置缺失，明确报告，不要临时换装 lint 体系。
- 题库：`ielts15-tests`。
- 练习记录：`ielts15-history`，最多 200 条，最近 20 条保留逐题表和写作 MD。
- 作答存档键：通过 `tk(testId, what)` 生成。
- 音频/录音和题图：IndexedDB `ielts15-media`，store 为 `audio`、`images`。
- 精读：`ielts15-intensive-<key>` 与 `ielts15-wordbook`。
- 精听：`ielts15-lnote-<key>` 与 `ielts15-lwords`。
- 启动器提供同源 `/api/store/*`、`/api/media/*`、`/api/notes/*`、`/api/lnotes/*` 等接口；API 不可用时前端退回浏览器本地。
- 已有 `jszip`，备份功能直接复用。
- 已有 `recharts`，分析图表直接复用。

### 0.3 不重复建设的功能

以下已经存在，不要重新实现：

- ZIP 题包导入、结构化修正、音频和题图存储。
- 阅读/听力/写作、单篇/单 Section/整卷/Full length。
- 答案、作文、笔记、高亮、每题用时和倒计时自动保存。
- 精读、词典、词汇册、翻卡、精听、听写、AB 循环、错因、跟读。
- 写作首次 AI 判改、四维评分和 MD 报告。
- 成绩趋势所需的原始练习记录。
- 题包本身的导入导出。本文的“全量备份”是用户数据备份，二者不能混为一谈。

---

## 1. 总体架构

### 1.1 页面入口

在 `Home.tsx` 增加统一管理入口，不引入路由库：

```text
练习首页｜学习分析｜错题复盘｜词汇复习
                         顶部右侧：统一搜索｜数据管理
```

建议新增 Home 状态：

```ts
type HomePanel = 'analytics' | 'review' | 'vocabulary' | 'data' | null;
const [panel, setPanel] = useState<HomePanel>(null);
```

各面板使用全屏 overlay，与现有精读、精听、词汇册一致。首版不改 URL，不做 React Router 迁移。

### 1.2 建议新增文件

```text
源码/src/lib/activeSession.ts
源码/src/lib/writingHistory.ts
源码/src/lib/learningStore.ts
源码/src/lib/review.ts
源码/src/lib/vocabulary.ts
源码/src/lib/analytics.ts
源码/src/lib/backup.ts
源码/src/lib/search.ts

源码/src/components/ActiveSessionCard.tsx
源码/src/components/SubmitReviewModal.tsx
源码/src/components/WritingHistoryView.tsx
源码/src/components/WritingRevisionEditor.tsx
源码/src/components/ReviewCenter.tsx
源码/src/components/ReviewQuestionView.tsx
源码/src/components/AnalyticsView.tsx
源码/src/components/VocabularyCenter.tsx
源码/src/components/DataManager.tsx
源码/src/components/GlobalSearch.tsx
```

可按实际代码量合并过小的组件，但数据层必须独立，不要把存储、筛选、统计全部写进 `Home.tsx`。

### 1.3 新数据同步原则

新增两类启动器持久数据：

1. `学习数据.json`：错题复盘和词汇间隔复习进度，体积较小，整量 JSON。
2. `写作/<recordId>.json`：每场写作答卷和修改稿，按记录分文件，避免整量读写大文件。

浏览器仍是工作缓存；启动器 API 不可用时所有功能继续可用。同步失败不能阻断交卷、复习或导出。

---

## 2. 功能一：未完成练习中心

## 2.1 目标

- 首页直接继续上次练习。
- 显示范围、当前阶段、作答进度、剩余时间和最后作答时间。
- 练习模式听力不限时，也必须能恢复，不能依赖是否存在 timer。
- 支持继续、重新开始、放弃进度。
- 每套题首版最多一个 active session。

## 2.2 数据结构

在 `activeSession.ts` 定义：

```ts
import type { SessionConfig } from './store';

export interface ActiveSessionMeta {
  version: 1;
  testId: string;
  startedAt: number;
  updatedAt: number;
  config: SessionConfig;
  mode: 'reading' | 'listening' | 'writing';
  fullPhase: 'listening' | 'reading' | 'writing';
  current: number;
  partIdx: number;
  wPart: number;
  untimed: boolean;
}
```

存储键：

```ts
const sessionKey = (testId: string) => tk(testId, 'active-session');
```

实现：

```ts
loadActiveSession(testId): ActiveSessionMeta | null
saveActiveSession(meta): void
clearActiveSession(testId): void
listActiveSessions(tests): ActiveSessionMeta[]
discardSession(testId): void
```

`listActiveSessions` 可以遍历传入题库并逐套读取，避免无约束扫描不相关 localStorage。

`discardSession` 只删除该题当前作答数据。下面写的是传给 `tk(testId, what)` 的 **`what` 实际键名**，必须保持大小写：

```text
answers
lanswers
essays
notes
highlights
times
ltimes
timer
active-session
```

即听力答案和用时分别对应 `tk(testId,'lanswers')`、`tk(testId,'ltimes')`，不能使用 React state 的 camelCase 名称当存储键。

不得删除：

- 题库本身。
- 已交卷 PracticeRecord。
- 写作历史。
- 精读/精听和词汇。
- 错题复盘。

## 2.3 与现有状态机的接入

修改 `App.tsx` 和 `Home.tsx`：

### 完整传递 new/resume 意图

```ts
type BeginIntent = 'new' | 'resume';
```

该意图必须贯穿整条链路：

```text
ActiveSessionCard / 题库条目 / 搜索结果
→ Home.onStart
→ App.startTest
→ pendingSession（需要写作判改配置时）
→ beginTest
```

- `pendingSession` 增加 `intent`，经过判改配置弹窗后不能丢失。
- resume 不打开 StartModal，直接按 active-session 中的 config 恢复；若仍需判改配置，只显示判改配置，不让用户重选范围。
- new 按正常 StartModal 流程进行。
- 普通题库“开始练习”发现 active session 时，统一弹出“继续上次/重新开始/取消”。
- 重新开始确认后先调用 `discardSession(testId)`，再以 `new` 进入，不允许旧 timer 被隐式恢复。
- 首页继续卡、题库继续按钮和搜索跳转必须复用同一个入口函数，不能各自实现一套恢复逻辑。

建议将 `beginTest` 改成参数对象，避免继续增加位置参数：

```ts
beginTest({ test, session, gradeWriting, intent })
```

### beginTest

- new：清空已确认要放弃的当前进度，创建新的 active-session。
- resume：恢复 `config/mode/fullPhase/current/partIdx/wPart`。
- 限时模式仍以 `tk(testId,'timer')` 的 `secondsLeft` 为倒计时来源。
- 不限时听力没有 timer，使用 active-session 恢复，剩余时间显示 `∞`。
- 开始弹窗文案区分“开始作答”和“继续作答”。

### 作答过程中

以下变化时更新 active-session：

- `mode/fullPhase` 变化。
- `current/partIdx/wPart` 变化。
- `continueToReading/continueToWriting`。
- 每 15–30 秒更新一次 `updatedAt`，不要在每秒倒计时中同步写多个键。

进度不要求存进 meta；首页从 answers/lanswers/essays 动态计算，避免双份进度不一致。

### endTest

区分“阶段结束”和“整场结束”：

- Full length 听力→阅读、阅读→写作时保留 active-session，并更新下一阶段。
- 非 Full length 交卷或 Full length 写作交卷时，清除 timer 和 active-session。
- 已交卷历史记录仍按原逻辑生成。

### 返回首页

- `onHome` 只离开页面，不清 active-session。
- 如果有进行中内容，给出轻量确认：“答案已自动保存，返回后可继续”。不要误写成已经交卷。

## 2.4 兼容旧存档

旧版本交卷后 answers/essays 也会保留，因此**不能根据非空作答推断未完成**。

规则：

- 只有存在有效 timer 时，才可自动认定旧版可恢复进度。
- 能读取 timer 就恢复 scope/mode/fullPhase/secondsLeft，成功后写入 v1 active-session。
- 没有 timer、只有非空 answers/lanswers/essays 时，只能显示中性的“发现这套题已有作答”，由用户选择“尝试继续”或“清除后开始”。
- 不得把这种数据直接归入 active session，也不得伪造完成标记。
- 旧不限时听力没有 timer，无法可靠区分“进行中”和“已交卷”，只能走上述用户确认路径。
- 不得仅凭历史高亮或笔记判定进行中。

## 2.5 UI

新增 `ActiveSessionCard.tsx`，放在首页题库之前。

内容：

```text
继续上次练习
Cambridge IELTS 21 · Test 1
阅读整卷 · Part 2 · 已答 21/40 · 剩余 38:24
上次作答：2026/10/24 14:32

[继续练习] [重新开始] [放弃进度]
```

规则：

- 多套 active sessions 时最近更新在前，默认展示 1 张，其他折叠。
- 听力练习模式显示“不限时”，不是 `0:00`。
- 写作显示两个 Task 的词数，不显示“已答 2/2”代替词数。
- 重新开始和放弃都必须二次确认，清楚列出将删除的内容。
- 题库条目有 active session 时主按钮显示“继续”。

## 2.6 验收

1. 阅读答 3 题，返回首页，显示 3/40 和正确剩余时间；继续后答案与位置恢复。
2. 写作输入两个 Task，返回后继续，正文和词数不丢。
3. 听力练习模式不限时，返回后仍出现进度并能继续。
4. Full length 在听力、阅读、写作各阶段返回，恢复到正确阶段。
5. 重新开始只清当前进度，不删历史。
6. 放弃进度后首页卡片消失，题库和历史仍在。
7. 交卷后 active-session 被清除，不出现“继续已交卷练习”。

---

## 3. 功能二：交卷前检查

## 3.1 目标

手动交卷前展示未答、Flag 和写作词数，允许返回定位，避免误操作。

## 3.2 组件接口

新增 `SubmitReviewModal.tsx`：

```ts
type SubmitSkill = 'reading' | 'listening' | 'writing';

interface ObjectiveSummary {
  kind: 'objective';
  answered: number;
  total: number;
  unanswered: number[];
  flagged: number[];
}

interface WritingSummary {
  kind: 'writing';
  tasks: {
    task: 1 | 2;
    words: number;
    minWords: number;
    hasText: boolean;
  }[];
  flagged: number[];
}

interface Props {
  skill: SubmitSkill;
  testName: string;
  scopeLabel: string;
  elapsedSec: number;
  fullTransition: boolean;
  summary: ObjectiveSummary | WritingSummary;
  onJump(questionNo: number): void;
  onClose(): void;
  onConfirm(): void;
}
```

## 3.3 App 接入

- `TopBar.onFinish` 不再直接调用 `endTest`，改为 `requestFinish`。
- `requestFinish` 计算摘要并打开弹窗。
- `onConfirm` 才调用 `endTest`。
- 时间归零和听力实考自然播完仍直接 `endTest`，不弹窗。
- `onJump(no)` 关闭弹窗并调用现有 `jump(no)`。

### 阅读/听力摘要

复用现有 `answered` 和 `reviewed`，不要重新判断各题型是否已答。

- `unanswered`：`answered[no] !== true`。
- `flagged`：`reviewed[no] === true`。
- 未答和 Flag 可以重叠，分别展示。

### 写作摘要

`wAnswered` 当前用于最低词数状态，不能直接拿来判断“是否空白”。

分别计算：

```ts
hasText = essays[i].trim().length > 0
words = countWords(essays[i])
minWords = writingTasks[i].minWords
```

词数不足只提醒，不禁止交卷。

### Full length

- 听力阶段按钮和标题：“结束听力并进入阅读”。
- 阅读阶段：“结束阅读并进入写作”。
- 写作阶段：“确认交卷”。
- 摘要首先展示当前阶段；若展示前序科目，必须来自已保存数据并明确分组，首版可只显示当前阶段。

## 3.4 UI 与可访问性

使用现有 `components/ui/dialog.tsx` 或补齐等价 Dialog 行为：

- 标题关联、焦点圈定、Escape 返回。
- 未答题号可点击，不能只展示一长串不可操作文本。
- 题号很多时最多直接展示 12 个，其余显示“展开全部”。
- 主操作：“确认交卷”；次操作：“返回答题”。
- 有未答时使用中性警告，不把确认交卷渲染成红色删除按钮。

## 3.5 验收

1. 阅读部分未答、部分 Flag，数字和题号准确。
2. 点击未答题号能跳到对应 Part 和题目。
3. 全部答完仍可交卷，无错误警告。
4. 写作有正文但词数不足时显示“未达到建议词数”，不能显示“未作答”。
5. 自动归零不弹窗。
6. Full length 各阶段文案和后续流向正确。

---

## 4. 功能三：写作答卷历史与修改稿

## 4.1 目标

- 每次交卷保存不可变的原稿和题目快照。
- 历史详情可以查看当次正文。
- 支持从原稿创建修改稿、再次判改和版本对比。
- 修改稿不得覆盖原稿，也不得改写原场次的原始成绩。

## 4.2 数据结构

`writingHistory.ts` 使用独立 IndexedDB：

```text
DB: ielts15-writing
version: 1
store: attempts
keyPath: recordId
```

类型：

```ts
import type { WritingTask } from '../types';
import type { WritingGradeResult } from './llm';

export interface WritingAttemptTask {
  task: 'task1' | 'task2';
  prompt: WritingTask;
  essay: string;
  wordCount: number;
}

export interface WritingRevision {
  id: string;
  createdAt: number;
  updatedAt: number;
  essays: [string, string];          // 当前可编辑草稿
  wordCounts: [number, number];
  status: 'draft' | 'grading' | 'graded';
  gradedEssays?: [string, string];   // 本次判改对应的不可变正文快照
  gradedAt?: number;
  grade?: WritingGradeResult;
  reportMd?: string;
  band?: number | null;
}

export interface WritingAttempt {
  version: 1;
  recordId: string;
  testId: string;
  testName: string;
  submittedAt: number;
  durationSec: number;
  tasks: WritingAttemptTask[];
  originalGrade?: WritingGradeResult;
  originalReportMd?: string;
  originalBand?: number | null;
  revisions: WritingRevision[];
  updatedAt: number;
}
```

实现异步 API：

```ts
saveWritingAttempt(attempt): Promise<void>
getWritingAttempt(recordId): Promise<WritingAttempt | null>
listWritingAttempts(): Promise<WritingAttempt[]>
deleteWritingAttempt(recordId): Promise<void>
clearWritingAttempts(): Promise<void>
createRevision(recordId): Promise<WritingRevision>
saveRevisionDraft(recordId, revisionId, essays): Promise<void>
saveRevisionGrade(recordId, revisionId, gradedEssays, result): Promise<void>
updateOriginalGrade(recordId, grade, reportMd, band): Promise<void>
```

写操作必须按 `recordId` 串行，避免自动保存与判改回写互相覆盖。原稿创建和该记录后续所有更新必须进入同一个 per-record Promise 队列；更新时若暂时读不到记录，不得静默丢弃，应 reject 并保留可重试错误。

## 4.3 交卷时保存原稿

在 `App.tsx endTest` 创建 PracticeRecord 后：

1. 得到 `rec.id`。
2. `addRecord(rec)` 保持现有行为。
3. 如果 `didWriting`，根据当前 `writingTasks` 和 `essays` 创建 WritingAttempt。
4. 保存时复制数据，不引用后续可变 state。
5. 立即把 `saveWritingAttempt` 加入该 recordId 的共享写队列，首次判改更新排在它之后。
6. 原稿判改字段初始为空，异步判改后补齐。

即使未配置模型、判改失败或 `WRITING_GRADING=false`，原稿也必须保存。

`endTest` 在 `addRecord(rec)` 后保留现有 `recordIdRef.current = rec.id`。首次判改 effect 在调用 `gradeWriting` **之前**捕获固定值：

```ts
const targetRecordId = recordIdRef.current;
```

若此时为 null，说明没有可绑定历史，保留错误并停止回写，不能写入其他记录。异步 `.then` 和 MD 内层闭包只使用启动时捕获的 `targetRecordId`；不得在完成时重新读取可能已指向另一场练习的 `recordIdRef.current`。

回写时机：

1. `gradeWriting` 返回四维结果。
2. `gradeWritingRationale` 返回报告，或离线 fallback 已生成。
3. 使用同一个 `targetRecordId` 调用 `updateRecord` 和 `updateOriginalGrade`。
4. 任一副本保存失败不能阻断另一个；界面显示非阻断警告。

这样可避免“原稿尚未创建就更新”和“用户重开后判改写进另一场”的两种竞态。

## 4.4 历史详情

修改 `HistoryDetailModal.tsx`：

- 如果 `record.writing` 为 true，挂载 `WritingHistoryView`。
- 异步读取 `record.id` 对应 WritingAttempt。
- 有数据时显示页签：
  - 本次答卷
  - 判改结果
  - 修改稿与对比
- 老记录只有 `writingGrade` 时继续显示现有判改组件。
- 老记录没有正文时显示：“该记录创建于答卷历史功能之前，未保存正文”，不能报错或显示空白页。

“本次答卷”显示：

- 题目快照，允许展开/收起。
- Task 1/2 正文。
- 当次词数。
- 交卷时间和用时。

图题使用快照中的 `WritingTask` 渲染，避免题库后来修正导致历史题图变化。

## 4.5 修改稿

点击“复制为修改稿”：

- 从原稿 essays 创建一条 revision。
- 若已有草稿，提供“继续最近草稿”和“新建修改稿”。
- 编辑器左侧原稿只读，右侧修改稿可编辑；窄屏改为原稿/修改稿页签。
- 自动保存做 500ms 防抖，关闭前 flush。
- 显示修改稿词数和保存状态。

再次判改：

- 只在 `WRITING_GRADING && graderReady()` 时提供。
- 未配置时按钮打开现有 GradingSetupModal 或明确引导配置，不能静默失败。
- 点击判改后先 flush 草稿，再复制 `gradedEssays` 快照并保存 `status='grading'`。
- 本次请求只发送该快照；判改期间编辑产生的新内容不得改变该快照。
- 结果、报告、Band 和 `gradedAt` 始终关联该 gradedEssays，不得配到更新后的草稿上。
- 判改后若继续编辑，则 `status` 回到 `draft`，保留上一版 gradedEssays/grade 作为历史结果；也可新建 revision，但不能覆盖已判改快照。
- 只有非空 Task 才发送，空 Task 不出现在判改结果中。
- 复用 `gradeWriting`、`gradeWritingRationale`、`buildGradingMdFallback`。
- 总 Band 继续使用 Task 2 权重 2/3 和 `roundBand`。
- 结果只写入 revision，不更新原 PracticeRecord 的 `writingBand/writingGrade`。
- 对比页正文使用 gradedEssays，而不是当前可能已变化的 essays。

版本对比至少显示：

| 维度 | 原稿 | 修改稿 | 变化 |
|---|---:|---:|---:|
| TA/TR | 原分数 | 新分数 | 差值 |
| CC | 原分数 | 新分数 | 差值 |
| LR | 原分数 | 新分数 | 差值 |
| GRA | 原分数 | 新分数 | 差值 |
| Task Band | 原分数 | 新分数 | 差值 |

正文对比首版左右并排即可，不做逐句 diff。

## 4.6 启动器同步

在 `serverSync.ts` 增加：

```ts
syncWritingFromServer(): Promise<boolean>
mirrorWritingPut(attempt): void
mirrorWritingDelete(recordId): void
```

启动器 `Launcher.cs` 增加：

```text
GET    /api/writing           → 返回 recordId 列表
GET    /api/writing/<id>      → 返回单个答卷
PUT    /api/writing/<id>      → 原子写入
DELETE /api/writing/<id>      → 删除
```

保存目录：`做题记录/写作/<recordId>.json`。

要求：

- id 使用现有 `SafeSeg` 校验。
- 使用现有 AtomicWrite。
- 服务器有则更新 IndexedDB；本地独有则保留并镜像。
- 服务器缺失不能自动推导为删除本地。
- selftest 只操作 `_selftest`，不得读写真实用户答卷。

在 `Home.tsx` 现有启动恢复流程中，`syncFromServer()` 之后调用 `syncWritingFromServer()`，完成后再刷新依赖写作历史的 UI。API 失败时保留 IndexedDB 数据并降级；本地独有记录在确认 API 可用后进入镜像队列，不能因一次同步失败被删除。

## 4.7 删除行为

- 删除 PracticeRecord 时，弹出说明或同步删除对应 WritingAttempt，行为必须一致。
- 推荐：删除练习记录同时删除写作答卷，因为正文属于该记录。
- 删除全部练习记录时清空对应 attempts。
- 删除题包不自动删除历史写作答卷；历史仍可查看题目快照。

## 4.8 验收

1. 无模型配置交卷，历史仍能查看两个 Task 正文。
2. 首次判改后，原稿和报告绑定同一 recordId。
3. 创建修改稿后原稿保持不变，原练习记录分数不变。
4. 刷新页面，修改稿草稿仍存在。
5. 使用模拟判改结果，版本分数对比计算正确。
6. 老记录没有正文时正常降级。
7. 换端口/清浏览器缓存后，通过启动器能恢复答卷。

---

## 5. 功能四：轻量错题复盘

## 5.1 目标

从现有逐题判分结果生成错题引用，支持错因、筛选、重做和掌握状态，不复制一套新题库。

## 5.2 数据结构

在 `learningStore.ts` 定义本地学习数据容器：

```ts
export interface LearningData {
  version: 1;
  reviewItems: ReviewItem[];
  vocabularyProgress: VocabularyProgress[];
  processedRecordIds: string[];   // 已收录过错题的交卷记录，保证幂等
  updatedAt: number;
}
```

在 `review.ts` 定义：

```ts
export type ReviewSkill = 'reading' | 'listening';
export type ReviewStatus = 'pending' | 'learning' | 'mastered';
export type ReviewCause =
  | 'vocab'
  | 'locate'
  | 'comprehension'
  | 'instruction'
  | 'spelling'
  | 'time'
  | 'audio'
  | 'other';

export interface ReviewAttempt {
  at: number;
  user: string;
  correct: boolean;
}

export interface ReviewItem {
  id: string;                    // `${testId}:${skill}:${no}`
  testId: string;
  testName: string;
  skill: ReviewSkill;
  no: number;
  type: QuestionType;
  status: ReviewStatus;
  cause?: ReviewCause;
  lastRecordId: string;
  lastUser: string;
  wasBlank: boolean;
  wrongCount: number;
  attempts: ReviewAttempt[];
  createdAt: number;
  updatedAt: number;
  masteredAt?: number;
}
```

`learningStore.ts` 提供：

```ts
loadLearningData(): LearningData
saveLearningData(data): void
updateLearningData(mutator): void
syncLearningFromServer(): Promise<LearningData>
mirrorLearning(): void
```

localStorage 键：`ielts15-learning-data`。

## 5.3 自动收录规则

只在 `endTest` **最终创建 PracticeRecord 的同一分支**收录，复用该记录的 reading/listening GradeRow 和 `rec.id`。不得在 ResultsView 渲染时收录，也不得在 Full length 听力/阅读阶段结束时提前生成另一套记录 ID。

规则：

- 仅处理 `key !== '—' && !correct` 的行；没有标准答案的题不能当成错题。
- 当前行 `unanswered` 写入 `wasBlank`；再次答错时随 lastRecordId 一起更新，不能只能从 false 单向变 true。
- 同一题再次答错：更新 `lastRecordId/lastUser/wasBlank`，累加 `wrongCount`。
- 同一题已掌握后又答错：重新设为 `pending`，清除 `masteredAt`。
- 处理成功后把 `rec.id` 加入 `processedRecordIds`；若已存在则整场跳过，不重复累计。
- 保留现有“全空白科目不创建 PracticeRecord”的行为，因此全空白科目首版也不自动收录；不要另造一个不存在的 recordId。
- 标准答案不复制进 ReviewItem，重做时从当前 StoredTest 读取。
- 题包被删除时保留记录，列表显示“题包已删除”，禁用重做但允许删除复盘项。

`loadLearningData` 的旧数据默认值必须包含 `processedRecordIds: []`；备份预检和启动器 PUT 校验也要接受并保留该字段。

首版不要求用户在交卷后立刻填错因。

## 5.4 复盘中心

新增 `ReviewCenter.tsx`，首页入口显示待复盘数量。

组件需要支持分析页跳转：

```ts
interface ReviewCenterProps {
  initialSkill?: 'reading' | 'listening';
  initialType?: QuestionType;
  onClose(): void;
  // 精读/精听跳转回调按 App 现有接口传入
}
```

初始筛选只在本轮打开时应用；关闭再打开时使用 Home 新传入值。从分析进入复盘后，关闭复盘应回到分析面板，而不是无条件丢失分析筛选状态。

筛选：

- 科目：全部/阅读/听力。
- 题型。
- 错因。
- 状态：待复盘/仍需复习/已掌握。
- 题包。

统计：待复盘、复习中、已掌握。

列表每行：

```text
阅读 · Matching headings · Q17
Cambridge 21 · Test 1
错因：定位错误 · 答错 2 次 · 重做 1 次
[开始复盘] [标记已掌握] [删除]
```

“开始本次复盘”默认取最多 10 题：

1. `pending` 优先。
2. `learning` 其次。
3. 同优先级按 `updatedAt` 从早到晚。
4. 题包已删除的跳过并提示。

## 5.5 单题重做

新增 `ReviewQuestionView.tsx`。

### 题目与上下文

- 阅读显示原文只读区和目标题所在 QuestionGroup。
- 听力显示目标 Section 题目，并可用当前音频进行练习播放。
- 不需要复用完整考试 TopBar/BottomNav。
- 复盘作答 state 独立于正式考试 answers，不写入 `tk(testId,'answers')`。

### 必须保留题组

不能只把目标 Question 从 group 中孤立出来，因为：

- 共享多选的一组答案挂在组内首题。
- 摘要/表格题的 body/content 可能包含多个空。
- 词库和说明属于整个 group。

正确做法：

1. 阅读直接在 `StoredTest.passages` 找目标 passage/group。
2. 听力不能直接使用抽取态 section：复用 `adaptListening(test.listening.sections, [])`，按对应 section 下标取得适配后的 `Passage`，再查 group；判分答案取 `test.listening.answers`。
3. 保留完整 group 渲染。
4. 默认只要求目标题，但允许填写同组上下文。
5. 共享多选目标题必须整组作答，选择值按正式考试约定存到组内首题；整组判分后按目标题号提取该行结果。
6. 同一复盘批次含同组多个 ReviewItem 时，首版合并为一次题组作答；提交后分别提取各目标行并各追加一条 attempt，UI 明确“同组题一起复盘”。
7. 判分调用现有 `gradeReading`，不要重新写答案比较。

### 提交流程

1. 初始隐藏标准答案。
2. 用户重新作答并提交。
3. 提交前生成 `attemptId`，设置 `submitting/submitted` 锁；双击、重复点击或 React 重渲染不得重复追加 ReviewAttempt。
4. 使用原题包 answers 和 `gradeReading` 判分。
5. 显示：本次正误、用户本次答案、上次答案、标准答案。
6. 每个 attemptId 最多追加一次 `ReviewAttempt`。
7. 用户选择错因，并标记：
   - 仍需复习 → `learning`
   - 已掌握 → `mastered`
8. 重做答对不自动强制掌握，允许用户确认。

“查看原文/精听”作为提交后的下一步：

- 阅读调用现有精读入口。
- 听力调用现有精听入口。

## 5.6 错因文案

```text
vocab          词汇不熟
locate         定位错误
comprehension  理解错误
instruction    审题不清
spelling       拼写/格式
time           时间不足
audio          音频没听清
other          其他
```

精听已有的 `LLCause` 是句级听写错因，不要与这里的题级 ReviewCause 强行合并。

## 5.7 启动器同步

`Launcher.cs` 新增：

```text
GET /api/store/learning
PUT /api/store/learning
```

文件：`做题记录/学习数据.json`。

- PUT 校验为 JSON 对象且 `version=1`，保留 reviewItems/vocabularyProgress/processedRecordIds。
- AtomicWrite。
- 在 `Home.tsx` 启动流程中，`syncFromServer()` 后调用 `syncLearningFromServer()`，完成后再刷新错题和词汇 UI。
- 服务器有有效数据则同步到浏览器；服务器空而本地有则播种。
- API 失败时保留本地数据；本地独有数据在 API 可用后进入镜像队列。
- 所有变更走现有串行镜像思路，防止并发 PUT 覆盖。

## 5.8 验收

1. 部分答错和未答能正确收录，重复打开成绩页不重复计数。
2. 同一题再次答错更新来源和 wrongCount。
3. 填空、单选、共享多选、匹配题重做判分与正式考试一致。
4. 复盘答案不污染正式作答存档。
5. 筛选和三种状态正确。
6. 删除题包后列表不崩溃，重做有明确禁用原因。
7. 刷新和启动器恢复后复盘数据仍存在。

---

## 6. 功能五：词汇间隔复习

## 6.1 目标

在现有精读词汇和精听生词上增加“今日到期”队列和三档反馈，保留自由翻卡与原文跳转。

首版只对单词做间隔复习；句子继续浏览，不进入 SRS。

## 6.2 统一词条模型

把 `Home.tsx` 内合并精读/精听单词的逻辑提取到 `vocabulary.ts`：

```ts
export interface VocabularyItem {
  key: string;                 // `word:${text.trim().toLowerCase()}`
  text: string;
  kind: 'word' | 'sentence';
  updatedAt: number;
  note?: string;
  phonetic?: string;
  gloss?: string;
  sentence?: string;
  context?: string;
  reading?: {
    entryId: string;
    testId: string;
    testName: string;
    passageIdx: number;
    noteId: string;
  };
  listening?: {
    entryId: string;
    testId: string;
    testName: string;
    section: number;
    sentIdx: number;
    sentence: string;
  };
}

buildVocabularyItems(wbEntries, lwEntries): VocabularyItem[]
```

- 同词忽略大小写合并。
- 保留两个来源，不互相覆盖。
- 原有句子条目也保留在词汇中心列表，但 key 为 `sentence:...`。
- 搜索结果、词汇中心和首页翻卡统一使用该函数，避免三套合并逻辑。

## 6.3 复习进度数据

```ts
export type ReviewRating = 'again' | 'hard' | 'good';

export interface VocabularyProgress {
  key: string;                 // 对应 VocabularyItem.key
  text: string;
  reps: number;
  intervalDays: number;
  dueAt: number;
  lastReviewedAt?: number;
  lastRating?: ReviewRating;
  lapses: number;
  suspended?: boolean;
}
```

进度存于 `LearningData.vocabularyProgress`，复用 `/api/store/learning`。

旧数据没有进度时视为新单词，不做批量改写原词汇册。

## 6.4 队列规则

实现纯函数：

```ts
buildReviewQueue(items, progress, now, options): VocabularyItem[]
applyRating(item, progress | undefined, rating, now): VocabularyProgress
```

`applyRating` 必须接收 item，以便旧进度不存在时写入 `key=item.key`、`text=item.text`。

默认队列：

1. 所有 `dueAt <= now` 且未 suspended 的词，按 dueAt 升序。
2. 再加入最多 10 个没有进度的新词，首版按 `updatedAt` 从早到晚。现有词条没有可靠 createdAt，文案不得称为“首次加入时间”。
3. 首版一次最多展示 50 张，超出显示“今日还有 X 个，完成后可继续”。

评分规则：

| 场景 | again | hard | good |
|---|---|---|---|
| 新词 | 10 分钟后，reps=0、intervalDays=0、lapses+1 | 1 天后，reps=1、intervalDays=1 | 3 天后，reps=1、intervalDays=3 |
| 已学习 | 10 分钟后，reps=0、intervalDays=0、lapses+1 | `max(1, round(interval*0.5))` 天后，reps 不重置 | 进入下一间隔 |

good 间隔序列：

```text
3 → 7 → 14 → 30 → 60 → 120 → 180 天
```

- 超过最后档后保持 180 天。
- again 在同一会话中重新排队，插到当前位置后 2–3 张。
- 同一张卡本次会话最多出现 3 次，达到后保留 10 分钟到期，不再无限循环。
- 不使用本地午夜判断“是否到期”，统一比较时间戳。

## 6.5 词汇中心

新增 `VocabularyCenter.tsx`，替代首页原“更多”后的单一词汇册入口，但复用 `FlashcardDeck` 和 `WordbookDetail` 的展示能力。

页签：

```text
今日复习｜自由翻卡｜全部词句
```

### 今日复习

- 显示到期数、新词数、本次完成数。
- 点击卡片或空格翻面。
- 未翻面时不显示评分按钮。
- 翻面后显示：不认识/模糊/认识。
- 评分后移动到下一张并自动翻回正面。
- 完成后显示三档数量和明天到期数。

### 自由翻卡

保持原行为，可浏览最近、随机或筛选后的卡，不写复习进度。

### 全部词句

- 过滤：全部/单词/句子/精读来源/精听来源。
- 显示到期时间和最近评分。
- 可暂停/恢复某个单词复习。
- 可跳回精读原文或精听篇目。

### FlashcardDeck 改造

通过可选 props 增加复习模式，不破坏原有用法：

```ts
onRate?: (entry: T, rating: ReviewRating) => void
reviewMode?: boolean
```

- 有 `onRate` 时显示三档评分，隐藏普通上一张/下一张。
- 父组件控制队列，评分后移除/重排当前项。
- 保留原有 `aria-label` 和 reduced-motion。

## 6.6 验收

1. 同词来自精读和精听时只生成一个复习单位，两个来源均可跳转。
2. 新词三档评分后的 dueAt 符合规则。
3. good 连续评分按 3/7/14 天推进。
4. again 会重排队但不会无限循环。
5. 未翻面不能评分。
6. 自由翻卡不改变进度。
7. 旧词汇没有进度字段时正常显示。
8. 刷新和启动器恢复后进度不丢。

---

## 7. 功能六：学习分析看板

## 7.1 目标

利用现有 PracticeRecord 和新增学习数据回答：成绩趋势、弱项题型、时间投入、写作弱维度。不做装饰性大屏。

## 7.2 数据层

先补充历史题型字段。现有 `AttemptRow` 只有 n/you/key/ok，无法仅凭 records 做题型统计：

```ts
export interface AttemptRow {
  n: number;
  you: string;
  key: string;
  ok: boolean;
  type?: QuestionType;   // 新记录写入；旧记录允许缺省
}
```

在 `App.tsx` 的 `detail()` 中从 `GradeRow.type` 写入 `type`。旧记录没有该字段时标记为“题型未知”，不纳入题型统计；首版不通过当前题包反推，避免题包删除或修正后错配。`withoutTables` 的裁剪策略不变。

`analytics.ts` 只写纯函数：

```ts
interface AnalyticsFilter {
  from?: number;
  to?: number;
  skill: 'all' | 'reading' | 'listening' | 'writing';
  testId?: string;
}

interface TypeStat {
  skill: 'reading' | 'listening';
  type: QuestionType;
  total: number;
  correct: number;
  accuracy: number;
  timeSec: number;
  avgSec: number;
}
```

实现：

```ts
filterRecords(records, filter)
buildBandTrend(records, skill)
buildAccuracyTrend(records, skill)
buildTypeStats(records, skill?)
buildWritingDimensionStats(records)
buildSummary(records)
```

## 7.3 统计口径

必须遵守：

- Band 趋势只使用 `band != null` 的整卷数据。
- 单篇/单 Section 不进入整卷 Band 趋势。
- 正确率趋势使用 `score/total`，部分练习可以进入，但图表与 Band 分开。
- 阅读和听力分别统计，不混为一个题型正确率。
- 题型统计只使用有 `table` 且行内带 `type` 的记录；无 type 的旧行单独计为缺失，不猜题型。
- 老记录无 table 时仍可用于总分、Band、练习时长，不可伪造题型数据。
- 未答题计入该题总数，不计入正确数。
- Full length 听力和阅读分别取对应 SkillScore。
- 总练习时长直接累加 `durationSec`，不重复拆算 Full length 各科。
- 写作四维来自 `writingGrade`；revision 成绩不覆盖原场次趋势，首版单独不纳入。
- 至少 2 个有效点才显示趋势，否则显示数据不足说明。

## 7.4 页面

新增 `AnalyticsView.tsx`。

顶部筛选：

- 最近 30 天/90 天/全部。
- 科目。
- 题包。

摘要卡：

- 练习场次。
- 总练习时间。
- 最近有效 Band。
- 当前筛选范围平均正确率。

图表使用现有 Recharts：

1. 阅读/听力 Band 折线，按科目页签切换。
2. 原始正确率折线。
3. 题型正确率横向条形图，同时显示样本题数。
4. 写作 TA/CC/LR/GRA 平均分横向条形图。
5. 错题状态小摘要：待复盘/复习中/已掌握，可跳复盘中心。

每图显示数据范围，例如“基于最近 12 场、486 题”，避免样本量误解。

底部提供可执行入口：

- 点击低正确率题型 → 打开 ReviewCenter 并带科目/题型筛选。
- 点击写作摘要 → 回首页练习记录并筛选写作；如果首版没有历史筛选，可只提供关闭分析并定位历史区。

## 7.5 空状态

- 无记录：引导开始第一场练习。
- 有总分无明细：显示总分趋势，题型区说明需要更多新记录。
- 无写作判改：写作区显示“完成并判改写作后生成四维分析”。
- 不用 0 代替缺失数据。

## 7.6 验收

1. 单篇不会生成伪造 Band 趋势。
2. 老记录无 table 不参与题型分母。
3. Full length 不重复计算时长。
4. 筛选日期、科目、题包结果一致。
5. 样本为空时图表区不报错。
6. 题型入口能带筛选跳转到错题复盘。

---

## 8. 功能七：全量备份与恢复

## 8.1 目标

导出一个可迁移的 ZIP，覆盖题库、历史、写作、学习数据、精读、精听、词汇、未完成会话和可选媒体。默认排除 API Key。

## 8.2 备份格式

文件：`英语机考模拟器-backup-YYYYMMDD-HHmm.zip`

```text
manifest.json
data/tests.json
data/history.json
data/learning.json
data/sessions.json
data/wordbook.json
data/lwords.json
data/intensive/<key>.json
data/listen/<key>.json
data/writing/<recordId>.json
settings/ui.json
media/<testId>/<mediaName>
```

`manifest.json`：

```ts
interface BackupManifest {
  format: 'ielts-cbt-backup';
  format_version: 1;
  createdAt: number;
  appBuild?: string;
  includesMedia: boolean;
  files: {
    tests: number;
    records: number;
    writingAttempts: number;
    intensive: number;
    listen: number;
    media: number;
  };
  media: {
    key: string;        // 原 IndexedDB key
    path: string;       // zip 内路径
    store: 'audio' | 'images';
    mime: string;
  }[];
}
```

## 8.3 导出实现

`backup.ts` 使用 JSZip：

```ts
exportBackup(options: { includeMedia: boolean }): Promise<Blob>
inspectBackup(file: File | Blob): Promise<BackupPreview>
restoreBackup(file, options): Promise<RestoreSummary>
```

### data/sessions.json

每套 active session 收集以下 `tk(testId, what)` 白名单键：

```text
active-session
timer
answers
lanswers
essays
notes
highlights
times
ltimes
```

恢复时也写回完全相同的键，尤其听力必须是全小写 `lanswers/ltimes`。不要把所有 localStorage 无差别打包。

### 精读/精听

- 通过 `listIntensiveMeta/listListenMeta` 获取 key。
- 再通过 `loadIntensive/loadListen` 读取，确保启动器服务器上的数据也能纳入。
- 词汇通过 `syncWordbookFromServer/syncLWordsFromServer` 获取最新版本。

### 写作

通过 `listWritingAttempts()` 导出全部 attempts。

### settings/ui.json

本阶段先把 App 现有字号、配色、亮度持久化到：

```ts
interface UiSettings {
  fontSize: 'std' | 'lg' | 'xl';
  scheme: 'bow' | 'wob' | 'yob';
  brightness: number; // 50–100
  split: number;      // 25–75
}
```

- localStorage 键：`ielts15-ui-settings`。
- 初始 state 从该键读取并校验，缺省沿用 std/bow/100/50。
- 原 `ielts-cbt-split` 继续兼容，首次保存新键时迁移。
- App 设置变化时写入；分栏变化时同步更新 split。
- 备份写入该对象；恢复校验后写回并在最终 reload 时应用。
- 不包含 LLM 配置。

### 媒体

需要导出的已知键：

- 每套题每个听力 section：`${testId}/s${section}`。
- `StoredTest.images[].key`。
- 精听 states 中 `rec=true` 的 `recMediaKey(...)`。

在 `media.ts` 增加枚举/导出辅助函数时，不修改现有 DB 版本，不重建 objectStore。

若 IndexedDB 未命中但启动器有文件，使用 `loadAudio/loadImage` 的现有远程回退取得。

- 音频和录音以 Blob 写入。
- images 的 data URL 转 Blob，manifest 记录 store 和 mime；恢复时读回 data URL 后调用 saveImage。
- 媒体较大时在 UI 显示处理中，不阻塞为无反馈状态。

### 明确排除

- `ielts15-llm-config`。
- 任何 apiKey。
- 临时 objectURL。
- 浏览器缓存和无关 localStorage。

## 8.4 数据管理 UI

新增 `DataManager.tsx`：

```text
数据管理

[创建备份]
[x] 题库、成绩、写作和学习记录
[x] 未完成练习与界面设置
[ ] 包含音频、题图和录音（文件可能较大）

[选择备份并恢复]

存储说明：API Key 不会包含在备份中。
```

导出完成给文件名、大小和模块数量。

## 8.5 恢复预检

选择 ZIP 后先 `inspectBackup`，不得立即写入：

- 检查 format 和 format_version。
- 只支持 v1；更高版本提示升级应用。
- 检查所需 JSON 是否可解析、主要数组/对象形状是否正确，learning 保留 processedRecordIds。
- 检查 media manifest 的 key/path，拒绝 `..`、绝对路径和非法 testId。
- 显示题库、记录、写作、精读、精听、媒体数量和备份时间。
- 文件缺失或损坏时列出错误并停止，不做部分静默恢复。

## 8.6 恢复模式

### 合并恢复（默认）

恢复前必须生成逐对象 merge plan，不能直接逐项调用 save 覆盖：

```ts
type MergeAction = 'add' | 'keep-current' | 'use-backup';
interface MergeDecision { module: string; key: string; action: MergeAction }
```

默认规则：

| 模块 | 主键与默认冲突处理 |
|---|---|
| tests | 按 test.id；新增加入，冲突保留当前 |
| history | 按 record.id；新增加入，冲突保留当前 |
| writing | 按 recordId；新增加入，冲突保留当前 |
| intensive/listen | 按文件 key；新增加入，冲突保留当前 |
| sessions | 按 testId；冲突保留当前 |
| reviewItems | 按 item.id 合并，冲突保留当前 |
| vocabularyProgress | 按 progress.key 合并，冲突保留当前 |
| processedRecordIds | 取并集 |
| wordbook/lwords | 按 entry.id 合并，冲突保留当前 |
| media | 按原 IndexedDB key；新增加入，冲突保留当前 |
| UI 设置 | 默认保留当前 |

用户显式选择“冲突时使用备份版本”后，才把对应冲突决策改为 use-backup。所有模式都不删除当前独有数据。预览显示 add/keep/replace 数量，执行只能写决策允许的对象。

### 完整替换

- 高风险二次确认。
- 开始前强制 `exportBackup({includeMedia:true})` 并成功下载/生成 Blob；失败则中止替换，不能用无媒体备份充当可回滚保障。
- 如果待恢复包不含媒体，确认页明确警告“恢复后当前媒体将被移除，且备份包中没有可恢复媒体”。
- 只清理本应用明确拥有的键和 stores，不能 `localStorage.clear()`，不能删除整个 IndexedDB。
- 恢复完成后给出模块汇总并刷新页面。

## 8.7 恢复写回

先根据 merge plan 算出每个模块的最终状态，再写浏览器与镜像：

- tests/history 按最终数组合并，批量写 localStorage 后各调用一次镜像，不要逐套产生大量 PUT。
- writing/intensive/listen 只保存决策为 add/use-backup 的对象；keep-current 不发送 PUT。
- learning 保存合并后的最终 LearningData。
- sessions 只恢复决策允许的 testId，并写回正确白名单键。
- 媒体按 store 和 merge 决策恢复；镜像内容必须是最终状态。
- 某媒体镜像失败列入警告，不回滚已经成功恢复的文字数据；结果必须说明。

现有 mirror 函数多为 void 队列。为避免旧服务器数据回覆盖：

1. 为 serverSync、intensive、listenLab 的队列增加可 await 的 flush 方法，并聚合成 `flushLocalMirrors()`。
2. 恢复后先刷新本地 UI，不得立即执行服务器优先的 `syncFromServer()`。
3. 等所有恢复镜像入队后 `await flushLocalMirrors()`。
4. 只有 flush 完成后才允许重新执行启动同步或提示用户刷新。
5. flush 失败要保留本地恢复结果并明确提示稍后重试，不得再次用旧服务器数据覆盖。

## 8.8 验收

1. 备份 ZIP 内不包含 llm config 或任何 apiKey 字符串。
2. 无媒体备份体积小且可恢复全部文字数据。
3. 含媒体备份可恢复听力音频、写作题图和跟读录音。
4. 合并模式不删除当前独有数据。
5. 冲突策略与预览一致。
6. 替换前生成当前备份。
7. 损坏 ZIP、错误版本、非法路径均被拒绝且不修改当前数据。
8. 恢复后首页、写作历史、错题、词汇进度和未完成会话均可用。

---

## 9. 功能八：统一搜索

## 9.1 目标

一个搜索框查询题库、练习历史、词汇和批注，结果按类型分组并跳到对应页面。

## 9.2 数据模型

`search.ts`：

```ts
type SearchResult =
  | { kind: 'test'; id: string; title: string; subtitle: string; testId: string }
  | { kind: 'history'; id: string; title: string; subtitle: string; recordId: string }
  | { kind: 'vocabulary'; id: string; title: string; subtitle: string; vocabularyKey: string };
```

接口：

```ts
searchAll(input: {
  query: string;
  tests: StoredTest[];
  records: PracticeRecord[];
  vocabulary: VocabularyItem[];
}): {
  tests: SearchResult[];
  history: SearchResult[];
  vocabulary: SearchResult[];
};
```

## 9.3 搜索规则

- 查询 trim、转小写、连续空白合并。
- 多关键词按 AND 匹配。
- 空查询不搜索。
- 最大输入 100 字符，250ms 防抖。
- `searchAll` 返回完整匹配结果；默认下拉每组只展示前 5 条。
- “查看全部”在 GlobalSearch 内切换为完整结果页，并按当前组过滤，不要求题库或历史面板另增 initialQuery。
- 标题前缀匹配优先于包含匹配；标题优先于副标题。
- 不做拼音、模糊纠错或服务器搜索。

字段：

### 题库

- `name`。
- passage title。
- listening section title/context。
- Test/Part/Section 标签。

### 历史

- testName。
- scopeName。
- 本地化日期。
- reading/listening/writing 科目名。

### 词汇

- text、phonetic、gloss。
- note、sentence、context。
- 来源题包名。
- 精读句子和精听生词均可搜索。

首版不扫描所有 PDF，不搜索尚未录入精听 transcript 的音频内容。

## 9.4 UI

新增 `GlobalSearch.tsx`，放首页报头右侧。

- 使用可访问 combobox/dialog 语义。
- 支持上下方向键、Enter、Escape。
- 结果显示三组：题库、练习记录、词汇与批注。
- 无结果时给可执行提示。
- 点击外部关闭，键盘焦点返回搜索框。

跳转：

- 题库结果：关闭搜索并复用第 2.3 节统一入口；无 active session 时以 new 打开 StartModal，有 active session 时显示“继续上次/重新开始/取消”，不得另写恢复逻辑。
- 历史结果：打开现有 HistoryDetailModal。
- 词汇结果：打开 VocabularyCenter 并定位词条详情。

给 `VocabularyCenter` 增加可选：

```ts
initialEntryKey?: string;
```

打开后词条不存在时显示“该词条已移除”，不能空白。

## 9.5 验收

1. 英文大小写不敏感，多关键词 AND 正确。
2. 书名、Test、练习历史、精读单词、精听生词、批注均可命中。
3. 点击三类结果进入正确页面。
4. 已删除题包的历史可打开，题库依赖操作明确禁用。
5. 键盘可完成搜索和选择。
6. 空查询和大量数据下不会每次按键同步重建所有异步数据。

---

## 10. 共享兼容、删除和安全规则

### 10.1 数据删除矩阵

| 操作 | 当前进度 | 练习记录 | 写作历史 | 错题 | 词汇/复习 | 题包媒体 |
|---|---|---|---|---|---|---|
| 放弃当前进度 | 删除 | 保留 | 保留 | 保留 | 保留 | 保留 |
| 删除一条练习记录 | 不影响 | 删除该条 | 删除同 recordId | 保留复盘引用 | 保留 | 保留 |
| 清空练习记录 | 不影响 | 清空 | 清空 attempts | 保留 | 保留 | 保留 |
| 删除题包 | 提示并删除该题进度 | 保留历史 | 保留快照 | 保留但禁重做 | 保留 | 按现有逻辑删除 |

如果产品选择不同删除行为，必须在 UI 明确说明，不能静默多删。

### 10.2 旧数据

- PracticeRecord 没有 writingWords/writingGrade/table 均允许。
- WritingAttempt 不存在时显示旧记录降级。
- LearningData 不存在时返回 `{version:1,reviewItems:[],vocabularyProgress:[],processedRecordIds:[],updatedAt:0}`。
- VocabularyProgress 不存在时视为新词。
- active-session 不存在时按第 2.4 节恢复旧进度。
- 所有 JSON.parse 都要捕获错误并给默认值或明确错误，不让整个首页白屏。

### 10.3 并发与存储

- localStorage 只放小型索引和状态。
- 写作正文放 IndexedDB，不塞进 `ielts15-history`。
- 镜像写操作串行。
- 服务器同步失败只警告，不阻断主流程。
- 不在 render 中直接做异步存储。
- 对象 URL 用完后 revoke。

### 10.4 隐私

- 备份不含模型配置。
- UI 不显示完整 API Key。
- 文档、日志和错误信息不输出密钥。
- 判改只发用户主动选择的内容。

---

## 11. UI 和可访问性共同要求

- 新面板采用现有炭灰顶栏、细分隔线、克制卡片，不引入另一套视觉风格。
- 复用现有 Button/Dialog/Tabs/DropdownMenu，或保持相同类名体系。
- 全屏面板有明确返回按钮和标题。
- 所有异步面板有 loading、empty、error、success 状态。
- 所有危险操作有确认，确认文案列出影响范围。
- 弹窗支持 Escape、焦点圈定和焦点返回。
- 复习支持空格翻面，评分按钮可 Tab 到达。
- 搜索结果支持键盘。
- 图表有文字摘要，不只靠颜色。
- 正误、掌握状态同时有文字/图标。
- 900px 以下筛选项允许换行；600px 以下表格转摘要卡或局部横滚。
- 保留 `prefers-reduced-motion`。
- 新样式不要继续追加多轮同名覆盖，使用 `as-`、`wh-`、`rv-`、`vc-`、`an-`、`dm-`、`gs-` 等明确前缀。

---

## 12. 分阶段执行顺序

### 阶段 0：基线与前置修正

先确认现有构建可用，并修复/核实：

- 听力单场 ResultsView 使用 `lTimes`，不是阅读 `times`。
- 听力/Full length MD 导出不硬编码阅读。
- 重做行为明确。
- 不在这阶段改视觉。

验收：阅读、听力、写作、Full length 主流程未被后续功能破坏。

### 阶段 1：未完成练习中心 + 交卷前检查

先完成 active-session 和 SubmitReviewModal，因为后续所有数据都来自可靠的练习生命周期。

交付：第 2、3 章全部验收。

### 阶段 2：写作答卷历史

完成 IndexedDB、启动器 writing API、历史详情和修改稿。

交付：第 4 章全部验收。判改验证使用模拟数据，不消耗真实 API。

### 阶段 3：学习数据容器 + 轻量错题复盘

先实现 LearningData 和 `/api/store/learning`，再收录错题和重做。

交付：第 5 章全部验收，尤其共享多选和复盘不污染正式答案。

### 阶段 4：统一词汇模型 + 间隔复习

复用 LearningData，完成 VocabularyCenter 和三档队列。

交付：第 6 章全部验收。

### 阶段 5：学习分析看板

等历史、写作和错题字段稳定后实现统计，避免反复改口径。

交付：第 7 章全部验收。

### 阶段 6：全量备份与恢复

此时所有新数据类型已确定，一次性覆盖完整。

交付：第 8 章全部验收。

### 阶段 7：统一搜索与最终回归

最后聚合所有入口，减少反复修改搜索跳转。

交付：第 9 章验收 + 第 13 章总回归。

---

## 13. 最终回归矩阵

至少使用一套包含阅读、4 个听力 Section、写作和答案的 ZIP 题包。

### 主流程

- [ ] 导入题包，开始阅读，作答、标记、返回首页、继续。
- [ ] 手动交卷检查未答与 Flag，返回跳题，再确认交卷。
- [ ] 听力实考和练习模式都能完成；练习模式不限时也能续做。
- [ ] 写作原稿、首次判改、修改稿和版本对比可用。
- [ ] Full length 阶段切换和 active-session 清理正确。
- [ ] 重做不误留旧答案，除非用户明确选择保留。

### 学习闭环

- [ ] 错题自动收录，错因和状态保存。
- [ ] 各题型重做判分与正式考试一致。
- [ ] 精读/精听同词合并复习，两个来源可跳转。
- [ ] SRS 评分、到期、重排队和刷新恢复正确。
- [ ] 学习分析口径与成绩单一致。

### 数据

- [ ] 删除一条历史按矩阵处理写作历史。
- [ ] 删除题包后历史、复盘和词汇不崩溃。
- [ ] 备份不含 API Key。
- [ ] 合并恢复和完整替换都符合预览。
- [ ] 启动器不可用时可退回纯浏览器模式。
- [ ] 启动器可用时，换端口后题库、历史、写作和 learning 数据可自动恢复。
- [ ] 未完成会话的 answers/timer/active-session 不同步跨端口，必须通过备份恢复验证；不得把它写成启动器自动恢复能力。

### UI

- [ ] 1440×900、1280×720、1024×768。
- [ ] 900px、768px、600px、390px。
- [ ] 新弹窗无横向溢出。
- [ ] 仅键盘可完成搜索、翻卡、评分、交卷确认和关闭面板。
- [ ] 所有 loading/empty/error 都有明确界面。
- [ ] reduced-motion 生效。

### 工程

- [ ] `npm run build` 通过。
- [ ] 若 ESLint 已配置，`npm run lint` 通过；否则明确记录。
- [ ] 更新 `使用说明.txt`：新增功能、备份格式、数据保存位置、删除行为。
- [ ] 更新启动器 selftest 覆盖新增 writing/learning API，且只使用 `_selftest`。
- [ ] 发布前重新构建 `源码/dist` 和启动器，实际打开发布版执行一轮冒烟，不只在 dev 页面验收。

---

## 14. 首版明确不做

为避免实施范围失控，以下不进入本轮：

- 同套题多个并行 active sessions。
- 写作复杂版本树和逐句 diff。
- 随机组成完整新模拟卷。
- 复杂 SM-2/Anki 算法、每日打卡和积分。
- AI 自动生成学习分析评语。
- 云账号和实时多设备同步。
- 增量备份和自动定时备份。
- 拼音/模糊搜索、PDF 全文搜索。
- 口语新科目。
- 为“代码更漂亮”而重写现有精读、精听和考试状态机。

完成标准不是“页面能打开”，而是第 13 章的实际流程、数据持久化和构建回归全部通过。
