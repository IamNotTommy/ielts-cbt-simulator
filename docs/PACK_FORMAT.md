# 题包格式与制作指南

本文说明一个 `.zip` 题包的最小结构、字段含义、打包方法和常见错误。  
内容依据 `src/lib/zipPack.ts`（导入/导出）、`src/lib/adapter.ts`（结构适配）、`src/lib/validate.ts`（校验）整理。程序支持 `format_version = "1.0"`。

> ⚠️ 版权提醒：题包通常包含听力音频、阅读文章和题目。请只处理你**合法拥有**的材料；不要把受版权保护的题包公开上传到 GitHub、网盘公开链接或 Releases。

---

## 1. 一个题包长什么样

ZIP 根目录（**不是**再套一层文件夹）应当包含：

```text
my-pack.zip
├─ manifest.json                 ← 必需，必须在根目录
├─ reading/
│  ├─ passage1.json              ← 必需，至少一篇
│  ├─ passage2.json              ← 可选
│  ├─ answers.json               ← 阅读答案（推荐）
│  └─ fig_p1_1.png               ← 可选：阅读题组配图
├─ listening/
│  ├─ section1.json              ← 可选：听力 section
│  ├─ section2.json
│  ├─ answers.json               ← 听力答案
│  ├─ section1.mp3               ← 每节一个音频文件
│  └─ fig_s1_1.png               ← 可选：听力题组配图
└─ writing/
   ├─ task1.json                 ← 写作 Task 1
   ├─ task2.json                 ← 写作 Task 2
   └─ task1_figure.png           ← 可选：Task 1 图表（也支持 figure_data 内联数据）
```

只有阅读的题包也能用：`listening/` 和 `writing/` 可以不要（会有“写作题目不完整”的提示）。但至少要有 `manifest.json` 和 `reading/passage1.json`。

---

## 2. `manifest.json`

```json
{
  "format_version": "1.0",
  "book": "My Practice Book",
  "test_number": 1,
  "module": "academic",
  "files": [
    "manifest.json",
    "reading/passage1.json",
    "reading/answers.json",
    "writing/task1.json",
    "writing/task2.json"
  ]
}
```

| 字段 | 说明 |
|---|---|
| `format_version` | 必须是字符串 `"1.0"`；其他版本会拒绝导入 |
| `book` | 书名/来源名 |
| `test_number` | 第几套，整数 |
| `module` | `"academic"` 或 `"general"`，默认 `academic` |
| `files` | 题包文件清单。导入时会逐个检查：**JSON 缺失 = 报错**；音频/图片（`.mp3/.wav/.m4a/.ogg/.png/.jpg/.jpeg`）缺失 = 警告并继续 |
| `missing` | 可选，导出时用来标注故意未包含的文件（导入不依赖它） |

> `files` 要列全。没列出的 JSON 不会被当成“必需文件”，但 `reading/passageN.json`、`listening/sectionN.json` 是按文件名扫描的，列不列都能读。

---

## 3. 阅读：`reading/passageN.json`

```json
{
  "passage_number": 1,
  "title": "Why we need silence",
  "paragraphs": [
    { "label": "A", "text": "Modern cities are noisy..." },
    { "label": "B", "text": "Researchers have found..." }
  ],
  "question_groups": [
    {
      "range": "1-2",
      "type": "true_false_not_given",
      "instruction": "Do the following statements agree with the information given in the passage? Write TRUE, FALSE or NOT GIVEN.",
      "max_words": null,
      "options": null,
      "questions": [
        { "number": 1, "text": "Silence can improve concentration.", "choices": null, "word_limit": null },
        { "number": 2, "text": "The writer believes noise is never useful.", "choices": null, "word_limit": null }
      ]
    },
    {
      "range": "3-4",
      "type": "summary_completion",
      "instruction": "Complete the summary below. Write ONE WORD ONLY for each answer.",
      "max_words": 1,
      "content": "Modern life is full of [Q3]. Many people find that a quiet room helps them [Q4].",
      "questions": [
        { "number": 3, "text": "Blank 3", "choices": null, "word_limit": 1 },
        { "number": 4, "text": "Blank 4", "choices": null, "word_limit": 1 }
      ]
    }
  ]
}
```

