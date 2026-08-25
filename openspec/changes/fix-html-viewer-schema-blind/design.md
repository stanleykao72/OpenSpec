# Design: schema 驅動的 artifact 版面

## Context

`renderChangeHtml(options)` 收 `{changeDir, changeName, schema, ...}`。
`schema: SchemaYaml | null` 已用於 gate 宣告（`collectGateIdsForStation`），
但 artifact 讀取寫死三行字面值，側欄樹也寫死四個連結。

`SchemaYaml.artifacts[]` 的形狀（`src/core/artifact-graph/types.ts`）：
`{ id, generates, description, template, instruction?, requires[] }`。
`generates` 是相對路徑，已由 zod `relativePathSchema` 擋掉絕對路徑與 `..`。

## Decisions

### D1：清單來源是 `generates`，不是 id

`generates` 才是「這個 artifact 落在哪個檔名」的權威宣告——`openspec
instructions <id> --json` 回的 `resolvedOutputPath` 也是由它推導。用 id 猜檔名
（`analysis` → `analysis.md`）在 `odoo-bugfix` 立刻失效（id `fix` →
`fix-notes.md`）。

順序 = schema 宣告順序，不用檔案系統列舉順序。「確定性輸出」那條 requirement
要求同內容重跑 byte-identical；宣告順序是靜態的，`readdirSync` 不是。

### D2：渲染器派工，四條規則依序判定

| 條件 | 渲染器 | 理由 |
|------|--------|------|
| `generates` 含 `*` | capability sections（`readCapabilitySpecs`） | glob 一定是 `specs/**/*.md` 那類多檔展開，不是單檔 |
| `generates === schema.apply?.tracks` | tasks 進度渲染器（群組＋三欄表＋百分比） | **決定「這份有 checkbox」的是 `apply.tracks`，不是叫不叫 tasks** |
| `id === 'proposal'` | proposal 渲染器（Why 不收合、供 capability 顯示名解析） | 只有 proposal 有「Why 攤平」這個特殊待遇 |
| 其他 | 通用 `<details>` 分節渲染器（現行 design 那套） | analysis／backend-plan／issue／memo 都是「level-2 分節的散文」，與 design 同形 |

第二條為什麼不用 `id === 'tasks'`：`odoo-refactor` 的進度檔是
`backend-plan.md`（id `backend`）、`odoo-bugfix` 是 `fix-notes.md`（id `fix`）、
`odoo-trivial` 是 `memo.md`。照 id 比對，這三個 schema 的進度條全部消失，
而 `determineStation` 的 apply 判定也會跟著永遠判不到。

### D3：section id 由 artifact id 推導，spec-driven 的 id 必須原地不動

`data-review-key` 是評論層 localStorage 的持久化 key（既有 requirement
「區塊已審勾選」）。id 換掉 = 使用者存過的已審勾選與評論分域全部對不上。

artifact id 推導在 spec-driven 下天然得到 `proposal` / `tasks` / `design`
——與現行硬編碼字串相同。**加一條回歸斷言釘住這件事**，而不是靠「看起來一樣」。
gate 證據區塊的 `gate-evidence` id 不屬於 artifact，維持字面值。

### D4：「未產出」的作用域 = schema 宣告集

現行 requirement「個別檔案缺席時對應區塊 MUST 標『未產出』而非省略」是對的，
**但它的定義域是宣告集**。`odoo-refactor` 沒宣告 specs glob，就不該出現
「specs/ 未產出」——對沒宣告的東西標未產出，等於把同一顆 bug 換個方向再犯：
使用者一樣會讀成「這個 change 少做了東西」。

### D5：`schema === null` 時維持現行字面清單

schema 無法解析（`.openspec.yaml` 壞掉、schema 名不存在）時 `renderChangeHtml`
收到 `null`。此時退回 `proposal.md`／`specs` glob／`tasks.md`／`design.md` 的
字面清單，行為與今日完全一致。**這不是新的猜測**：`resolveSchemaSafely` 已經
在 `.openspec.yaml` 缺席、且檔名形狀夠像 spec-driven 時自動套預設 schema 並
標記 `schemaAutoDefaulted`；D5 只覆蓋「連預設都套不上」的殘餘路徑。

### D5b：`artifacts` 為空陣列比照 null

zod 要求 `artifacts` 至少一筆，所以走到「schema 有但清單空」代表它繞過驗證
（手工組的 schema、測試 double）。此時**退回預設清單而非渲染空白頁**——渲染
空白正是本 bug 換個入口再犯一次。實作時是測試 double（`artifacts: []`）先撞出
這條路徑的。

### D6：`determineStation` 的兩個輸入改為宣告驅動

- `hasProposal` → `hasAnyArtifact`（宣告集中任一檔存在）。原本非 spec-driven
  的 change 永遠停在 `explore` 站，因為它們沒有 `proposal.md`
- `tasksMd` → `tracksMd`（`apply.tracks` 指的那份檔的內容）

判定邏輯本身（archive → verify → apply → propose → explore 的保守序）不動。

## Risks / Trade-offs

- **glob 判定只看有沒有 `*`**：schema 若宣告 `reports/*.md` 這類非 capability
  的 glob，會被送進 capability 渲染器而顯示成空 specs。現存六個 odoo schema
  加 spec-driven 都只有 `specs/**/*.md` 一種 glob；等真有第二種再拆判定，
  不預先發明抽象
- **spec-driven 頁面的 Design 與 Tasks 對調**：宣告順序是 proposal → specs →
  design → tasks，舊硬編碼順序是 proposal → specs → tasks → design。改用宣告
  順序後 Design 卡片移到 Tasks 之前。區塊 id、錨點、評論分域全部不變，屬純
  版面順序異動；宣告順序同時也是工作流本身的順序（tasks 由 design 推導）
- **通用渲染器不認得結構**：analysis.md 若不是 level-2 分節，會走
  `renderMarkdownRaw` 的既有 fallback（原文照登，不吞內容）——與 design.md
  今天的行為相同，不是新風險

## Out of Scope

- 不改 `resolveSchemaSafely` 的解析策略（實測 `odoo-refactor` 解析正常，
  gate pill 顯示 `constitution` 為證）
- 不改 gate 區塊——它早就是 schema 驅動的
- 不回頭修既有的空白頁：那些是已落地的 HTML 檔，要重跑 `openspec html` 才會更新
