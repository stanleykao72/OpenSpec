## MODIFIED Requirements

### Requirement: artifacts 讀取與缺席處理

renderer SHALL 依 change 所宣告 schema 的 `artifacts[].generates` 決定要讀哪些
artifact，MUST NOT 寫死任一組檔名；讀取順序 SHALL 為 schema 的宣告順序。
`.gates/*.json` 與 `.openspec.yaml` 不屬於 artifact 宣告集，SHALL 照舊固定讀取。

宣告集中**個別檔案缺席時**對應區塊 MUST 標「未產出」而非省略；反之，schema
**未宣告**的 artifact MUST NOT 出現於版面（不出現區塊，也不出現「未產出」標記）
——對未宣告的東西標未產出，與漏讀已宣告的檔案一樣會被讀成「這個 change 沒做事」。

schema 無法解析（`renderChangeHtml` 收到 `null`）時 SHALL 退回
`proposal.md`／`specs/**/*.md`／`tasks.md`／`design.md` 的預設清單。
`.openspec.yaml` 缺席時依檔名形狀判斷渲染模式。非標準 markdown 結構 MUST 以原文
區塊呈現，MUST NOT 導致指令失敗。

區塊的 HTML id 與 `data-review-key` SHALL 由 artifact id 推導；spec-driven 的
`proposal`／`tasks`／`design` 三個 key MUST 維持不變，使既存的評論與已審勾選
不因本變更失效。

#### Scenario: 不完整 change
- **WHEN** change 只有 proposal.md 與 tasks.md
- **THEN** HTML 產出成功，design／specs／gate 區塊標「未產出」

#### Scenario: 非 spec-driven schema 的 artifact 被讀到
- **WHEN** change 宣告 `odoo-refactor`（artifacts＝analysis.md／backend-plan.md／frontend-plan.md／verify-report.md），且前三份實際存在
- **THEN** 三份的內容出現在輸出中，MUST NOT 因檔名不是 proposal／design／tasks 而落到「未產出」

#### Scenario: 未宣告的 artifact 不留痕
- **WHEN** change 宣告的 schema 沒有 specs glob
- **THEN** 輸出中 MUST NOT 出現 Specs 區塊或「specs/ 未產出」字樣

#### Scenario: schema 解析失敗時退回預設清單
- **WHEN** `renderChangeHtml` 收到 `schema: null`，change 目錄有 proposal.md／design.md／tasks.md
- **THEN** 三者照舊渲染，區塊 id 仍為 `proposal`／`design`／`tasks`

### Requirement: 頁面結構與 gate 誠實呈現

頁面 SHALL 含：生命週期路線圖（目前站保守推定）、capability › requirement ›
scenario 側欄樹（scrollspy、requirement 摘要表＋場景收合）、進度追蹤檔的群組計
進度（收合＋三欄表）、gate 紅綠燈。gate 組 MUST 依站別 × schema 決定（讀 schema
定義，不寫死清單）；gate 檔存在但 `total: 0`／`results: []` MUST 標「未實際執行」，
MUST NOT 給綠燈。

側欄樹的 artifact 連結 SHALL 由與主區塊相同的 schema 宣告集推導，MUST NOT 寫死
`Proposal`／`Tasks`／`Design` 四項；樹與主區塊的區塊集合 MUST 一致。

進度百分比所依據的檔案 SHALL 為 schema `apply.tracks` 所指的那份（未宣告時為
`tasks.md`），MUST NOT 以 artifact id 是否叫 `tasks` 判定；生命週期站別推定中的
「已進 apply」判據 SHALL 讀同一份檔。「已進 propose」判據 SHALL 為宣告集中任一
artifact 存在，MUST NOT 專指 `proposal.md` 存在。

#### Scenario: 未跑過的 gate
- **WHEN** `.gates/synthesis.json` 為 `total: 0`
- **THEN** 導讀列該站 gate 全部標 missing，摺疊區塊明寫「檔案存在但未實際執行」

#### Scenario: 進度檔不叫 tasks.md
- **WHEN** schema 宣告 `apply.tracks: backend-plan.md`，該檔含已勾選的 checkbox
- **THEN** 該區塊渲染為進度表，且路線圖推定為 `apply` 站

#### Scenario: 側欄樹跟著宣告集走
- **WHEN** change 宣告 `odoo-bugfix`（issue／fix／verified）
- **THEN** 側欄樹的 artifact 連結對應這三者，MUST NOT 出現 Proposal／Design 連結