### 3.1 题组字段

| 字段 | 说明 |
|---|---|
| `range` | 题号范围，**只写数字**：`"1-5"` 或单题 `"26"`。不要写 `"Questions 1-5"` |
| `type` | 题型，见下表 |
| `instruction` | 原卷指令原文。字数限制、多选数量都从这里解析，建议逐字抄 |
| `max_words` | 题组级字数上限（数字，如 `1` 表示 ONE WORD） |
| `options` | 词库/标题列表/选项框；字符串数组，或 `{label,text}` 对象数组 |
| `content` | 统一正文（摘要/表格/笔记），空位用 `[Q3]` 标记；**优先于 `body`** |
| `body` | 旧字段，等价于 `content`，新题包建议只用 `content` |
| `questions` | 题目数组，见下 |
| `figure_image` | 题组配图在 ZIP 内的路径，必须是 `reading/xxx.png` 或 `listening/xxx.png` |
| `examples` / `example` | 段落标题匹配的 Example 行，不计分 |

题目对象：

```json
{ "number": 1, "text": "题干", "choices": ["A ...", "B ..."], "word_limit": 2 }
```

- `number` 必须是整数，且**整个题包从 1 开始连续**（阅读 + 听力一起编号）。
- `text`：题干；统一正文题可写 `"Blank 3"`，真正内容放 `content`。
- `choices`：单选题的选项；也可以放在题组 `options`。
- `word_limit`：该题字数上限；优先级低于 `max_words`。

### 3.2 支持的题型 `type`

| `type` | 界面表现 |
|---|---|
| `true_false_not_given` / `yes_no_not_given` | TRUE/FALSE/NOT GIVEN 或 YES/NO/NOT GIVEN |
| `multiple_choice_single` | 单选（每题一组选项） |
| `multiple_choice_multi` | 整组共享多选，指令里写 “Choose TWO letters” |
| `sentence_completion` | 句子填空；题干可直接含 `[Qn]`，或正文含 `[Qn]` |
| `summary_completion` | 摘要填空（正文用 `[Qn]`） |
| `notes_completion` | 笔记填空（正文用 `[Qn]`，可列表式） |
| `table_completion` | 表格填空（`content` 中用 `|` 分隔单元格） |
| `flow_chart_completion` | 流程图填空 |
| `diagram_labelling` | 图标标注（需配图或正文含空位） |
| `matching_headings` | 段落标题匹配（用掉即不可再用，除非指令含 NB） |
| `matching_paragraph_info` | 段落信息匹配（点选段落字母） |
| `matching_features` | 特征匹配 / 句尾匹配（下拉字母，可重复） |
| `matching_sentence_endings` | 句尾匹配（同 `matching_features`） |
| `list_selection` | 选项框选字母；每题题干不同→逐题下拉，共用题干→整组多选 |

未知题型不会崩溃，会按“填空”渲染并给出提示，但最好改成上表中的值。

---

## 4. 答案：`reading/answers.json` / `listening/answers.json`

推荐格式：

```json
{
  "source": "book",
  "items": {
    "1": "TRUE",
    "2": "FALSE",
    "3": "noise",
    "4": "focus"
  }
}
```

- `items` 的键是题号（字符串），值是标准答案。
- 也兼容**旧格式**：直接写 `{ "1": "TRUE", "2": "FALSE" }`。
- 阅读答案缺失时仍可做题，但成绩页不会判对错、Band 为 `—`。
- 同一题多个可接受写法用 `/` 分隔，例如 `"in (a) hurry/in hurry"`；括号内视为可选词。

---

## 5. 听力：`listening/sectionN.json`

