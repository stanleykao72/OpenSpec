# Tasks: capability-coverage-new-and-modified

## 1. 測試先行

**Covers**: `gate-capability-coverage` > `Requirement: capability 清單涵蓋 New 與 Modified`, `gate-capability-coverage` > `Requirement: 沒有 capability 時不回報通過`, `gate-capability-coverage` > `Requirement: proposal 與 spec 目錄雙向一致`

- [x] 1.1 共用測試向量檔 `test/core/validation/fixtures/capability-parser-vectors.json`（13 例）
- [x] 1.2 原有三支「零 capability 通過」測試改為預期失敗並檢查原因
- [x] 1.3 新增 Modified 計入、spec 目錄反查、向量驅動測試
- [x] 1.4 RED：舊實作上 13 支失敗（38 支通過）

## 2. 實作

**Covers**: `gate-capability-coverage` > `Requirement: capability 清單涵蓋 New 與 Modified`, `gate-capability-coverage` > `Requirement: 沒有 capability 時不回報通過`, `gate-capability-coverage` > `Requirement: proposal 與 spec 目錄雙向一致`

- [x] 2.1 `parseProposalCapabilities`：New＋Modified、清單＋表格、kebab-case、忽略 code fence、去重保序
- [x] 2.2 `checkCapabilityCoverage`：零 capability 失敗附 `reason`、新增 `orphan_spec_dirs`
- [x] 2.3 GREEN：gate-checker 51/51；全套件 10 支失敗，名單與 esmith-main 基線逐名相同

## 3. 驗證

**Covers**: `gate-capability-coverage` > `Requirement: 沒有 capability 時不回報通過`, `gate-capability-coverage` > `Requirement: proposal 與 spec 目錄雙向一致`

- [x] 3.1 以本 worktree 的 build 重跑 propose gates：vault 14 個 active spec-driven change 中 vault-recall-and-curation 轉為 structural 失敗（`capabilities without a spec dir: memory-backend-vault`），其餘 13 個不變；原空 change 已被補上內容、不再是零 capability，改用兩個改名 change 在補 Capabilities 段之前的歷史版本（vault `1764d5b5^`）驗證——新 CLI structural 失敗、reason 為 no capabilities、`orphan_spec_dirs` 列出 spec 目錄，舊 CLI 同一輸入 structural 通過（假通過重現）
- [x] 3.2 `openspec validate --strict` valid
