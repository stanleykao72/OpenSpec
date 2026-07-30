---
type: capability
scope: infrastructure
sources:
  - add-openspec-html-command (archived 2026-07-29)
  - html-viewer-markdown-artifact-mode (archived 2026-07-30)
  - port-comment-layer-to-cli (archived 2026-07-30)
  - fix-autolink-content-fidelity (archived 2026-07-30)
  - comment-downloads-readback (archived 2026-07-30)
---

# html-viewer-command Specification

## Purpose

`openspec html <change-name> [--open] [--out PATH]` 指令的行為契約：把 change 目錄 artifacts 渲染成單檔自足、確定性（同輸入 byte-identical）的完整獨立 HTML viewer。涵蓋指令介面與 basename 驗證、artifacts 讀取與缺席標示、跳脫無例外與 charset 要求（file:// 直開場景）、站別 × schema 的 gate 誠實呈現。渲染慣例與 odoo-claude-code spec-html skill 對齊；對齊 upstream Fission-AI/OpenSpec#1176。
## Requirements
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

### Requirement: artifacts 讀取與缺席處理

renderer SHALL 讀取 `proposal.md`、`design.md`、`tasks.md`、`specs/*/spec.md`、`.openspec.yaml`、`.gates/*.json`；個別檔案缺席時對應區塊 MUST 標「未產出」而非省略；`.openspec.yaml` 缺席時依檔名形狀判斷渲染模式。非標準 markdown 結構 MUST 以原文區塊呈現，MUST NOT 導致指令失敗。

#### Scenario: 不完整 change
- **WHEN** change 只有 proposal.md 與 tasks.md
- **THEN** HTML 產出成功，design／specs／gate 區塊標「未產出」

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

### Requirement: 頁面結構與 gate 誠實呈現

頁面 SHALL 含：生命週期路線圖（目前站保守推定）、capability › requirement › scenario 側欄樹（scrollspy、requirement 摘要表＋場景收合）、群組計 tasks 進度（收合＋三欄表）、gate 紅綠燈。gate 組 MUST 依站別 × schema 決定（讀 schema 定義，不寫死清單）；gate 檔存在但 `total: 0`／`results: []` MUST 標「未實際執行」，MUST NOT 給綠燈。

#### Scenario: 未跑過的 gate
- **WHEN** `.gates/synthesis.json` 為 `total: 0`
- **THEN** 導讀列該站 gate 全部標 missing，摺疊區塊明寫「檔案存在但未實際執行」

### Requirement: 確定性輸出

同一 change 目錄內容不變時，重複執行 MUST 產出位元級相同的 HTML（不嵌時間戳、不嵌隨機值）；此性質 MUST 有測試以 fixture change 驗證（連續兩次產出 diff 為空）。

#### Scenario: 重複執行
- **WHEN** 對同一 fixture change 執行兩次
- **THEN** 兩次輸出 byte-identical

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

### Requirement: 選取即評論與註記標記

viewer MUST 支援對內文選取文字後加註記：選取後出現評論入口，送出後該段文字 MUST 以可見標記呈現，並可從標記或 Notes 面板刪除該註記。評論文字為使用者輸入，寫入 DOM 與匯出時 MUST 依各自的 sink 跳脫（DOM 走文字節點或 HTML entity 跳脫，Markdown 匯出走 Markdown 轉義），MUST NOT 讓評論內容成為標記。刪除註記後被標記文字 MUST 還原為原樣（含巢狀標記的情形）。

#### Scenario: 選取後加註記
- **WHEN** 使用者在需求或設計內文選取一段文字並送出評論
- **THEN** 該段文字出現可見標記，且該註記出現在 Notes 面板

#### Scenario: 註記可刪除且還原原文
- **WHEN** 使用者刪除一則註記
- **THEN** 標記移除、原文還原，其餘註記與標記不受影響

#### Scenario: 評論內容不得成為標記
- **WHEN** 評論文字為 `<img src=x onerror=alert(1)>`
- **THEN** 畫面以文字顯示該內容，DOM 中不存在新增的 `img` 或事件處理屬性

#### Scenario: 選取跨越區塊
- **WHEN** 選取範圍跨越兩個不同區塊
- **THEN** 拒絕建立註記並說明僅支援單一區塊內選取，不產生半套標記

### Requirement: Notes 面板與持久化分域

viewer MUST 提供可開關的 Notes 面板，列出目前所有註記與已審狀態。持久化 MUST 以 `localStorage` 進行，且 key MUST 依 change 名分域；change 名 MUST 取自渲染時輸出在內容根元素的 `data-change-name` 屬性，MUST NOT 依賴 `document.title`（artifact 片段模式無 `<head>`／`<title>`，且 renderer 在渲染時已知 change 名）。`data-change-name` 缺席或為空、或 `localStorage` 不可用時，MUST 降級為 in-memory 並在面板明示「本次評論不會保存」，MUST NOT 落地到任何共用的固定 key。

