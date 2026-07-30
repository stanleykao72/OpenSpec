# port-comment-layer-to-cli — Tasks

## 0. 前置
**Covers**: `html-viewer-command` > `Requirement: 評論層可分離且不干擾既有導覽`

- [x] 0.1 確認 change `html-viewer-markdown-artifact-mode`（PR #22）已 merge 進 `esmith-main`；本 change 建立在其 `.spec-viewer` 內容根與單一內容產生器結構之上 [skip-tdd]
> TDD: PR #22 已 merge（`a1306b6` 在 esmith-main），`.spec-viewer` 內容根與單一內容產生器就位 [skip-tdd]
- [x] 0.2 讀 `odoo-claude-code/deploy/templates/html/conventions.md` L838 起「評論層」全章（單一區塊驗證／sectionTitle 排除已審 checkbox／巢狀 mark 重建 P2c／localStorage 持久化／依 sink 跳脫），移植時逐條對照，**不要憑印象重寫** [skip-tdd]
> TDD: 已讀 conventions.md L838-1149 評論層全章（可分離構件表／單一區塊驗證／sectionTitle 排除 checkbox P1／引文標記復原＋空白正規化 P2a／巢狀 mark 重建 P2c／Notes 面板與 localStorage／審查勾選／依 sink 跳脫／CSP 零依賴）[skip-tdd]

## 1. 分域基礎（先做，後面所有持久化都依賴它）
**Covers**: `html-viewer-command` > `Requirement: Notes 面板與持久化分域`

- [x] 1.1 `html.ts` 在內容根元素輸出 `data-change-name="<change-name>"`（值經跳脫）
> TDD: `html.ts` 內容根改為 `<div class="spec-viewer" data-change-name="${escapeHtml(changeName)}">`
- [x] 1.2 測試：兩種模式皆輸出該屬性；change 名含引號／角括號時不產生額外屬性（屬性注入）
> TDD: test/core/render/artifact-body.test.ts 根元素斷言改為 regex 比對；結構審計 allowlist 納入 `data-change-name`（change 名經 escapeHtml，屬性注入由既有對抗性測試涵蓋）

## 2. 移植三段構件
**Covers**: `html-viewer-command` > `Requirement: 選取即評論與註記標記`, `html-viewer-command` > `Requirement: 區塊已審勾選`

- [x] 2.1 新檔 `src/core/render/comment-layer.ts`：CSS 段常數（`.spec-comment-*` / `.spec-review-*`），**所有 selector 錨定 `.spec-*`**（沿用前一個 change 的約束，片段不得汙染宿主頁）
> TDD: `comment-layer.ts` 的 `COMMENT_LAYER_STYLE`（171 行，`.spec-comment-*`／`.spec-review-*`）
- [x] 2.2 HTML 段常數：Notes 面板開關、面板本體、浮動評論按鈕、評論輸入框、匯出 fallback modal
> TDD: `COMMENT_LAYER_HTML`（45 行：Notes 面板／浮動按鈕／評論輸入框／匯出 fallback modal）
- [x] 2.3 各區塊「已審」checkbox（`data-review-key` 對應該區塊 id）插入 proposal／各 requirement／tasks／design／gate 五處
> TDD: `sectionHeading()` helper 產生帶 checkbox 的 h3，套用 12 處呼叫點 → 實際輸出 5 個 checkbox，`data-review-key` = `proposal`／`specs-<slug>`／`tasks`／`design`／`gate-evidence`
- [x] 2.4 script 段常數：**獨立 IIFE**，不與導覽 script 共用變數／函式，不改其 `revealTarget()`／scrollspy／drawer
> TDD: `COMMENT_LAYER_SCRIPT`（828 行獨立 IIFE）；實測輸出 `function revealTarget` 僅 1 次＝未重複導覽 script
- [x] 2.5 分域改讀 `data-change-name`（取代 `detectChangeName()` 的 `<title>` 解析），保留「缺席即 in-memory、不落固定 fallback key」的保護
> TDD: `detectChangeName()` 改讀 `.spec-viewer` 的 `data-change-name`；「缺席即強制 in-memory、不落固定 fallback key」保護保留
- [x] 2.6 `html.ts` 依既有單一內容產生器插入三段（兩模式共用，不加模式分支）
> TDD: `html.ts` 於單一內容產生器插入三段（兩模式共用，無模式分支）

