# capability-coverage gate：讀 New＋Modified、零 capability 不再通過、反查 spec 目錄（T-366）

## Why

內建 gate `capability-coverage`（專案 schema 以 `structural-alignment` 與 apply 前置 gate 使用）有兩種「沒檢查卻回報通過」：

- **零 capability 通過**：proposal 沒有 Capabilities 段、或根本沒有 proposal.md 時，解析出 0 個 capability，gate 回報通過。實例：vault 內兩個改名 change 缺 Capabilities 段、一個只有 `.openspec.yaml` 的空 change，都通過了 structural-alignment。
- **只讀 New Capabilities**：`### Modified Capabilities` 整段被略過。實例：vault-recall-and-curation 在 Modified 列了 `memory-backend-vault` 卻沒有 delta spec，本 gate 通過，同一份 proposal 在 alignment-check 的 traceability／spec-lint 卻失敗——三道 gate 對「proposal 列了哪些 capability」看法不一。

另外本 gate 只查「proposal 列的 capability 有沒有 spec 目錄」，不查反方向：spec 目錄沒被 proposal 列出也會通過。

## What Changes

- 解析 `### New Capabilities` 與 `### Modified Capabilities` 兩段（不再要求上層有 `## Capabilities`），條目接受清單與表格，忽略 fenced code block，去重保序
- 解析出 0 個 capability 時 gate 失敗，並在結果附上原因
- 新增反向檢查：spec 目錄不在 proposal capability 清單內時 gate 失敗，列在 `orphan_spec_dirs`
- 新增共用測試向量檔，與 odoo-claude-code alignment-check 的解析器共用同一份預期輸出

## Capabilities

### New Capabilities

- `gate-capability-coverage`: capability-coverage gate 判定哪些 capability 被列出、何時通過、失敗時回報什麼

### Modified Capabilities

## Impact

- `src/core/validation/gate-checker.ts`（`checkCapabilityCoverage`、`parseProposalCapabilities`）
- `test/core/validation/gate-checker.test.ts`、`test/core/validation/fixtures/capability-parser-vectors.json`
- **行為變更**：原本零 capability 通過的 change 現在會失敗（原有三支測試把空集合通過寫成預期，本 change 依 T-366 裁定改為失敗）
- 配對：odoo-claude-code alignment-check 共用解析器與同一份測試向量（另一支 PR）
