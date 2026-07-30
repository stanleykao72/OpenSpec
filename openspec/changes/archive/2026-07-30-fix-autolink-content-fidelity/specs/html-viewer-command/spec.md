# html-viewer-command Delta（fix-autolink-content-fidelity）

## MODIFIED Requirements

### Requirement: markdown 內容以格式化 HTML 呈現

artifact（proposal / design / tasks / spec 原文區塊）的 markdown 內容 MUST 以格式化 HTML 呈現，而非原文純文字。支援集：ATX heading、有序/無序清單（含嵌套）、GFM 管線表格（含對齊列）、粗體、斜體、行內 code、fenced code block、連結、引用區塊、水平線。支援集中的「連結」指**明寫 markdown 連結語法**（`[text](url)`、reference-style `[text][ref]`）與 **CommonMark 角括號 autolink**（`<url>`）；GFM bare autolink（裸 URL／裸 email，未以連結語法標示）**不在支援集內**，MUST 以原文文字逐字呈現、MUST NOT 產生 `<a>` 或任何 `href`。支援集之外的語法 MUST 以原文文字呈現而不報錯、不吞內容。artifact 內的原始 HTML MUST 一律當文字跳脫呈現，MUST NOT 透傳為標記。兩種輸出模式（完整文件／artifact 片段）MUST 共用同一套 markdown 渲染結果。

#### Scenario: 表格呈現為表格
- **WHEN** design.md 含 GFM 管線表格
- **THEN** 輸出為 `<table>` 結構（表頭 `<th>`、資料列 `<td>`），畫面上不出現 `|` 分隔字元

#### Scenario: 行內格式
- **WHEN** 內容含 `**粗體**`、`` `code` ``、`*斜體*`
- **THEN** 分別呈現為 `<strong>`／`<code>`／`<em>`，星號與反引號不出現在畫面上

#### Scenario: 嵌套清單
- **WHEN** 內容含二層縮排的無序清單
- **THEN** 輸出為嵌套 `<ul>`，層級關係與原文一致

#### Scenario: 原始 HTML 不透傳
- **WHEN** artifact 內含字面 `<div onclick="x">hi</div>`
- **THEN** 畫面以文字顯示該標記原文，DOM 中不存在新增的 `div` 或 `onclick` 屬性

#### Scenario: 不支援語法走原文 fallback
- **WHEN** 內容含畸形表格（列數不齊）或未閉合的 fenced code block
- **THEN** 該區塊以原文 `<pre>` 呈現，其餘內容照常格式化，指令 exit 0

#### Scenario: 含帳密連線字串保持原文逐字
- **WHEN** 內容含 `postgres://admin:pw@db.internal:5432/prod` 這類含 `user:pw@host` 樣態的連線字串
- **THEN** 渲染輸出保持該字串原文逐字連續（跳脫後等價），輸出中不存在任何 `mailto:` href，字串未被拆進 `<a>` 元素

#### Scenario: 裸 URL 與裸 email 以原文呈現
- **WHEN** 內容含未以連結語法標示的裸 `https://example.com` 或裸 `someone@example.com`
- **THEN** 以純文字呈現，不產生 `<a>` 元素

#### Scenario: 明寫連結與角括號 autolink 仍為連結
- **WHEN** 內容含 `[ok](mailto:a@b.c)` 與 `<https://x.dev>`
- **THEN** 各自輸出為含對應 `href` 的 `<a>` 元素，連結文字正確
