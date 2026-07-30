# html-viewer-command Delta Spec

## ADDED Requirements

### Requirement: 選取即評論與註記標記

viewer MUST 支援對內文選取文字後加註記：選取後出現評論入口，送出後該段文字 MUST 以可見標記呈現，並可從標記或 Notes 面板刪除該註記。評論文字為使用者輸入，寫入 DOM 與匯出時 MUST 依各自的 sink 跳脫（DOM 走文字節點或 HTML entity 跳脫，Markdown 匯出走 Markdown 轉義），MUST NOT 讓評論內容成為標記。刪除註記後被標記文字 MUST 還原為原樣（含巢狀標記的情形）。

#### Scenario: 選取後加註記
- **WHEN** 使用者在需求或設計內文選取一段文字並送出評論
- **THEN** 該段文字出現可見標記，且該註記出現在 Notes 面板

#### Scenario: 註記可刪除且還原原文
- **WHEN** 使用者刪除一則註記
- **THEN** 標記移除、原文還原，其餘註記與標記不受影響

#### Scenario: 評論內容不得成為標記
- **WHEN** 評論文字為 `<img src=x onerror=alert(1)>`
- **THEN** 畫面以文字顯示該內容，DOM 中不存在新增的 `img` 或事件處理屬性

#### Scenario: 選取跨越區塊
- **WHEN** 選取範圍跨越兩個不同區塊
- **THEN** 拒絕建立註記並說明僅支援單一區塊內選取，不產生半套標記

### Requirement: Notes 面板與持久化分域

viewer MUST 提供可開關的 Notes 面板，列出目前所有註記與已審狀態。持久化 MUST 以 `localStorage` 進行，且 key MUST 依 change 名分域；change 名 MUST 取自渲染時輸出在內容根元素的 `data-change-name` 屬性，MUST NOT 依賴 `document.title`（artifact 片段模式無 `<head>`／`<title>`，且 renderer 在渲染時已知 change 名）。`data-change-name` 缺席或為空、或 `localStorage` 不可用時，MUST 降級為 in-memory 並在面板明示「本次評論不會保存」，MUST NOT 落地到任何共用的固定 key。

#### Scenario: 依 change 分域
- **WHEN** 兩個不同 change 的 viewer 在同一瀏覽器開啟並各自加註記
- **THEN** 兩者的註記互不可見、互不覆蓋

#### Scenario: 重新載入後保留
- **WHEN** 加註記後重新載入同一個 viewer（同一 URL、同一 change 名）
- **THEN** 註記與已審勾選仍在

#### Scenario: 無法持久化時明示
- **WHEN** `localStorage` 不可用（隱私模式、`file://` 受限環境）或 `data-change-name` 缺席
- **THEN** 功能仍可用但僅存於記憶體，面板頂端明示不會保存，且不寫入任何 `localStorage` key

### Requirement: 區塊已審勾選

每個主要區塊（proposal / 各 capability 的 specs 卡 / tasks / design / gate 證據）MUST 提供「已審」勾選，`data-review-key` MUST 為該區塊自身的 id，狀態 MUST 與註記同一分域規則持久化。勾選 MUST NOT 改變或隱藏該區塊的內容。

#### Scenario: 勾選後持久化
- **WHEN** 勾選某區塊「已審」並重新載入
- **THEN** 該勾選仍保持

#### Scenario: 勾選不影響內容
- **WHEN** 勾選任一區塊
- **THEN** 該區塊的文字、表格、收合狀態均不改變

### Requirement: 評論匯出

viewer MUST 提供把全部註記與已審狀態匯出為 Markdown 的動作，內容 MUST 含 change 名、被註記的原文片段與註記文字，供貼回對話使用。匯出 MUST 優先寫入剪貼簿；剪貼簿不可用時 MUST 退回可全選複製的顯示區塊，MUST NOT 靜默失敗。

#### Scenario: 匯出到剪貼簿
- **WHEN** 使用者按下匯出且剪貼簿可用
- **THEN** Markdown 進入剪貼簿並顯示成功提示

#### Scenario: 剪貼簿不可用時的退路
- **WHEN** 剪貼簿 API 不可用或被拒
- **THEN** 顯示可全選複製的 Markdown 區塊，並說明為何退回此路徑

### Requirement: 評論層可分離且不干擾既有導覽

評論層 MUST 為可分離構件：其 CSS／HTML／script 三段被移除後，既有導覽（側欄樹、scrollspy、收合、抽屜）MUST 仍完全運作。評論層 script MUST 為獨立 IIFE，MUST NOT 與導覽 script 共用變數或函式、MUST NOT 修改其 `revealTarget()`／scrollspy／drawer 邏輯。兩種輸出模式（完整文件／artifact 片段）MUST 皆包含評論層，且其存在 MUST NOT 破壞既有的位元級確定性（構件為常數）。

#### Scenario: 移除評論層後導覽仍運作
- **WHEN** 從產出中移除評論層三段
- **THEN** 側欄樹點擊、收合展開、scrollspy 高亮皆正常

#### Scenario: 確定性不變
- **WHEN** 對同一 fixture change 以同一模式連跑兩次
- **THEN** 兩次輸出 byte-identical
