# Design: capability-coverage-new-and-modified

## D1：解析規則與 alignment-check 對齊，並以同一份向量鎖住

**Covers**: `gate-capability-coverage`

規則：`### New|Modified Capabilities`（不分大小寫）開段；任何 1–3 級標題結束該段（另一個 New/Modified 標題則直接接續）；條目為行首 `-`／`*` 清單或 `|` 表格列，名稱必須是反引號包住的 kebab-case；fenced code block 內的行不計；結果去重保序。

兩個 repo 語言不同（TypeScript／JavaScript），無法共用同一段程式碼。改以同一份 JSON 測試向量（含全形括號與冒號、表格、code fence、非 kebab 名稱等 13 例）同時驅動兩邊測試，任何一邊改了規則而另一邊沒改，就會有一邊測試失敗。

替代方案：保留「必須在 `## Capabilities` 之下」的限制——**不採用**，alignment-check 既有行為沒有這個限制，保留會讓兩邊繼續不一致。

## D2：零 capability 為失敗，並附原因

**Covers**: `gate-capability-coverage`

「沒有可檢查的東西」與「全部檢查通過」是不同事實，不能共用 `passed: true`。結果加上 `reason` 欄位（通過時為 `null`），讓讀結果的人不必自己推論。

## D3：反向檢查 spec 目錄

**Covers**: `gate-capability-coverage`

spec 目錄不在 proposal 清單內也是 proposal 與 specs 不一致。結果加上 `orphan_spec_dirs`，非空即失敗。原本的 `missing`（capability 缺 spec 目錄）不變。
