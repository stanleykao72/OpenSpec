## ADDED Requirements

### Requirement: capability 清單涵蓋 New 與 Modified

capability-coverage gate SHALL 把 proposal 中 `### New Capabilities` 與 `### Modified Capabilities` 兩段列出的 capability 都視為本 change 的 capability。條目 MUST 接受清單（`-`／`*`）與表格列兩種寫法，名稱為反引號包住的 kebab-case；名稱後接全形或半形標點都 MUST 能辨識；fenced code block 內的內容 MUST NOT 被計入。

#### Scenario: Modified 段的 capability 被計入
- **WHEN** proposal 只在 `### Modified Capabilities` 列出 `memory-backend-vault`（後接全形括號與冒號）
- **THEN** gate 結果的 capability 清單包含 `memory-backend-vault`

#### Scenario: code block 內的範例不被計入
- **WHEN** capability 段內有一個 fenced code block，內含看似 capability 的條目
- **THEN** 該條目不出現在 capability 清單中

#### Scenario: 與 alignment-check 解析結果一致
- **WHEN** 以共用測試向量檔的每一個 proposal 範例執行 gate
- **THEN** 解析出的 capability 清單與向量檔中的預期輸出完全相同

### Requirement: 沒有 capability 時不回報通過

capability-coverage gate 在解析出 0 個 capability 時 MUST 回報失敗，並 SHALL 在結果中說明原因；proposal.md 不存在時亦同。

#### Scenario: proposal 沒有 Capabilities 段
- **WHEN** proposal.md 沒有任何 New／Modified Capabilities 段
- **THEN** gate 回報失敗，結果附上「未解析出任何 capability」的原因

#### Scenario: 沒有 proposal.md
- **WHEN** change 目錄沒有 proposal.md
- **THEN** gate 回報失敗並附上原因

### Requirement: proposal 與 spec 目錄雙向一致

capability-coverage gate SHALL 在「proposal 列出的 capability 沒有對應 spec 目錄」或「spec 目錄沒有被 proposal 列出」任一情況下回報失敗，並 MUST 分別列出缺少的 capability 與未列出的 spec 目錄。

#### Scenario: capability 缺 spec 目錄
- **WHEN** proposal 列出 `data-export` 但沒有 `specs/data-export/`
- **THEN** gate 回報失敗，缺少清單包含 `data-export`

#### Scenario: spec 目錄未被 proposal 列出
- **WHEN** 存在 `specs/unlisted-cap/`，但 proposal 沒有列出 `unlisted-cap`
- **THEN** gate 回報失敗，未列出目錄清單包含 `unlisted-cap`

#### Scenario: 雙向一致時通過
- **WHEN** proposal 列出的 capability 與 spec 目錄完全一一對應
- **THEN** gate 回報通過，原因欄位為空
