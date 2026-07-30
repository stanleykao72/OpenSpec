# Design: fix-autolink-content-fidelity

## D1: 修在 generator 端，不動 lexer（核心決策）

**Decision**: 在 `renderInline` 的 `case 'link':` 開頭加 raw 前綴判別——`!token.raw.startsWith('[') && !token.raw.startsWith('<')` 時視為 GFM bare autolink，走既有的降級純文字路徑（把 `token.text` 當一般文字經 `escapeHtml` 輸出），不產生 `<a>`。

**依據（explore 實驗，marked 18.0.7）**：autolink token 的 `raw` 就是裸字串本身；明寫連結 raw 以 `[` 開頭、角括號 autolink raw 以 `<` 開頭。四種輸入的判別全對，且 reference-style `[x][ref]` 自然落在保留側。

**Rejected**: `new Marked({gfm:true})` + `m.use({tokenizer:{url(){return undefined}}})` 在 tokenization 端移除 bare autolink。實驗同樣可行（GFM 表格不受影響），但：①引入 Marked 實例管線，改動面大於三行；②依賴 tokenizer 覆寫 API 的跨版本語意，marked 升版時是額外風險面；③模組既有 invariant 是「結構由本模組自己的 switch 發出」、Directive 是「新增行為一律加在 generator 的 switch 上並補對抗性測試」——generator 端修法與兩者同構，tokenizer 覆寫則繞到模組邊界之外。

**Rejected**: 關掉 `gfm: true`。GFM 管線表格是支援集的核心項目，不可行。

## D2: 降級後的文字內容用 `token.text` 而非 `token.raw`

bare autolink 的 `raw` 與 `text` 相同（無語法外殼），兩者等價；用 `text` 與既有降級路徑（scheme 不在 allowlist 時的處理）保持同一形狀，不另立分支。

## D3: 測試策略

- 對抗性主案：整段含 `postgres://admin:pw@db.internal:5432/prod` 的段落 → 斷言輸出含跳脫後的完整連續字串、不含 `mailto:`、不含 `<a`（該段落範圍內）。
- 不回歸案：`[ok](mailto:a@b.c)`、`<https://x.dev>`、reference-style 連結 → 各自產生正確 `href`。
- 裸樣態案：裸 URL、裸 email → 純文字。
- 結構審計原則沿用：斷言宣告的標籤/屬性集合，不 regex 掃輸出全文（跳脫文字合法含可疑子字串）。
- 既有 198 測試 MUST 全綠（explore 已確認無測試依賴 bare autolink）。

## Risks

- **極低**：改動只影響 `link` token 中 raw 無括號前綴的子集；marked 產生此形態的唯一來源就是 GFM autolink 擴充。
- 未來 marked 升版若改變 autolink token 的 raw 形狀，對抗性測試會直接抓到（紅燈即訊號）。