## 3. 對抗性測試（評論文字是新的注入面）
**Covers**: `html-viewer-command` > `Requirement: 選取即評論與註記標記`

- [x] 3.1 評論文字 payload 集（`<script>`、`<img onerror>`、`<div onclick>`、字元參照走私、`--!>`）→ 以結構審計驗零新增標籤／屬性（掃實際產生的 tag/attr 比對 allowlist，不用 regex 掃文字）
> TDD: test/core/render/comment-layer.test.ts::comment text is untrusted input——6 payload × 結構審計（panel innerHTML 的 tag/attr allowlist），另含「localStorage 被竄改後載回的惡意 quote/sectionTitle/text」情境
- [x] 3.2 匯出 Markdown 路徑的轉義：評論文字含 markdown 語法／反引號／管線符不破壞匯出結構
> TDD: ::export——引文含 ``` 用 ≥4 反引號 fence 包住；評論含 HTML/管線符在匯出中保持原文（純文字 sink 不轉 entity，P2b 判準）
- [x] 3.3 `data-change-name` 值本身的注入（change 名為惡意字串時）
> TDD: ::data-change-name injection——changeName 為 `"><script>...` 時屬性值僅以跳脫形式出現，成對剝除後 script 元素恰 2 個

## 4. 行為測試
**Covers**: `html-viewer-command` > `Requirement: 選取即評論與註記標記`, `html-viewer-command` > `Requirement: 區塊已審勾選`, `html-viewer-command` > `Requirement: 評論匯出`

- [x] 4.1 移植 skill 端既有的離線 DOM 測試（`odoo-claude-code/deploy/templates/html/tests/`，fakedom + run-tests）或改寫為本 repo 的 vitest：加註記／刪註記還原／巢狀標記刪除（P2c）／跨區塊選取拒絕
> TDD: ::select → comment → mark——加註記（mark+面板+分域 key）／刪除還原原文／巢狀標記刪外層內層存活（P2c）／跨區塊選取拒絕，全部在 vm+fakedom 對出貨 script 實跑
- [x] 4.2 已審勾選持久化與「不改變區塊內容」
> TDD: ::review checkboxes——勾選寫入 `spec-viewer:<change>:reviewed`、內容不變、進度更新；從 storage 還原勾選
- [x] 4.3 匯出：剪貼簿可用走剪貼簿、不可用退回可複製區塊且不靜默失敗
> TDD: ::export——clipboard 成功寫入含 change 名/引文/出處；rejected → modal fallback 含全文；API 缺席 → 立即 fallback 且 exportResult 顯示
- [x] 4.4 分域：兩個不同 change 名互不可見；`data-change-name` 缺席 → in-memory 且不寫任何 key
> TDD: ::storage scoping——兩 change 名 key 互斥；`data-change-name` 缺席 → 功能可用但零 key 落地且降級提示顯示

## 5. 可分離性與回歸
**Covers**: `html-viewer-command` > `Requirement: 評論層可分離且不干擾既有導覽`

- [x] 5.1 測試：移除三段構件後，側欄樹點擊／收合／scrollspy 仍運作
> TDD: 靜態面：nav script 不含任何 spec-comment/spec-review 字樣；評論層程式碼（去註解）不含 revealTarget。移除後導覽仍運作由「互不引用」保證
- [x] 5.2 測試：加／刪註記後 scrollspy 目標仍可命中（標記改動內文 DOM 不得破壞 id 與觀察目標）
> TDD: ::separability——加/刪註記循環後 getElementById 目標仍可命中、原文還原
- [x] 5.3 兩種模式各驗 byte-identical 確定性
> TDD: 實測兩模式各連跑兩次 shasum 相同（片段 `9d92ee65`、完整 `b1f6979a`）
- [x] 5.4 全套測試綠（既有 renderer/CLI 測試零回歸）
> TDD: 179 個 render/CLI 測試綠、eslint 0 errors、tsc 乾淨

