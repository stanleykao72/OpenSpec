# Design: add-openspec-html-command

## Context

skill 端（odoo-claude-code `spec-html`）已把 viewer 頁面結構經三輪使用者實測打磨穩定；本 change 把渲染固化為 fork CLI 的確定性 renderer，對齊 upstream #1176。CLI 現況：`src/commands/shared-output.ts` 是 text/json 雙軌收斂點，全 repo 零 HTML 產出。

## Goals / Non-Goals

**Goals:**
- `openspec html` 指令＋可重用 `src/core/render/html.ts`（未來 `view --html`／`gate check --html` 的共用基底）
- 與 skill 版渲染語意對齊（同一套慣例、同樣的誠實 gate 呈現）
- 確定性、零 model token、可進 CI

**Non-Goals:**
- 評論層／互動審查（skill/Artifact 生態，另案 `--comments`）
- Artifact 發佈（CLI 只產檔）
- 既有指令的 `--html` 擴充（另案）
- upstream PR 本身（實作完成後另行整理）

## Decisions

### Decision 1: 模板 token 以 TS 常數內嵌，不跨 repo 引用
**Covers**: `html-viewer-command`

odoo-claude-code 的 `deploy/templates/html/` 是 skill 生態的事實來源，但 fork 必須自足（upstream 化前提）。做法：把 conventions 的 design token（色票、class、區塊結構）移植為 `src/core/render/html-template.ts` 常數；skeleton 的 JS（drawer/scrollspy/revealTarget）逐字移植。兩處慣例的同步靠人工（變更頻率已低），偏離時以 fork 版為 CLI 事實來源。替代方案 git submodule／檔案複製 build step——對 upstream 貢獻是負擔，捨棄。

### Decision 2: markdown 解析用最小自寫 parser，不引第三方
**Covers**: `html-viewer-command`

只需解析標準 artifact 形狀（`### Requirement:`／`#### Scenario:`／checkbox 清單／標題層級／mermaid fence）；repo 既有 `src/core/parsers/` 已有部分能力，優先重用。引 marked/remark 會帶進完整 markdown 語意（含 raw HTML passthrough——正是 XSS 面），與「跳脫無例外」相衝。非標準內容整段跳脫後進 `<pre>`。

### Decision 3: 確定性為一級需求
**Covers**: `html-viewer-command`

不嵌時間戳／隨機 id；排序一律依檔名或文件順序。fixture 測試連續兩次產出 diff 為空。這是 CLI 版相對 skill 版的核心價值（skill 版每次 model 渲染必有變異）。

### Decision 4: gate 組讀 schema 定義
**Covers**: `html-viewer-command`

fork 內建 schema loader 可讀 `schema.yaml` 的 `propose.gates`／`verify.gates`；站別推定沿 skill 版規則（`.gates` 產出形狀＋tasks 勾選）。寫死清單已在 skill 端被 verify 抓過 CRITICAL，不重犯。

## Risks / Trade-offs

- [Risk] 兩套模板（TS 常數 vs deploy/templates）漂移 → conventions 變更時人工同步；fork 版測試鎖住結構斷言，漂移會被 fixture diff 抓到
- [Risk] parser 對怪異 markdown 誤判 → 非標準內容一律原文跳脫呈現，fail-open 不 fail-crash
- [Trade-off] 無評論層 → CLI 產出是純閱讀版；要互動審查用 skill 版

## Migration Plan

1. 純新增（commands/render/tests）；回滾＝revert
2. `pnpm build` ＋ `pnpm test`；本 repo CI（vitest）涵蓋
3. 對 odoo-claude-code 的真實 archive change fixture 驗收一次

## Open Questions

- 無阻斷性問題。upstream PR 的時點與範圍待實作完成後另議。
