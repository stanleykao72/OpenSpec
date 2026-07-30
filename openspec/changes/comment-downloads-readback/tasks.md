# Tasks: comment-downloads-readback

## 1. 評論層存檔路徑

- [x] 1.1 `COMMENT_LAYER_HTML`：匯出區新增「存成檔案（給 Claude Code 讀回）」按鈕（`hidden` 出廠、id `spec-comment-save-btn`）
> TDD: test/core/render/comment-layer.test.ts「capability 缺席時按鈕維持 hidden」(RED→GREEN)
- [x] 1.2 `COMMENT_LAYER_SCRIPT`：feature-detect（`window.claude && window.claude.downloads` → 移除 `hidden`）；點擊呼叫 `downloads.save({filename: sanitize 後檔名, data: buildExportMarkdown()})`；依 D3 error code 表分支提示
> TDD: 「capability 存在時按鈕現形…」＋四個拒絕分支測試 (RED→GREEN)；codex round-1 P2 修正：too_large 改可恢復路徑
- [x] 1.3 檔名淨化函式（D4）：`spec-comments-<change>.md`，空值 fallback `unknown-change`
> TDD: 「change 名淨化後為空時檔名用 unknown-change」＋超長截斷＋dash 邊界 (RED→GREEN)；codex round-1 P2 修正：120 字元上限

## 2. 測試（vm + fakedom）

- [x] 2.1 capability 缺席：按鈕維持 `hidden`；既有匯出測試不回歸
- [x] 2.2 capability 存在（stub 注入）：按鈕現形；save 收到正確檔名與逐字相同的 Markdown
- [x] 2.3 拒絕分支：`declined` 提示不重試；`bad_request` 開 fallback modal；`unavailable` 隱藏按鈕
- [x] 2.4 靜態審計與確定性：新 HTML 過結構審計 allowlist；兩模式 byte-identical；全套件綠
> TDD: [skip-tdd] 驗證步驟 — 全套件 2316/2316 綠（125 檔，含 byte-identical 測試）

## 3. 驗證與收尾

- [x] 3.1 發佈實測：以 `capabilities: {downloads: true}` 發佈本 change viewer，實際按存檔 → 確認 `~/Downloads/spec-comments-<change>.md` 落地且內容正確（acceptance 1）
> TDD: [skip-tdd] 使用者實測 — 2026-07-30 16:42 `spec-comments-comment-downloads-readback.md` 落地（755 bytes；曾因 stale dist 缺按鈕，rebuild 後通過）
- [x] 3.2 讀回實測：Claude Code 讀該檔並列出評論（閉環證明）
> TDD: [skip-tdd] 使用者實測 — session 讀回 1 筆評論（Proposal／引文／評論文字完整），免貼上閉環成立
- [x] 3.3 T-183（infra-spec-viewer-capability-readback）`related_change` 填本 change
> TDD: [skip-tdd] metadata — frontmatter 已填、lifecycle_log 已記
