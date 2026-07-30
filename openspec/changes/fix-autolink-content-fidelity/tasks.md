# Tasks: fix-autolink-content-fidelity

## 1. Generator 修復

- [x] 1.1 `src/core/render/markdown.ts` `renderInline` `case 'link':` 加 raw 前綴判別：raw 不以 `[` 或 `<` 開頭 → 以 `token.text` 走降級純文字路徑（經 `escapeHtml`），不產生 `<a>`；附註解說明 GFM bare autolink 降級依據
> TDD: test/core/render/markdown.test.ts (RED→GREEN；降級實作沿既有 `inner` 路徑，與 D2 等價)

## 2. 測試

- [x] 2.1 對抗性主案：含 `postgres://admin:pw@db.internal:5432/prod` 的段落 → 輸出含跳脫後完整連續原字串、無 `mailto:`、該段無 `<a`
> TDD: test/core/render/markdown.test.ts "keeps credential-bearing connection strings verbatim" (RED→GREEN)
- [x] 2.2 裸樣態案：裸 `https://example.com` 與裸 `someone@example.com` → 純文字、無 `<a>`
> TDD: test/core/render/markdown.test.ts "renders bare URLs and bare emails as plain text" (RED→GREEN)
- [x] 2.3 不回歸案：`[ok](mailto:a@b.c)`、`<https://x.dev>`、reference-style `[x][ref]` → 各自產生正確 `href` 的 `<a>`
> TDD: test/core/render/markdown.test.ts "keeps explicit links, angle autolinks and reference-style links working"（寫於修復前即綠，鎖行為防回歸）
- [x] 2.4 全測試套件跑綠（既有 198 + 新增；用 `COREPACK_ENABLE_STRICT=0 corepack pnpm@10.5.2 test`）
> TDD: [skip-tdd] 驗證步驟 — 全套件 2308/2308 綠（125 files）

## 3. 驗證與收尾

- [x] 3.1 實檔驗證：以含連線字串的 artifact 跑 `openspec html`，肉眼確認原文逐字呈現
> TDD: [skip-tdd] 實檔驗證 — 本 change 自身 artifacts 重渲染：連線字串 4 處逐字完整、`href="mailto:pw..."` 0 處（唯一 `mailto:` 字樣是 proposal 行內 code 的跳脫引文，非 DOM 連結）
- [x] 3.2 vault todo T-185 標記（archive 階段 todo-scan 自動處理；此 task 僅確認 `related_change` 指向本 change）
> TDD: [skip-tdd] metadata — T-185 frontmatter `related_change: fix-autolink-content-fidelity` 已填，lifecycle_log 已記
