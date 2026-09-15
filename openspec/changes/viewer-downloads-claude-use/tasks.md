# Tasks: viewer-downloads-claude-use

## 1. 評論層改走 `claude.use`

**Covers**: `html-viewer-command` > `Requirement: 評論匯出`

- [x] 1.1 測試 stub 改為 contract 0.2.x 形狀（`window.claude` 只帶 `use`、namespace frozen），既有存檔測試改為等 resolve 後斷言
> TDD: test/core/render/comment-layer.test.ts `bootReady` helper＋stub (RED→GREEN)
- [x] 1.2 新增情境：resolve 前按鈕 hidden／只有舊式成員／`use` reject／`use` 同步拋錯／無 `window.claude`
> TDD: 「按鈕不在首次同步執行內現形」「只有舊式成員」在舊實作 RED；reject／無 window.claude 舊實作即綠（非回歸點，保留為護欄）
- [x] 1.3 `COMMENT_LAYER_SCRIPT`：`claude.use("downloads")` resolve 後才現形並綁定；`saveCommentsFile` 讀 closure namespace
> TDD: 同上兩支＋既有 8 支存檔測試 (RED→GREEN)

## 2. 驗證

**Covers**: `html-viewer-command` > `Requirement: 評論匯出`

- [x] 2.1 RED：舊實作上 comment-layer 測試 10 支失敗（含兩支新契約情境）
> TDD: [skip-tdd] 驗證步驟
- [x] 2.2 GREEN：comment-layer 測試全過；全套件 7 個檔案共 10 支失敗與 esmith-main 基線逐名相同（stash 對照，diff 為空），非本 change 引入；`openspec validate --strict` valid
> TDD: [skip-tdd] 驗證步驟
- [x] 2.3 `node build.js` 後 dist 含 `claudeRuntime.use("downloads")`、不含 `window.claude.downloads`
> TDD: [skip-tdd] 驗證步驟
- [ ] 2.4 發佈實測：`capabilities: {downloads: true}` 發佈 viewer，按鈕出現且 save 成功
