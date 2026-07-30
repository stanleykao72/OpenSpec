# html-viewer-markdown-artifact-mode

Schema 判定記錄：openspec CLI renderer 工作（tooling），規則唯一命中 `spec-driven`，未開選單。

## Why

兩個問題讓 `openspec html` 產的 viewer 現在不好用：

1. **markdown 沒有被渲染**——artifact 原文直接塞進 `<pre>`，所以表格是 pipe 字串、`**粗體**` 露出星號、清單是純文字。實機以 `file://` 開 design.md 的架構表與 Goals 清單完全不可讀。
2. **交付方式錯了**——使用者要的是「給我一個 link 點開就看」，不是「去 filesystem 找 HTML」。而發佈成 Claude Artifact 時，平台會自己包 `<!doctype html>/<head>/<body>` 外殼，**與本 CLI 刻意產「完整獨立文件」（為 `file://` 的 `<meta charset>`）的既有約束直接牴觸**——目前沒有可直接發佈的輸出形式。

順帶：mermaid 圖在 Artifact 平台是**原生渲染**的（`<pre class="mermaid">`，正是本 CLI 已在輸出的格式），所以交付改走 Artifact 後，「把 mermaid runtime 內嵌進產出檔」這條路連帶不必走。

## What Changes

- **markdown 以格式化 HTML 呈現**：heading、清單（含嵌套）、GFM 管線表格、粗體/斜體、行內 code、fenced code block、連結、引用區塊、水平線。兩種輸出模式共用同一套渲染。
- **新增 artifact 輸出模式**（`--artifact-body`）：產出**無外殼片段**（不含 `<!doctype>`／`<html>`／`<head>`／`<body>`），可直接交給 Artifact 發佈；預設模式維持現行完整獨立文件（`file://` fallback）不變。
- **維持 secure by construction**：markdown → HTML 由固定 tokenizer 產生結構，**每個文字節點與屬性值仍強制跳脫**；artifact 內的原始 HTML 一律當文字，不透傳。連結 URL 走 scheme allowlist（`http`/`https`/`mailto`/`#`），拒 `javascript:`／`data:`。
- **mermaid 維持 `<pre class="mermaid">` 原樣輸出**：artifact 模式由平台渲染；完整文件模式維持文字區塊（**不內嵌 mermaid runtime**——不新增 mermaid 依賴、不讓產出檔漲到 MB 級、不引入「不可信文字交給第三方 runtime 解析」的注入面）。
- **無法解析的結構仍走原文 fallback**：畸形表格、未閉合 fence 維持 `<pre>` 原文，不猜測、不吞內容。
- **BREAKING（呈現層）**：`<pre class="spec-raw">` 不再是 markdown 內容的唯一呈現形式（仍用於 fallback）。無既有 flag 變更。

不做（明確排除）：
- 不做完整 CommonMark／GFM 相容（無腳註、定義清單、HTML passthrough）。
- 不內嵌 mermaid runtime（已由「交付走 Artifact」取代——先前選定的內嵌方案因此不再需要）。
- 不由 CLI 執行發佈——CLI 只負責產出可發佈的片段，發佈由呼叫端（opsx lifecycle／`/spec-html`）進行。

## Capabilities

### New Capabilities
（無）全部落在既有 `html-viewer-command` 的呈現與輸出契約內。

### Modified Capabilities
- `html-viewer-command`: 兩條需求變更＋兩條新增——
  - MODIFIED `指令介面與輸出落點`：新增 `--artifact-body` 模式的介面契約。
  - MODIFIED `產出單檔自足且跳脫無例外`：拆為兩種輸出模式（預設完整文件／artifact 模式無外殼）；跳脫約束從「`<pre>` 內文字」擴及每個產生的文字節點與屬性值，並新增 URL scheme allowlist。
  - ADDED `markdown 內容以格式化 HTML 呈現`
  - ADDED `artifact 發佈模式輸出無外殼片段`

## Impact

**程式碼**
- 新檔 `src/core/render/markdown.ts`（tokenizer + 安全 HTML 產生）
- `src/core/render/html.ts`（`renderMarkdownRaw` 改走新 renderer；輸出模式分支）
- `src/core/render/html-template.ts`（外殼／片段兩種組裝；CSS 需能併入片段內的 `<style>`）
- `src/commands/html.ts`（`--artifact-body` flag）
- 測試：markdown 對抗性測試（注入、畸形輸入）、兩模式的結構測試、確定性測試

**依賴**
- 新增 `marked`（**僅用其 lexer 取 token，不使用其 HTML 輸出**），鎖版號。
- **不**新增 `mermaid`。

**不影響**
- 既有預設輸出行為（完整獨立文件 + `<meta charset>`）不變，`file://` 直開仍可用。
- 落點政策、`--out`／`--open` 行為不變。