```json
{
  "section_number": 1,
  "title": "Section 1",
  "context": "Booking a hotel room",
  "question_groups": [
    {
      "range": "1-2",
      "type": "notes_completion",
      "instruction": "Complete the notes below. Write ONE WORD AND/OR A NUMBER for each answer.",
      "max_words": 2,
      "content": "Hotel name: [Q1]\nCheck-in date: [Q2]",
      "questions": [
        { "number": 1, "text": "Blank 1", "choices": null, "word_limit": 2 },
        { "number": 2, "text": "Blank 2", "choices": null, "word_limit": 2 }
      ]
    }
  ]
}
```

- `question_groups` 结构与阅读完全一致。
- 音频放在 `listening/section1.mp3`（也支持 `.wav`、`.m4a`、`.ogg`、`.aac`）。
- 音频文件名里的序号必须等于 `section_number`。
- 缺音频只会警告，不影响导入；听力页会提示无音频。
- 听力答案同样放 `listening/answers.json`。

---

## 6. 写作：`writing/task1.json` / `task2.json`

```json
{
  "prompt": "The chart below shows the number of visitors to a museum.\nSummarise the information by selecting and reporting the main features.",
  "min_words": 150,
  "suggested_minutes": 20,
  "figure": true,
  "figure_type": "bar",
  "figure_data": {
    "columns": ["Year", "Visitors"],
    "rows": [[2020, 12], [2025, 18]]
  }
}
```

```json
{
  "prompt": "Some people think that working from home is better than working in an office.\nDiscuss both views and give your own opinion.",
  "min_words": 250,
  "suggested_minutes": 40
}
```

| 字段 | 说明 |
|---|---|
| `prompt` | 题目文字，换行会拆成多段 |
| `min_words` | 建议最低词数（Task 1 通常 150，Task 2 通常 250） |
| `suggested_minutes` | 建议用时 |
| `figure` | Task 1 是否有图表 |
| `figure_type` | `table` / `bar` / `line` / `pie` |
| `figure_data` | 内联图表数据：`columns` + `rows`，用于直接画表格 |
| `writing/task1_figure.png` | 也可以直接放图片；有图片时优先显示图片 |

缺 `task1.json` / `task2.json` 会警告，并生成空白的占位写作任务。

---

## 7. 配图

题组配图在 JSON 里写相对路径：

```json
"figure_image": "reading/fig_p1_1.png"
```

导入时会把 `reading/...png` / `listening/...png` 转成 data URL：

- 只接受 `.png`；
- 路径必须以 `reading/` 或 `listening/` 开头；
- 文件名只建议用字母、数字、点、下划线、连字符。

推荐命名：

```text
reading/fig_p1_1.png     第 1 篇第 1 个题组
listening/fig_s1_1.png   第 1 个 Section 第 1 个题组
writing/task1_figure.png Task 1 图表
```

---

## 8. 打包步骤

1. 新建一个文件夹，按上面的结构放好文件。
2. **确认 `manifest.json` 在这个文件夹的第一层**，不是 `my-pack/manifest.json` 这样的嵌套。
3. 全选文件夹里的内容（不是文件夹本身），压缩成 `.zip`。推荐用 **7-Zip** 或 **Windows 自带的 tar**：

   ```powershell
   # 在题包文件夹的上一级执行；Windows 10/11 自带 tar
   Push-Location .\my-pack
   tar -a -c -f ..\my-pack.zip *
   Pop-Location
   ```

   7-Zip：选中文件夹**里面的内容** → 添加到压缩包 → 格式选 zip。

   > ⚠️ 不要用 Windows PowerShell 的 `Compress-Archive` 或 .NET 的 `ZipFile.CreateFromDirectory` 打包。  
   > 在 Windows 上它们可能把路径写成 `reading\passage1.json`（反斜杠），题包导入器按 `reading/passage1.json` 查找，会报“缺 reading/passageN.json”。
   > 如果只能用 PowerShell，请用上面的 `tar`，或打包后用压缩软件检查条目里是不是 `/`。

4. 打开程序首页，把 `.zip` 拖进导入框，或点击导入框选择文件。
5. 如果有错误，页面会列出具体原因；按提示改 JSON 后重新打包。

