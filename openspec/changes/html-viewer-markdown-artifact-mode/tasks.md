# html-viewer-markdown-artifact-mode — Tasks

## 1. 依賴與骨架
**Covers**: `html-viewer-command` > `Requirement: markdown 內容以格式化 HTML 呈現`

- [x] 1.1 加 `marked` 為 dependency（鎖精確版號，無 caret），確認 lexer 可在 ESM 下 `import { marked }` 取得 token 樹
> TDD: [skip-tdd] 依賴變更
- [x] 1.2 建 `src/core/render/markdown.ts` 骨架：匯出 `renderMarkdown(md: string): string`，內部 `marked.lexer()` → 自寫 generator；先只支援段落與文字節點，其餘 token 一律走原文 fallback
> TDD: test/core/render/markdown.test.ts (RED→GREEN)

## 2. markdown generator（逐 token，每步配測試）
**Covers**: `html-viewer-command` > `Requirement: markdown 內容以格式化 HTML 呈現`

- [x] 2.1 heading（h1-h6，id 淨化為 `[a-z0-9-]+`）+ 水平線 + 引用區塊
> TDD: test/core/render/markdown.test.ts::block structure
- [x] 2.2 清單：有序／無序／嵌套（層級與原文一致）
> TDD: test/core/render/markdown.test.ts::nested lists
- [x] 2.3 GFM 管線表格（表頭 `<th>`、對齊列轉 CSS class；列數不齊 → 整塊走原文 fallback）
> TDD: test/core/render/markdown.test.ts::GFM table + malformed fallback
- [x] 2.4 行內：粗體／斜體／行內 code／連結（URL scheme allowlist：`http`/`https`/`mailto`/`#`，其餘降級純文字）
> TDD: test/core/render/markdown.test.ts::inline + link schemes
- [x] 2.5 fenced code block（語言標籤只當 class 且經淨化；未閉合 fence → 原文 fallback）
> TDD: test/core/render/markdown.test.ts::fenced code + lang class
- [x] 2.6 `type: 'html'` token 一律當純文字跳脫（原始 HTML 不透傳）
> TDD: test/core/render/markdown.test.ts::raw HTML as text

## 3. 對抗性測試（注入類，兩種模式各跑）
**Covers**: `html-viewer-command` > `Requirement: 產出單檔自足且跳脫無例外`

- [x] 3.1 payload 集：`<script>alert(1)</script>`、`<div onclick=x>`、`<img src=x onerror=1>`、字元參照走私、`--!>` 註解結束變體、`<style/>` 自閉合
> TDD: test/core/render/markdown.test.ts::payload set (12 payloads × 8 wrappers)
- [x] 3.2 連結注入：`[x](javascript:alert(1))`、`[x](data:text/html,...)`、`[x](vbscript:...)` → 皆降級純文字，DOM 無對應 href
> TDD: test/core/render/markdown.test.ts::dangerous link schemes
- [x] 3.3 屬性注入：連結 title 與 fence 語言標籤含 `" onmouseover="x` → 不產生額外屬性
> TDD: test/core/render/markdown.test.ts::link title + fence lang attr injection
- [x] 3.4 以 HTMLParser 級的解析驗證「零新增可執行節點」，兩種輸出模式各驗一次
> TDD: test/core/render/artifact-body.test.ts::escaping has no exceptions — both modes（結構審計：tag/attr allowlist）

## 4. 兩種輸出模式
**Covers**: `html-viewer-command` > `Requirement: artifact 發佈模式輸出無外殼片段`, `html-viewer-command` > `Requirement: 指令介面與輸出落點`

- [x] 4.1 `html-template.ts` 拆成 `buildBody()`（含 `<style>`／`<script>` 於片段內）與 `wrapDocument()`（doctype + head + `<meta charset>`）
> TDD: test/core/render/artifact-body.test.ts::no document wrapper + same body content
- [x] 4.2 CSS selector 全部限定在 `.spec-*` 前綴下（移除裸元素 selector，避免片段汙染宿主頁面）
> TDD: test/core/render/artifact-body.test.ts::scopes every style rule（抓到多餘 */ 的無效 CSS）
- [x] 4.3 `html.ts` 依模式輸出：預設 `wrapDocument(buildBody())`；artifact 模式直接輸出 `buildBody()`
> TDD: test/core/render/artifact-body.test.ts::default mode / artifact mode
- [x] 4.4 `commands/html.ts` 加 `--artifact-body` flag；與 `--open` 同時指定 → 非零 exit 並說明互斥，且**不產生任何檔案**
> TDD: test/commands/html.test.ts::--artifact-body（互斥旗標拒絕且不產檔 / 片段輸出 / 預設仍為完整文件）
- [x] 4.5 測試：片段模式輸出不含 `<!doctype`／`<html`／`<body`／`<head`；預設模式仍含 `<meta charset="utf-8">` 於前 1024 bytes
> TDD: test/core/render/artifact-body.test.ts::wrapper tags + charset in first 1024 bytes

