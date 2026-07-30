# html-viewer-command Delta（comment-downloads-readback）

## MODIFIED Requirements

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