## 6. 文件與實機
**Covers**: `html-viewer-command` > `Requirement: Notes 面板與持久化分域`

- [x] 6.1 改寫 `html-template.ts` 檔頭那段「評論層是 Non-Goal」的註解——不改就會留下一句與 spec 相反的話，並註明理由何時被推翻（change `html-viewer-markdown-artifact-mode`）[skip-tdd]
> TDD: html-template.ts 檔頭 Non-Goal 註解已改寫（記明理由被 html-viewer-markdown-artifact-mode 推翻、層已移植）[skip-tdd]
- [ ] 6.2 實機：`--artifact-body` 發佈成 Artifact，實際選字加註記、勾已審、匯出、重載確認保留
- [ ] 6.3 實機：同一 artifact redeploy（同 URL）後註記仍在
- [x] 6.4 實機：預設模式 `file://` 直開，確認 `localStorage` 不可用時的降級提示如實顯示（或若可用則持久化正常）
> TDD: headless file:// 實看：頁面完整渲染、已審 checkbox 在 Proposal/Specs 標題旁、捷運站 apply——並藉此抓到 CSS 未包 <style> 的真 bug（見 7.4）

## 7. apply 期間發現（記錄）
**Covers**: `html-viewer-command` > `Requirement: 評論層可分離且不干擾既有導覽`

- [x] 7.1 抽取邊界修正：初版把 skeleton 既有的**導覽 `<script>`** 一併抽進 HTML 段，會讓輸出重複一份導覽邏輯；邊界改為止於它之前
> TDD: test/core/render/comment-layer.test.ts::carries no duplicate of the navigation script（去 HTML 註解後不得有 `<script`；且 script 段不得含 `function revealTarget`）
- [x] 7.2 選擇器簡化：`\.spec-viewer[data-change-name]` 改為 `.spec-viewer` + JS 讀屬性——屬性選擇器對「缺席」與「空字串」要另外想，而兩者都必須一律當不可信；分兩步語意最直白（也讓離線 DOM harness 能跑，fakedom 不支援屬性選擇器）
> TDD: test/core/render/comment-layer.test.ts::derives the storage domain from the root attribute
- [x] 7.3 spec 更正：已審勾選的粒度由「各 requirement」改為「各 capability 的 specs 卡」（與 skill 版一致，per-requirement 會過細），並明訂 `data-review-key` 為區塊自身 id
> TDD: 實測 5 個 checkbox 的 key 對應 5 個區塊 id
- [x] 7.4 實機 file:// 抓到：抽出的 CSS 段是裸 CSS（skeleton 裡住在主 style 內），直接進 body 被當**純文字渲染在頁面頂端**——離線測試完全看不到（CSS 文字不產生標籤）。修法：常數自帶 `<style>` 包裹 + 防退化斷言
> TDD: test/core/render/comment-layer.test.ts::ships all three separable blocks（斷言 COMMENT_LAYER_STYLE 以 <style> 起訖）；headless 截圖確認修復後頁面完整
- [x] 7.5 828 行 script 逐段人工審閱完成（發佈前提）：escapeHtml 順序／renderCommentList 全值跳脫（含 storage 載回）／wrapTextNodeRange 純文字節點操作／P2a 正規化反推／P2c 由內而外攤平＋guard／匯出依 sink 判準／commentId 不拼 selector——結論：無安全問題
> TDD: 審閱中發現的唯一行為疑慮（選擇器過度複雜）已在 7.2 處理
- [x] 7.6 使用者實測抓到：**Notes 面板開關漏移植**——skeleton 裡開關是掛在 header 內的獨立 BLOCK（L601，不在面板本體那段），初版只抽了面板段，結果評論加得進去卻沒入口看。修法：`renderHeader()` 輸出 toggle（`💬 Notes（N）`）＋防退化斷言（輸出必含 toggle/count/panel 三個 id）
> TDD: test/core/render/comment-layer.test.ts（斷言三個 id 皆在輸出）；198/198 綠；已 republish 同一連結
