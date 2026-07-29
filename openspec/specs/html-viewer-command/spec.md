---
type: capability
scope: infrastructure
sources:
  - add-openspec-html-command (archived 2026-07-29)
---

# html-viewer-command Specification

## Purpose

`openspec html <change-name> [--open] [--out PATH]` 指令的行為契約：把 change 目錄 artifacts 渲染成單檔自足、確定性（同輸入 byte-identical）的完整獨立 HTML viewer。涵蓋指令介面與 basename 驗證、artifacts 讀取與缺席標示、跳脫無例外與 charset 要求（file:// 直開場景）、站別 × schema 的 gate 誠實呈現。渲染慣例與 odoo-claude-code spec-html skill 對齊；對齊 upstream Fission-AI/OpenSpec#1176。

## Requirements

### Requirement: 指令介面與輸出落點

CLI SHALL 提供 `openspec html <change-name> [--open] [--out PATH]`：change 名 MUST 經 changes 目錄列舉比對（含 `..`／路徑分隔符的輸入 MUST 拒絕）；預設寫入該 change 目錄的 `spec-viewer.html`，`--out` 覆寫落點；`--open` 產出後以預設瀏覽器開啟。找不到 change 時 SHALL 列出近似候選並以非零 exit code 結束。

#### Scenario: 基本產出
- **WHEN** 執行 `openspec html my-change`
- **THEN** `<changesDir>/my-change/spec-viewer.html` 被建立，exit 0，stdout 印出落點路徑

#### Scenario: 危險輸入拒絕
- **WHEN** 執行 `openspec html ../../etc`
- **THEN** 指令拒絕、不做任何檔案存取，exit 非零

### Requirement: artifacts 讀取與缺席處理

renderer SHALL 讀取 `proposal.md`、`design.md`、`tasks.md`、`specs/*/spec.md`、`.openspec.yaml`、`.gates/*.json`；個別檔案缺席時對應區塊 MUST 標「未產出」而非省略；`.openspec.yaml` 缺席時依檔名形狀判斷渲染模式。非標準 markdown 結構 MUST 以原文區塊呈現，MUST NOT 導致指令失敗。

#### Scenario: 不完整 change
- **WHEN** change 只有 proposal.md 與 tasks.md
- **THEN** HTML 產出成功，design／specs／gate 區塊標「未產出」

### Requirement: 產出單檔自足且跳脫無例外

產出 HTML MUST 為單檔自足的**完整獨立文件**：`<!doctype html>` 起頭、html/head/body 各恰一次、`<head>` 內含 `<meta charset="utf-8">` 且位於檔案前 1024 bytes（CLI 產出以 `file://` 直開，無 charset 宣告時 CJK 內容必亂碼——此點與 Artifact/skill 版「禁包殼」約束刻意相反，該約束僅適用於由發佈平台包裹的情境）；inline CSS/JS、零外部資源引用。所有 artifact 衍生文字與屬性值 MUST 經 HTML entity 跳脫（含 `<pre>` 原文區塊）；元素 id MUST 淨化為 `[a-z0-9-]+`；mermaid 區塊置於 `<pre class="mermaid">`（跳脫後文字）。

#### Scenario: file:// 直開 CJK 不亂碼
- **WHEN** 產出檔以 `file://` 在瀏覽器開啟且內容含正體中文
- **THEN** `<meta charset="utf-8">` 於 head 內前 1024 bytes，中文正常顯示

#### Scenario: 對抗性標記
- **WHEN** proposal.md 含字面 `<script>alert(1)</script>`
- **THEN** 輸出 HTML 中僅以跳脫文字出現，無新增可執行節點

### Requirement: 頁面結構與 gate 誠實呈現

頁面 SHALL 含：生命週期路線圖（目前站保守推定）、capability › requirement › scenario 側欄樹（scrollspy、requirement 摘要表＋場景收合）、群組計 tasks 進度（收合＋三欄表）、gate 紅綠燈。gate 組 MUST 依站別 × schema 決定（讀 schema 定義，不寫死清單）；gate 檔存在但 `total: 0`／`results: []` MUST 標「未實際執行」，MUST NOT 給綠燈。

#### Scenario: 未跑過的 gate
- **WHEN** `.gates/synthesis.json` 為 `total: 0`
- **THEN** 導讀列該站 gate 全部標 missing，摺疊區塊明寫「檔案存在但未實際執行」

### Requirement: 確定性輸出

同一 change 目錄內容不變時，重複執行 MUST 產出位元級相同的 HTML（不嵌時間戳、不嵌隨機值）；此性質 MUST 有測試以 fixture change 驗證（連續兩次產出 diff 為空）。

#### Scenario: 重複執行
- **WHEN** 對同一 fixture change 執行兩次
- **THEN** 兩次輸出 byte-identical