> 不要给题包加密码，也不要把 zip 再套一层 zip。

### 8.1 文件编码

JSON 文件建议保存为 **UTF-8（无 BOM）**：

- VS Code：右下角编码选择 **UTF-8**，不要选 “UTF-8 with BOM”；
- 记事本：另存为 → 编码选 **UTF-8**（新版记事本默认无 BOM）；
- Windows PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会写入 BOM。

当前版本导入时会自动忽略 JSON 开头的 BOM（`\uFEFF`），但为了兼容其他工具，仍建议无 BOM。

---

## 9. 最小可用示例（只有阅读）

```text
sample-pack.zip
├─ manifest.json
├─ reading/passage1.json
├─ reading/answers.json
├─ writing/task1.json
└─ writing/task2.json
```

`reading/passage1.json`：

```json
{
  "passage_number": 1,
  "title": "A short sample passage",
  "paragraphs": [
    { "label": "A", "text": "This is the first paragraph of the sample passage." },
    { "label": "B", "text": "This is the second paragraph with the answer." }
  ],
  "question_groups": [
    {
      "range": "1-1",
      "type": "summary_completion",
      "instruction": "Complete the sentence. Write ONE WORD ONLY.",
      "max_words": 1,
      "content": "The second paragraph contains the [Q1].",
      "questions": [
        { "number": 1, "text": "Blank 1", "choices": null, "word_limit": 1 }
      ]
    }
  ]
}
```

`reading/answers.json`：

```json
{ "source": "book", "items": { "1": "answer" } }
```

`writing/task1.json`：

```json
{ "prompt": "Write a short description of the sample passage.", "min_words": 150, "suggested_minutes": 20 }
```

`writing/task2.json`：

```json
{ "prompt": "Some people prefer reading paper books. Discuss both views and give your opinion.", "min_words": 250, "suggested_minutes": 40 }
```

---

## 10. 常见错误

| 现象 | 原因 |
|---|---|
| `缺 manifest.json（不是有效题包）` | manifest 被套在子文件夹里，或文件名不是 `manifest.json` |
| `format_version=... 不匹配` | 写成了数字 `1.0` 或 `"1"`，必须是字符串 `"1.0"` |
| `题包不完整：缺 reading/passage1.json` | `files` 列了但没放文件；或 ZIP 条目用了反斜杠（见第 8 节） |
| `manifest.json 不是合法 JSON` | 文件带 BOM、用了单引号、末尾多了逗号；（当前版本已兼容 BOM） |
| `题号不连续：第 1 题缺失（实际为 14）` | 题号必须从 1 开始连续，不能只放 14-26 |
| `xxx.json 不是合法 JSON` | 末尾多了逗号、用了单引号、编码不是 UTF-8 |
| `未识别题型` | `type` 拼错或不在支持列表里 |
| 填空没有输入框 | 正文里没有 `[Q1]` 占位符，且 `questions[].text` 也没有内容 |
| 听力没有声音 | 缺 `listening/sectionN.mp3`，或序号与 `section_number` 不一致 |
| 写作图不显示 | 图片不是 PNG，或路径不在 `writing/task1_figure.png` |

---

## 11. 用程序导出一个规范题包

如果你已经把一个自制题包导入成功，想得到一份“标准答案”式的结构参考，可以在**开发构建**里把 `src/lib/features.ts` 的 `ADVANCED` 改为 `true`，然后：

题库条目 →「导出」→ 得到一个包含阅读、听力、写作、答案、音频和题图的规范 ZIP。

发布版默认关闭这个入口（`ADVANCED = false`），普通用户不需要它。

---

## 12. 发布与分享

- **自己用**：随便放本地/私有网盘，建议加密备份。
- **开源项目示例**：只放**自己原创**的题包，且放到 GitHub Releases，不要放进 git 仓库。
- **受版权保护的题包**：不要公开分享，也不要放进 Releases 或在 README 放公开链接。
- `.gitignore` 已默认排除 `导入题目/` 与 `*.zip`，避免误提交。