#### Scenario: 依 change 分域
- **WHEN** 兩個不同 change 的 viewer 在同一瀏覽器開啟並各自加註記
- **THEN** 兩者的註記互不可見、互不覆蓋

#### Scenario: 重新載入後保留
- **WHEN** 加註記後重新載入同一個 viewer（同一 URL、同一 change 名）
- **THEN** 註記與已審勾選仍在

#### Scenario: 無法持久化時明示
- **WHEN** `localStorage` 不可用（隱私模式、`file://` 受限環境）或 `data-change-name` 缺席
- **THEN** 功能仍可用但僅存於記憶體，面板頂端明示不會保存，且不寫入任何 `localStorage` key

### Requirement: 區塊已審勾選

每個主要區塊（proposal / 各 capability 的 specs 卡 / tasks / design / gate 證據）MUST 提供「已審」勾選，`data-review-key` MUST 為該區塊自身的 id，狀態 MUST 與註記同一分域規則持久化。勾選 MUST NOT 改變或隱藏該區塊的內容。

#### Scenario: 勾選後持久化
- **WHEN** 勾選某區塊「已審」並重新載入
- **THEN** 該勾選仍保持

#### Scenario: 勾選不影響內容
- **WHEN** 勾選任一區塊
- **THEN** 該區塊的文字、表格、收合狀態均不改變

### Requirement: 評論匯出

viewer MUST 提供把全部註記與已審狀態匯出為 Markdown 的動作，內容 MUST 含 change 名、被註記的原文片段與註記文字，供貼回對話使用。匯出 MUST 優先寫入剪貼簿；剪貼簿不可用時 MUST 退回可全選複製的顯示區塊，MUST NOT 靜默失敗。

當頁面執行環境提供 `window.claude.downloads`（Artifact runtime `downloads` capability）時，viewer MUST 額外提供「存成檔案」動作：以 `downloads.save` 送出與剪貼簿匯出**逐字相同**的 Markdown，建議檔名 MUST 為 `spec-comments-<change>.md`（change 名淨化為 `[a-z0-9-]`；`data-change-name` 缺席時用 `unknown-change`）。`window.claude.downloads` 缺席時該動作 MUST 不出現，其餘匯出行為 MUST 與 capability 出現前完全一致。存檔被拒或失敗時 MUST 依 error code 呈現對應提示（`declined` 已取消、`rate_limited` 稍後再試、`unavailable` 族隱藏動作並指向剪貼簿路徑、`bad_request`／`transform_error` 退回可全選複製的顯示區塊），MUST NOT 靜默失敗、MUST NOT 自動重試 `declined`。

#### Scenario: 匯出到剪貼簿
- **WHEN** 使用者按下匯出且剪貼簿可用
- **THEN** Markdown 進入剪貼簿並顯示成功提示

#### Scenario: 剪貼簿不可用時的退路
- **WHEN** 剪貼簿 API 不可用或被拒
- **THEN** 顯示可全選複製的 Markdown 區塊，並說明為何退回此路徑

#### Scenario: capability 存在時提供存檔動作
- **WHEN** `window.claude.downloads` 存在且使用者按下存檔、瀏覽器確認接受
- **THEN** `downloads.save` 收到檔名 `spec-comments-<change>.md` 與跟剪貼簿匯出逐字相同的 Markdown 內容，並顯示成功提示

#### Scenario: capability 缺席時不出現存檔動作
- **WHEN** 頁面環境無 `window.claude.downloads`（file:// 直開或未宣告 capability 的發佈頁）
- **THEN** 存檔動作不出現在面板中，剪貼簿匯出與 fallback 行為與 capability 引入前完全一致

#### Scenario: 存檔被拒不靜默
- **WHEN** `downloads.save` 以 `declined` 拒絕
- **THEN** 顯示「已取消」類提示、不自動重試；改以 `bad_request` 拒絕時退回可全選複製的顯示區塊


### Requirement: 評論層可分離且不干擾既有導覽

評論層 MUST 為可分離構件：其 CSS／HTML／script 三段被移除後，既有導覽（側欄樹、scrollspy、收合、抽屜）MUST 仍完全運作。評論層 script MUST 為獨立 IIFE，MUST NOT 與導覽 script 共用變數或函式、MUST NOT 修改其 `revealTarget()`／scrollspy／drawer 邏輯。兩種輸出模式（完整文件／artifact 片段）MUST 皆包含評論層，且其存在 MUST NOT 破壞既有的位元級確定性（構件為常數）。

#### Scenario: 移除評論層後導覽仍運作
- **WHEN** 從產出中移除評論層三段
- **THEN** 側欄樹點擊、收合展開、scrollspy 高亮皆正常

#### Scenario: 確定性不變
- **WHEN** 對同一 fixture change 以同一模式連跑兩次
- **THEN** 兩次輸出 byte-identical

