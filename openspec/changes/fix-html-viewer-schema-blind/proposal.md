# Proposal: spec-viewer 依 schema 推導 artifact 清單

## Why

`openspec html <change>` 的版面把 artifact 檔名寫死成 spec-driven 那一組
（`proposal.md` / `specs/**` / `tasks.md` / `design.md`）。change 若宣告別的
schema，四格全部落到「未產出」分支——**頁面看起來像 propose 徹底失敗，
其實檔案好好躺在 changeRoot**。

失敗形狀與「真的沒產出」外觀完全相同：量測工具壞掉時，讀數看起來像被量測
對象的問題。已知兩起實害：

| change | schema | 實際 changeRoot | viewer 顯示 |
|--------|--------|----------------|------------|
| `migrate-invoice-project-field` | `odoo-refactor` | analysis.md 10,703 B／backend-plan.md 8,067 B／frontend-plan.md 5,734 B | 四格全「未產出」 |
| `payslip-primary-lang-inactive-guard` | `odoo-bugfix` | issue.md／fix-notes.md | 同上（使用者讀成「那個 change 沒做事」） |

`renderChangeHtml` **本來就收到 `schema`**（`collectGateIdsForStation` 已在用
它決定 gate 組，spec 也已寫明 gate「MUST 依站別 × schema 決定，不寫死清單」）。
artifact 那一半只是沒跟上同一條規矩。

影響面：opsx 三個 skill（propose／apply／verify）的 overlay 都呼叫
`openspec html`，所以**每一個非 spec-driven 的 change、在每一個階段**都會產出
空白 viewer。`odoo-trivial`／`odoo-bugfix`／`odoo-refactor` 全中，只有
`odoo-sdd`／`odoo-sdd-strict`／`spec-driven` 逃過。

## What Changes

- artifact 清單改由 `schema.artifacts[].generates` 推導，取代三個字面值
  （`proposal.md`／`design.md`／`tasks.md`）；主區塊與側欄樹共用同一份清單
- 「未產出」標記的作用域收斂為**該 schema 宣告過的 artifact**：odoo-refactor
  沒宣告 specs glob，就不該出現「specs/ 未產出」——對沒宣告的東西標未產出，
  是把同一顆 bug 換個方向再犯一次
- `determineStation` 的 propose 判定改為「任一宣告的 artifact 存在」，apply
  判定改讀 schema 的 `apply.tracks` 檔（fallback `tasks.md`）
- schema 為 null 時（無法解析）維持現行 spec-driven 字面清單，行為不變
- **不改**「個別檔案缺席時對應區塊 MUST 標『未產出』而非省略」——那條是對的，
  bug 純粹是「它只認得 spec-driven 那組檔名」

## Capabilities

**Modified Capabilities**:
- `html-viewer-command` — artifact 讀取來源由字面檔名改為 schema 宣告；
  「未產出」作用域限縮於宣告集

## Impact

- `src/core/render/html.ts`（`renderChangeHtml`、`determineStation`、
  `renderShell`、`renderSidebar`）
- `test/core/render/html.test.ts`、`test/fixtures/html-changes/`
- 使用者可見：非 spec-driven 的 change 重跑 `openspec html` 後才會拿到正確頁面
  （現有空白頁不會自己修好）
