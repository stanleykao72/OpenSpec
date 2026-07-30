# Proposal: comment-downloads-readback

> Schema 判定記錄：CLI renderer（TS tooling）工作，規則唯一命中 `spec-driven`，未開選單。
> 來源：vault todo `T-183-infra-spec-viewer-capability-readback`（followup of `spec-viewer-comment-layer`）。

## Why

評論層的閉環目前靠人工搬運：Notes 面板匯出 Markdown → 使用者複製 → 貼回 Claude Code session。使用者已確認想要免貼上升級。

可行性 gate（2026-07-30 roster 盤點）：本帳號 Artifact runtime capabilities 只有 `downloads` 與 `mcp` 兩種。**選 `downloads`**——發佈頁呼叫 `window.claude.downloads.save({filename, data})`，經瀏覽器確認後檔案落到本機（通常 `~/Downloads/`），Claude Code 直接讀檔，免貼上、資料不出本機、送出仍由使用者按鈕觸發。**棄 `mcp`**：要繞道雲端 connector 再讀回，多授權面與隱私面，且發佈前須實測各 connector tool 的 request/response，對本機 session 讀回無增益。

## What Changes

- `comment-layer.ts` 匯出區新增第二顆按鈕「存成檔案（給 Claude Code 讀回）」：
  - **只在 `window.claude.downloads` 存在時顯示**（feature-detect；file:// 直開與非 Artifact 環境自動隱藏，現行行為零變化）
  - 點擊時以 `downloads.save({filename: "spec-comments-<change>.md", data: buildExportMarkdown()})` 送出——**重用既有的匯出 Markdown**（已含 change 名、逐條 artifact 檔案歸屬、引文、評論、審查進度），不另造 JSON schema
  - 檔名中的 change 名淨化為 `[a-z0-9-]`；`data-change-name` 缺席時檔名用 `unknown-change`
  - 依 error code 分支：`declined` 顯示已取消；`rate_limited` 提示稍後再試；`bad_request`／`transform_error` 退回既有 fallback modal；`unavailable` 族隱藏按鈕並提示改用剪貼簿
- 剪貼簿匯出與 fallback modal 完全保留（primary fallback 不變）
- Delta spec：MODIFIED「評論匯出」requirement（+存檔路徑 3 scenarios）

## 不在本 change（第二段，odoo-claude-code）

發佈端宣告 `capabilities: {downloads: true}` 與 opsx overlay 的讀回步驟（讀 `~/Downloads/spec-comments-<change>.md` → 轉修訂工單）屬 odoo-claude-code repo，另立 change。本 change 的按鈕在未宣告 capability 的頁面上自動隱藏，先行合入無害。

## Impact

- **Capability**: `html-viewer-command`（MODIFIED 1 requirement，+3 scenarios）
- **Code**: `src/core/render/comment-layer.ts`（HTML 一顆按鈕＋script 存檔分支）+ `test/core/render/comment-layer.test.ts`
- **安全**: 匯出 sink 是檔案內容（純文字，非 HTML 解析情境）——沿「依 sink 跳脫」原則輸出原文不跳脫，與剪貼簿 sink 同級；不新增 innerHTML sink
- **確定性**: CLI 輸出仍 byte-identical（按鈕與分支是靜態常數；`Date` 只在使用者點擊的 runtime 路徑）

## Acceptance

1. Artifact 環境（`downloads` 已宣告）：按存檔鈕 → 瀏覽器確認 → `spec-comments-<change>.md` 落地，內容與剪貼簿匯出逐字相同
2. 非 Artifact 環境（file:// 直開）：存檔鈕不出現，剪貼簿匯出行為與現行完全一致
3. `declined`／`rate_limited`／`unavailable` 各分支提示正確、無靜默失敗
4. 既有全套件測試不回歸
