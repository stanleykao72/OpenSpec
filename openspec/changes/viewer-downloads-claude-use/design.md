# Design: viewer-downloads-claude-use

## D1：namespace 在 `use()` resolve 時才綁定

**Covers**: `html-viewer-command`

契約：`use()` 的 promise 不會在頁面 script 的首次同步執行內 resolve，也不與 `DOMContentLoaded` 排序。
因此按鈕仍以 `hidden` 出廠（HTML 常數靜態、確定性不變），在 resolve 回呼裡才 `hidden = false` 並綁定點擊；
namespace 存在 closure 變數，`saveCommentsFile` 讀它，不再讀 `window.claude`。

替代方案：同時支援舊式 `window.claude.downloads` 成員作為後備——**不採用**。契約明言成員不保證存在，
保留後備等於繼續依賴未承諾的形狀，且讓測試無法證明「只走 use」。

## D2：`use` 缺席、拋錯、reject 一律等同 capability 缺席

**Covers**: `html-viewer-command`

- `window.claude` 不存在（file:// 直開、其他 host）或 `use` 不是函式 → 不呼叫
- `use()` 同步拋錯 → `try/catch` 轉成 `null`
- promise reject（模組載入失敗）→ rejection handler 靜默維持 hidden
- resolve 值為 `null` 或沒有 `save` 函式 → 維持 hidden

這些情況頁面其餘功能（剪貼簿匯出、fallback modal）都不受影響，與 capability 引入前一致。

## D3：namespace 是 frozen 物件，只呼叫不改寫

**Covers**: `html-viewer-command`

契約：resolve 出的 namespace 由平台擁有且 frozen。評論層只呼叫 `save`，測試 stub 以 `Object.freeze` 模擬，
任何對 namespace 的賦值在測試中會直接暴露。
