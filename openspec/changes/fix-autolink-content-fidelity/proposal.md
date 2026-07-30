# Proposal: fix-autolink-content-fidelity

> Schema 判定記錄：CLI renderer 修復屬 tooling（非 Odoo），規則唯一命中 `spec-driven`，未開選單。
> 來源：vault todo `T-185-openspec-html-autolink-mangles-credentials`。

## Why

`openspec html` 的 markdown renderer 以 `{ gfm: true }` 呼叫 marked lexer，GFM 的 **bare autolink** 擴充會把裸 URL／email 樣態自動轉成 `link` token。實測受害情境：spec 內文含 `postgres://admin:pw@db.internal:5432/prod` 時，`pw@db.internal` 被切出來變成 `<a href="mailto:pw@db.internal">` —— 原文被肢解、一段密碼變成可點的 mailto 連結。

這是**內容失真**問題（非注入：mailto 在 scheme allowlist 內、href 有跳脫）。但它直接違反 canonical spec 已承諾的行為：「支援集之外的語法 MUST 以原文文字呈現」——支援集寫的「連結」指 markdown 連結語法，bare autolink 從未在支援集內。實害已發生一次：opsx 發佈前的敏感掃描因原字串被 autolink 拆斷而漏判 1/4 樣本（後以「掃來源不掃輸出」繞開，但 renderer 失真本身仍在）。

## What Changes

- `src/core/render/markdown.ts` 的 `renderInline` `case 'link':` 增加 raw 前綴判別：`token.raw` 不以 `[` 或 `<` 開頭（＝GFM bare autolink 產物）→ 走既有的降級純文字路徑，不產生 `<a>`。
- 明寫 markdown 連結（`[x](url)`、reference-style `[x][ref]`）與 CommonMark 角括號 autolink（`<https://x.dev>`）不受影響，仍正常成為連結。
- 新增對抗性測試：含帳密連線字串保持原文逐字、裸 URL/email 不產生 href、明寫連結不回歸。
- Delta spec：MODIFIED「markdown 內容以格式化 HTML 呈現」requirement——收緊「連結」定義、補 3 個 scenario。

## Explore 依據（2026-07-29，marked 18.0.7 實驗）

- Token 層重現：`marked.lexer(..., {gfm:true})` 對裸 email 產生 `link` token 且 `raw === 裸字串本身`（無括號）。
- 判別指紋驗證：`raw="pw@db.internal"`／`raw="https://example.com"` → 降級；`raw="<https://x.dev>"`／`raw="[ok](mailto:a@b.c)"` → 保留。四象限全對。
- 對照組（`new Marked` + `tokenizer.url()` 覆寫）結果等價，但需引入實例管線、依賴 tokenizer 覆寫 API 跨版本語意——棄用，理由見 design.md。
- 既有 198 測試無一依賴 bare autolink（allowlist 測試全用明寫語法），預估零回歸。

## Impact

- **Capability**: `html-viewer-command`（MODIFIED 1 requirement，+3 scenarios）
- **Code**: `src/core/render/markdown.ts`（generator 三行）+ `test/core/render/markdown.test.ts`（新測試）
- **行為變化（刻意）**: 裸 `https://...` 不再自動成連結——此為 canonical spec 已宣告的正確行為，非損失。
- **不影響**: `--artifact-body` 兩模式共用同一渲染結果，一次修同時生效；評論層、CSS、發佈流程零接觸。

## Acceptance（沿 T-185 note）

1. 含 `postgres://user:pw@host` 的 spec 內文渲染後保持原字串、不產生 `href`
2. `[x](mailto:a@b.c)` 與 `<https://x.dev>` 仍正常成為連結
3. 既有 renderer/CLI 測試不回歸；新增對照測試
