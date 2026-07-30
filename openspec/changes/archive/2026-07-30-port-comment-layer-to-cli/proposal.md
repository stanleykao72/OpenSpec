# port-comment-layer-to-cli

Schema 判定記錄：openspec CLI renderer 工作（tooling），規則唯一命中 `spec-driven`，未開選單。

## Why

交付改走 `openspec html --artifact-body` + Artifact 發佈後（change `html-viewer-markdown-artifact-mode`），**選取即評論那一層消失了**——它只存在於 `/spec-html` skill 的骨架（`odoo-claude-code/deploy/templates/html/skeleton.html` 的評論層 BLOCK 段），CLI renderer 當初刻意沒移植。

而當初不移植的理由已經不成立。`html-template.ts` 的檔頭寫的是：評論層「依賴 `localStorage`／selection API，那只在互動式 Artifact 檢視器裡有意義，不適合 CLI 寫到磁碟的確定性檔案」。改走 `--artifact-body` 之後，**CLI 的產出正是發佈到那個互動式檢視器**——前提被自己的後續 change 推翻了。

結果是使用者要嘛拿到「好讀但不能評論」的 CLI viewer，要嘛回頭走 skill（燒 token、非確定性）。兩條路徑都缺一半。

## What Changes

- **把評論層移植進 CLI renderer**：選取即評論、註記標記、Notes 面板、每區塊「已審」勾選、匯出 Markdown。三段構件（CSS／HTML／獨立 IIFE script）皆為常數，確定性不受影響。
- **分域改用 `data-change-name`，不再解析 `<title>`**：skill 版從 `document.title` 的 `<change-name> · spec-viewer` marker 取 change 名當 `localStorage` key 分域，marker 缺席就強制 in-memory（避免多頁共用一把 key 互相污染）。**片段模式沒有 `<head>`／`<title>`**，且 CLI 在渲染時本來就知道 change 名 → 直接輸出在內容根元素的 `data-change-name` 上，比解析標題更可靠也少一條失效路徑。
- **兩種輸出模式皆含**：沿用「單一內容產生器」原則，不讓兩模式功能分岔。`file://` 下 `localStorage` 可能不可用 → 走既有的 in-memory 降級並在面板明示「本次評論不會保存」。
- **可分離性維持**：移除三段構件 MUST NOT 影響既有導覽（側欄樹／scrollspy／收合）——skill 骨架的既有約束一併帶過來，且評論層 script 維持獨立 IIFE，不與導覽 script 共用任何變數或函式。
- **跳脫**：評論文字是使用者輸入，寫回 DOM 與匯出 Markdown 時各自依 sink 決定跳脫方式（沿用 conventions.md「跳脫慣例延伸：評論層依 sink 各自決定」一節的規則）。

不做（明確排除）：
- **不做免貼上的評論回讀**（把 notes 自動送回 Claude）。那是 vault TODO **T-183** 在處理的題目，需要 capability 側配合，與本 change 的呈現層無關。匯出維持 clipboard ＋ modal fallback。
- 不做跨裝置／跨瀏覽器同步（`localStorage` 綁 origin，是既有設計的已知邊界）。
- 不改 `/spec-html` skill 那條路徑（兩邊各自維護，見 design Decision 2 的 sync discipline）。
- 不改 markdown 渲染、輸出模式、落點政策。

## Capabilities

### New Capabilities
（無）全部落在既有 `html-viewer-command` 內。

### Modified Capabilities
- `html-viewer-command`: 新增 4 條需求——
  - ADDED `選取即評論與註記標記`
  - ADDED `Notes 面板與持久化分域`
  - ADDED `區塊已審勾選`
  - ADDED `評論匯出`

  Canonical spec 目前**未**提及評論層（它只寫在 `html-template.ts` 的檔頭註解裡），故無 MODIFIED 需求；該註解要在實作時同步改寫，不然會留下一句與 spec 相反的話。

## Impact

**程式碼**
- 新檔 `src/core/render/comment-layer.ts`（CSS／HTML／script 三段常數，與 `html-template.ts` 同層級的呈現構件）
- `src/core/render/html.ts`（在內容根元素輸出 `data-change-name`；插入評論層三段）
- `src/core/render/html-template.ts`（改寫檔頭那段「評論層是 Non-Goal」的註解）
- 測試：評論層構件的結構測試、確定性、可分離性（移除後導覽仍運作）、評論文字注入的對抗性測試

**體積**
- skeleton.html 的評論層三段約 **1,200+ 行**（CSS + HTML + IIFE），產出檔會明顯變大（目前片段約 68KB）。純文字、無外部資源，`.reports/` 不入版控，可接受。

**不影響**
- 既有導覽、markdown 渲染、兩模式輸出契約、確定性保證。
- `/spec-html` skill 與其評論層。
