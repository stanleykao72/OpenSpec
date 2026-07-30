# Design: comment-downloads-readback

## D1: 選 `downloads`、棄 `mcp`（可行性 gate 結論）

**Decision**: 用 Artifact runtime `downloads` capability。頁面呼叫 `window.claude.downloads.save({filename, data})`，瀏覽器確認後檔案落本機，Claude Code 直接讀 `~/Downloads/spec-comments-<change>.md`。

**Rejected**: `mcp` capability（經雲端 connector 如 Drive 寫入再讀回）| 多一層 connector 授權與隱私面；發佈前須對每個用到的 connector tool 實測 request/response pair；對「本機 session 讀回」是繞遠路。
**Rejected**: 共享狀態／self-update 類 capability | roster 上不存在（本帳號只有 `downloads` 與 `mcp`）。

## D2: 重用 buildExportMarkdown，不造 JSON schema

存檔內容與剪貼簿匯出**逐字相同**——該 Markdown 本來就是「給 AI 的修訂指令」形狀（文首指令標頭、逐條 change 名＋artifact 檔案歸屬＋引文＋評論、審查進度）。讀回端（Claude Code）讀 .md 即可直接執行，JSON 反而要再轉譯一次。

**Rejected**: 版本化 JSON（`{schema, change, comments[], reviews}`）| 增加雙端 schema 維護與轉譯，收益為零——讀回端是 LLM，Markdown 就是它的原生輸入。

沿「依 sink 跳脫」原則：檔案 sink 與剪貼簿 sink 同級（純文字、非 HTML 解析情境），輸出原文不跳脫；面板 innerHTML 路徑維持 escapeHtml 不變。

## D3: feature-detect 決定按鈕存在

`COMMENT_LAYER_HTML` 中按鈕以 `hidden` 屬性出廠；script 初始化時 `if (window.claude && window.claude.claude === undefined ? ... : ...)` ——實際判式：`window.claude && window.claude.downloads` 存在才移除 `hidden`。理由：HTML 常數保持靜態（確定性 byte-identical），可見性由 runtime 決定；file:// 與未宣告 capability 的頁面零行為變化。

錯誤分支（型別定義 0.1.15 的 code 集）：

| code | 行為 |
|------|------|
| `declined` | 提示「已取消存檔」，不重試 |
| `rate_limited` | 提示「已有確認框開啟或請求過密，稍後再試」 |
| `bad_request`／`transform_error` | 退回既有 fallback modal（可全選 textarea） |
| `unavailable`／`not_granted`／`capability_disabled`／`capability_removed`／未知 code | 隱藏按鈕＋提示改用剪貼簿匯出 |

## D4: 檔名淨化

`"spec-comments-" + changeName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") + ".md"`；淨化後為空（純 CJK change 名）或 CHANGE_NAME 缺席 → `spec-comments-unknown-change.md`。save 端另有平台側 sanitize＋viewer 確認最終檔名，此處只求建議名穩定可預測（讀回端 glob 用）。

## D5: 測試策略（vm + fakedom）

- capability 缺席：boot 後按鈕仍 `hidden`；匯出行為與既有測試斷言一致（回歸保護）
- capability 存在（harness 注入 `window.claude.downloads` stub）：按鈕現形；點擊後 stub 收到 `{filename: "spec-comments-<change>.md", data}` 且 data === buildExportMarkdown 輸出（逐字）
- 拒絕分支：stub reject `{code:"declined"}` → 提示文案、不重試；`{code:"bad_request"}` → fallback modal 開啟；`{code:"unavailable"}` → 按鈕隱藏
- 靜態審計：新增 HTML 常數過既有結構審計 allowlist；兩模式 byte-identical 維持

## Risks

- fakedom 對 Promise rejection 鏈無特殊限制（純 JS），風險低；真實 Artifact 環境的確認框行為無法離線重現 → 依賴發佈後實測（acceptance 1）
- 平台 sanitize 可能改寫最終檔名 → 讀回端 glob 用 `spec-comments-*.md` 寬鬆比對，不假設逐字
