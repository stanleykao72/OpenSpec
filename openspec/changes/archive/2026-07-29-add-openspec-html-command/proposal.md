# Proposal: add-openspec-html-command

> Schema 判定記錄：CLI tooling 工作，規則唯一命中 `spec-driven`，未開選單。
> 上游對齊：Fission-AI/OpenSpec#1176（open feature request，提案即 `openspec html <change>`）。

## Why

CLI 目前所有輸出都是 chalk 終端文字＋`--json` 雙軌，沒有給人看的檔案級產出；分享 spec 得傳 markdown 原始檔。skill 端的 model 渲染（odoo-claude-code `spec-html`）已把頁面結構與慣例打磨穩定（三輪使用者實測迭代），現在把它固化成**確定性 CLI renderer**：同一 change 每次產出位元級相同的 HTML、零 model token、可進 CI，並可作為 upstream #1176 的貢獻基礎。

## What Changes

- 新增 `openspec html <change-name> [--open] [--out PATH]` 指令：讀 change 目錄 artifacts（proposal / design / tasks / specs / `.openspec.yaml` / `.gates/*.json`），產出單檔自足 `spec-viewer.html`（預設寫入 change 目錄；`--open` 以預設瀏覽器開啟）
- 新增 `src/core/render/html.ts` 共用 renderer：吃結構化資料輸出 HTML；模板 token 移植 odoo-claude-code `deploy/templates/html/` 的既定慣例（生命週期路線圖、側欄內容樹、requirement 摘要表、群組進度、gate 紅綠燈站別×schema、跳脫無例外），以 TS 常數內嵌（本 repo 自足，不跨 repo 引用）
- 渲染語意與 skill 版對齊：缺席 artifact 標「未產出」、gate `total: 0` 標「未實際執行」、無包殼標籤、零外部資源
- **不含**評論層（互動層屬 skill/Artifact 生態；CLI 產出可日後選配 `--comments` 另案）
- **不動**既有指令的輸出；`view --html` / `gate check --html` 等擴充另案（renderer 就緒後近零成本）

## Capabilities

### New Capabilities
- `html-viewer-command`: `openspec html` 指令的行為契約——參數與輸出落點、artifacts 讀取與缺席處理、HTML 自足性與跳脫、gate 誠實呈現、確定性（同輸入同輸出）

### Modified Capabilities

（無——純新增指令，不改既有 capability 行為。）

## Impact

- **程式**：`src/commands/html.ts`（新）、`src/core/render/html.ts`（新）、`src/cli/index.ts`（註冊指令）、`test/`（renderer 單元測試＋fixture change）
- **依賴**：零新 runtime 依賴（Node 內建；`--open` 用平台 open 指令）
- **上游**：K→U 類——實作完成後可整理成 upstream #1176 的 PR
- **風險**：低——純新增；markdown 解析限標準 artifact 形狀，非標準內容以原文區塊呈現不失敗