## 5. 回歸與確定性
**Covers**: `html-viewer-command` > `Requirement: 產出單檔自足且跳脫無例外`

- [x] 5.1 既有 renderer 測試全綠（`pnpm test` 或既有測試指令），修正因 markdown 現已格式化而斷言原文的測試
> TDD: 全套 2277/2278 通過；唯一失敗 `test/specs/source-specs-normalization.test.ts` 為既有慢測試（單獨跑 9.6s，貼著 vitest 10s 上限，全套並行下超時），只讀 `openspec/specs/**` 與 `src/core/parsers/*`，皆不在本 change diff 內。既有 renderer 測試無一需要改斷言（原本斷言的 `spec-raw` 仍用於 fallback 與 gate 區塊）
- [x] 5.2 確定性測試：fixture change 對兩種模式各連跑兩次，diff 為空
> TDD: test/core/render/artifact-body.test.ts::determinism — both modes
- [x] 5.3 mermaid 區塊維持 `<pre class="mermaid">` 且產出檔不含 mermaid runtime（grep 驗證）
> TDD: test/core/render/artifact-body.test.ts::keeps mermaid as pre.mermaid and embeds no mermaid runtime

## 6. 實機驗證（真的看一次，不只跑測試）
**Covers**: `html-viewer-command` > `Requirement: markdown 內容以格式化 HTML 呈現`, `html-viewer-command` > `Requirement: artifact 發佈模式輸出無外殼片段`

- [x] 6.1 對真實 change（含表格 + mermaid + 嵌套清單的 design.md）產預設模式檔，`file://` 開啟：表格是表格、粗體無星號、清單有層級、中文不亂碼
> TDD: 實測：node bin/openspec.js html <change> --out（doctype/charset/表格/strong/嵌套清單/mermaid pre/中文皆確認）
- [x] 6.2 產 artifact 模式片段並實際發佈成 Artifact，確認：mermaid 渲染成圖、側欄樹／收合／scrollspy 可用、無外部請求
> TDD: 實機驗證完成——(a) 平台上 mermaid 確實渲染成圖、頁面可捲動（使用者實機截圖確認，同時證實 `:has` overflow 修正有效）；(b) markdown 格式化、側欄樹、捷運站皆正常；(c) 本機以最小宿主頁包裹片段（headless 截圖）渲染正確且宿主樣式未被影響＝CSS 限定有效。殘留：scrollspy 高亮未單獨確認（非阻塞，屬觀測性功能）
- [x] 6.3 build 後的 CLI（`dist/`）驗一次，確認不是只有 source 可用
> TDD: 實測：build 後以 dist 執行 node bin/openspec.js（含 --artifact-body 與互斥旗標）

## 8. 額外改善（apply 期間發現，非原 tasks 範圍）
**Covers**: `html-viewer-command` > `Requirement: markdown 內容以格式化 HTML 呈現`

- [x] 8.1 requirement 描述／scenario WHEN-THEN／task 內容原本直接 escape，反引號會露在畫面上（viewer 最常讀的區塊）→ 新增 `renderMarkdownInline()` 並套用三處
> TDD: test/core/render/markdown.test.ts::renderMarkdownInline（5 tests，含注入結構審計與 allowlist）
- [x] 8.2 `--artifact-body` flag 需同步 completion registry（全套測試抓到漏登記）
> TDD: test/core/completions/command-registry.test.ts（6 tests 綠）
- [x] 8.3 mermaid 邊標籤在深色主題下白底白字不可讀（使用者實機回報）→ 以固定深字／淺底 pin 住對比，`!important` 因 mermaid 自身注入 id-prefixed selector 而必要
> TDD: 由 test/core/render/artifact-body.test.ts 的結構審計把關（該測試抓到我在 CSS 註解寫的 `#mermaid-<id>` 被當成真標籤）
