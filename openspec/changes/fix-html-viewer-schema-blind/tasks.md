# Tasks

## 1. artifact 清單推導

- [x] 1.1 `artifactPlan(schema)`：由 `schema.artifacts[].generates` 產出有序
      `{id, file, kind}`；`kind` 依 D2 四條規則判定（glob / tracks / proposal / generic）
- [x] 1.2 `schema === null` 走字面 fallback 清單（proposal／specs glob／tasks／design）
- [x] 1.3 `renderChangeHtml` 改讀 plan，移除三行寫死的 `readArtifactSafely`

## 2. 版面渲染

- [x] 2.1 `renderShell` 依 plan 迴圈輸出區塊；未宣告的 artifact 不產生任何區塊
- [x] 2.2 通用 artifact 渲染器（level-2 分節收合，沿用 design 那套）
- [x] 2.3 `renderSidebar` 的 artifact 連結改由同一份 plan 推導
- [x] 2.4 區塊 id／`data-review-key` 由 artifact id 推導

## 3. 生命週期站別

- [x] 3.1 `determineStation` 的 `hasProposal` → `hasAnyArtifact`
- [x] 3.2 進度／apply 判據改讀 `apply.tracks` 指的檔（fallback `tasks.md`）

## 4. 測試

- [x] 4.1 fixture：非 spec-driven schema 的 change（odoo-refactor 形狀）
- [x] 4.2 斷言三份 artifact 內容出現、且不出現「未產出」
- [x] 4.3 斷言未宣告的 specs glob 不產生 Specs 區塊／「specs/ 未產出」
- [x] 4.4 **回歸釘子**：spec-driven 輸出的區塊 id 仍為 `proposal`／`tasks`／`design`
- [x] 4.5 斷言 `apply.tracks: backend-plan.md` 能得到進度表 + `apply` 站
- [x] 4.6 `schema: null` 路徑輸出與現行一致
- [x] 4.7 確定性測試（連兩次 byte-identical）仍通過

## 5. 驗證

- [x] 5.1 `pnpm test`：4553 pass／10 fail。**那 10 個是既有失敗**——把 `src`
      與 `test` 一起 stash 後跑同一組檔案，同樣 10 個失敗（upstream v1.10.0
      merge 帶進來的，集中在 view-store-resolution／config-profile／
      completion-tip／version-check 等，與 render 無關）。html 相關 62 個全過
- [x] 5.2 `pnpm build`（CLI 跑的是 dist，不 build 等於沒修）
- [x] 5.3 重跑重現指令：`openspec html migrate-invoice-project-field --artifact-body`
      的 grep 計數由 0 變正數
- [x] 5.4 `openspec validate fix-html-viewer-schema-blind --strict`
