# html-viewer-command Delta Spec

## ADDED Requirements

### Requirement: markdown 內容以格式化 HTML 呈現

artifact（proposal / design / tasks / spec 原文區塊）的 markdown 內容 MUST 以格式化 HTML 呈現，而非原文純文字。支援集：ATX heading、有序/無序清單（含嵌套）、GFM 管線表格（含對齊列）、粗體、斜體、行內 code、fenced code block、連結、引用區塊、水平線。支援集之外的語法 MUST 以原文文字呈現而不報錯、不吞內容。artifact 內的原始 HTML MUST 一律當文字跳脫呈現，MUST NOT 透傳為標記。兩種輸出模式（完整文件／artifact 片段）MUST 共用同一套 markdown 渲染結果。

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

### Requirement: artifact 發佈模式輸出無外殼片段

CLI MUST 提供 artifact 發佈模式，產出**無外殼片段**：MUST NOT 含 `<!doctype>`、`<html>`、`<head>`、`<body>` 標籤（發佈平台會自行包裹，重複外殼會造成無效巢狀文件）。片段 MUST 自帶其所需的 `<style>` 與 `<script>`（inline、零外部資源引用），使發佈後的頁面在無外部請求下功能完整（側欄樹、收合、scrollspy）。mermaid 區塊 MUST 維持 `<pre class="mermaid">` 形式交由平台原生渲染，CLI MUST NOT 內嵌 mermaid runtime。

#### Scenario: 片段不含外殼
- **WHEN** 以 artifact 模式產出
- **THEN** 輸出不含 `<!doctype`、`<html`、`<head`、`<body` 任一標籤，且第一個元素即為內容根元素

#### Scenario: 片段功能自足
- **WHEN** 片段被發佈並在瀏覽器開啟
- **THEN** 側欄樹導覽、區塊收合、scrollspy 正常運作，且不發出任何外部網路請求

#### Scenario: mermaid 交由平台渲染
- **WHEN** design.md 含 mermaid 區塊且片段被發佈
- **THEN** 輸出中該區塊為 `<pre class="mermaid">`（內容經跳脫），產出檔內不含 mermaid runtime

#### Scenario: 預設模式不受影響
- **WHEN** 未指定 artifact 模式
- **THEN** 產出維持完整獨立文件（`<!doctype html>` 起頭、`<meta charset="utf-8">` 於前 1024 bytes），`file://` 直開行為與本 change 之前一致

## MODIFIED Requirements

### Requirement: 指令介面與輸出落點

CLI SHALL 提供 `openspec html <change-name> [--open] [--out PATH] [--artifact-body]`：change 名 MUST 經 changes 目錄列舉比對（含 `..`／路徑分隔符的輸入 MUST 拒絕）；預設寫入該 change 目錄的 `spec-viewer.html`，`--out` 覆寫落點；`--open` 產出後以預設瀏覽器開啟。`--artifact-body` 產出無外殼片段（見「artifact 發佈模式輸出無外殼片段」）；`--artifact-body` 與 `--open` 同時指定時 MUST 明確拒絕並以非零 exit 結束（片段不是可直開的文件，靜默開啟只會顯示破碎頁面）。找不到 change 時 SHALL 列出近似候選並以非零 exit code 結束。

#### Scenario: 基本產出
- **WHEN** 執行 `openspec html my-change`
- **THEN** `<changesDir>/my-change/spec-viewer.html` 被建立，exit 0，stdout 印出落點路徑

#### Scenario: 危險輸入拒絕
- **WHEN** 執行 `openspec html ../../etc`
- **THEN** 指令拒絕、不做任何檔案存取，exit 非零

#### Scenario: artifact 模式落點
- **WHEN** 執行 `openspec html my-change --artifact-body --out /tmp/body.html`
- **THEN** `/tmp/body.html` 為無外殼片段，exit 0，stdout 印出落點路徑

#### Scenario: 互斥旗標
- **WHEN** 同時指定 `--artifact-body` 與 `--open`
- **THEN** 指令以非零 exit 拒絕並說明兩者互斥，不產生任何檔案

### Requirement: 產出單檔自足且跳脫無例外

產出 HTML MUST 依模式滿足對應的自足性約束：

- **預設（完整文件）模式**：MUST 為單檔自足的**完整獨立文件**——`<!doctype html>` 起頭、html/head/body 各恰一次、`<head>` 內含 `<meta charset="utf-8">` 且位於檔案前 1024 bytes（以 `file://` 直開，無 charset 宣告時 CJK 內容必亂碼；此點與 Artifact/skill 版「禁包殼」約束刻意相反，該約束適用於由發佈平台包裹的情境）。
- **artifact 片段模式**：MUST NOT 含任何外殼標籤（由發佈平台包裹）。

兩模式共同 MUST：inline CSS/JS、零外部資源引用。

所有 artifact 衍生文字 MUST 經 HTML entity 跳脫——不只 `<pre>` 原文區塊，而是**每一個由 markdown 產生的文字節點與每一個屬性值**。HTML 結構 MUST 由固定的 tokenizer／產生器發出，MUST NOT 由 artifact 內容直接充當標記（secure by construction：不安全輸出沒有產生路徑，不做產出後掃描）。連結目的地 MUST 走 URL scheme allowlist（`http`、`https`、`mailto`、頁內 `#` 片段），其餘（含 `javascript:`、`data:`、`vbscript:`）MUST 降級為純文字。元素 id MUST 淨化為 `[a-z0-9-]+`。mermaid 區塊置於 `<pre class="mermaid">`（跳脫後文字）。

#### Scenario: file:// 直開 CJK 不亂碼
- **WHEN** 以預設模式產出，檔案以 `file://` 開啟且內容含正體中文
- **THEN** `<meta charset="utf-8">` 於 head 內前 1024 bytes，中文正常顯示

#### Scenario: 對抗性標記
- **WHEN** proposal.md 含字面 `<script>alert(1)</script>`
- **THEN** 兩種模式的輸出中均僅以跳脫文字出現，無新增可執行節點

#### Scenario: 對抗性連結
- **WHEN** artifact 含 `[點我](javascript:alert(1))`
- **THEN** 該連結降級為純文字，DOM 中不存在帶 `javascript:` 的 `href`

#### Scenario: 屬性注入
- **WHEN** artifact 的連結標題或 code fence 語言標籤含引號與屬性片段（如 `" onmouseover="x`）
- **THEN** 該內容僅以跳脫文字出現，不產生額外屬性
