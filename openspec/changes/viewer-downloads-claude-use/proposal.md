# viewer 存檔按鈕改用 `claude.use("downloads")` 取得 capability（T-337）

## Why

`openspec html` 評論層的「存成檔案（給 Claude Code 讀回）」按鈕用 `window.claude.downloads` 判斷 capability 是否存在。
Artifact runtime contract 0.2.x 的 `window.claude` **只帶 `use`**，capability namespace 必須以
`await claude.use("downloads")` 非同步取得，且契約明言任何 `window.claude.<capability>` 成員都不保證存在。

結果：即使發佈時宣告了 `capabilities: {downloads: true}`，按鈕在每個 viewer 都永遠隱藏；
opsx 三個 overlay 的「讀回評論」流程只剩剪貼簿匯出一條路（vault T-337，fix line 做 T-319 propose 時發現）。

## What Changes

- 評論層改以 `claude.use("downloads")` 取得 namespace；resolve 為非 null 且帶 `save` 時按鈕才現形並綁定點擊
- resolve 為 `null`、`use` 缺席、`use` 拋錯或 reject：按鈕維持 hidden，其餘匯出行為不變
- 不再讀任何 `window.claude.<capability>` 成員
- 存檔的 error code 分支（declined／rate_limited／bad_request／too_large／unavailable 族）不變

## Capabilities

### New Capabilities

### Modified Capabilities

- `html-viewer-command`: 「評論匯出」的存檔動作改以 runtime 回報的 capability 可用性為準，capability 就緒前動作不出現

## Impact

- `src/core/render/comment-layer.ts`（評論層 script）
- `test/core/render/comment-layer.test.ts`（stub 改為 contract 0.2.x 形狀，新增舊式成員／use 失敗／無 window.claude 情境）
- odoo-claude-code `deploy/templates/html/skeleton.html` 的同段程式碼需同步（該 repo 另開 PR，維持 CLI／skeleton 語意一致）
