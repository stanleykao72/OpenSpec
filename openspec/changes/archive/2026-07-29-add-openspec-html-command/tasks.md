# Tasks: add-openspec-html-command

> 執行記錄（1.1–3.3）：`pnpm build` 與 `pnpm test` 全綠（122 test files / 2182 tests，含本 change 新增的 3 個 renderer 測試檔 + 1 個 command 測試檔，共 75 個新測試）。3.4 已於主 session 實機驗收完成並勾選（見 3.4 與第 6 節）。

## 1. Renderer 核心

**Covers**: `html-viewer-command`

- [x] 1.1 `src/core/render/html-template.ts`：移植 design token 與骨架（CSS/區塊結構/內建 JS——drawer/scrollspy/revealTarget 逐字移植）
  - 證據：CSS 變數/class 與 skeleton.html 對應（雙主題色票、gate 紅綠燈、side-tree tier、progress、task-table、`[hidden]{display:none!important}` 全域防護皆保留）；評論層三段 BLOCK 依 Non-Goal 不移植；nav script 含 `revealTarget()`/drawer toggle/`IntersectionObserver` scrollspy，逐字移植邏輯。
  > TDD: test/core/render/html-template.test.ts → GREEN ✓ (5/5)

- [x] 1.2 `src/core/render/html.ts`：artifacts 結構 → HTML 合成（跳脫無例外、id 淨化、缺席標未產出、非標準內容原文跳脫）
  - 證據：`escapeHtml`/`sanitizeId` 全面套用於動態內容；proposal/design/tasks/specs/.gates 個別缺席時render `spec-missing` 區塊；非標準 markdown 走 `splitMermaidSegments` 落入 `<pre class="spec-raw">`。
  > TDD: test/core/render/html.test.ts → GREEN ✓ (32/32，含 complete/incomplete/adversarial 三組 fixture)

- [x] 1.3 markdown 最小 parser（重用 `src/core/parsers/` 既有能力）：Requirement/Scenario、checkbox、標題層級、mermaid fence
  - 證據：`src/core/render/html-parser.ts` 重用既有 `src/core/parsers/requirement-blocks.ts` 的 `parseDeltaSpec`/`RequirementBlock`（未重寫 delta block 解析），新增 WHEN/THEN scenario 解析、tasks 群組 checkbox 解析、mermaid fence 切割、level-2 section 切割。
  > TDD: test/core/render/html-parser.test.ts → GREEN ✓ (25/25)

- [x] 1.4 gate 呈現：讀 schema 的 propose/verify gates、站別推定、`total: 0` → 未實際執行
  - 證據：`determineStation`/`collectGateIdsForStation`/`computeGateStatuses`（讀 `schema.propose.gates`／`schema.verify.gates`，站別依 archive 路徑／post-apply evidence／tasks 勾選／proposal 存在保守推定）；`total:0`／`results:[]` 一律 missing 並在 gate 證據區塊標「檔案存在但未實際執行」，不給綠燈。對本 change 自身 `.gates/synthesis-propose.json`（total:0）實跑驗證：見 2.2 證據。
  > TDD: test/core/render/html.test.ts（`determineStation`/`collectGateIdsForStation`/`computeGateStatuses` 三個 describe 區塊）→ GREEN ✓

- [x] 1.5 側欄樹＋requirement 摘要表＋群組進度（skill 版語意對齊）
  - 證據：側欄 capability→requirement→scenario 三層樹（tier 標籤＋顯示名優先序：proposal Capabilities 描述 → spec 首標題 → slug fallback）；requirement 摘要表（SHALL/MUST pill＋場景數，href/data-target/id 三處一致）；tasks 群組進度以「完成群組數／群組總數」為主進度，不用任務總數。
  > TDD: test/core/render/html.test.ts（id 一致性、pill、`1 / 2 群組完成（50%）`等斷言）→ GREEN ✓

## 2. 指令

**Covers**: `html-viewer-command`

- [x] 2.1 `src/commands/html.ts`：參數解析（basename 驗證、近似候選）、`--out`／`--open`、exit code
  - 證據：`rejectDangerousInput`（拒 `/`、`\`、`..`，不觸碰檔案系統，測試以 spy 驗證 `fs.promises.readdir` 從未被呼叫）；`resolveChangeName` 經 `getAvailableChanges` 目錄列舉比對（非組路徑試讀），找不到用 `nearestMatches` 給近似候選；`--out`/`--open`（注入式 `SpawnFn` 供測試攔截，不實際開瀏覽器）。
  > TDD: test/commands/html.test.ts → GREEN ✓ (13/13)

- [x] 2.2 `src/cli/index.ts` 註冊 `openspec html`
  - 證據：`program.command('html <change-name>')` + `--open`/`--out`；同步在 `src/core/completions/command-registry.ts` 補上對應 completion entry（否則 `command-registry.test.ts` 的視覺化 parity 測試會失敗——已驗證修正前失敗、修正後通過）。`pnpm build` 成功；對本 change 自身實跑：`node bin/openspec.js html add-openspec-html-command --out /tmp/spec-viewer-preview.html` → exit 0，輸出 792 行 HTML，人工檢視確認：無 DOCTYPE/html/head/body 包殼字面、gate 證據區塊誠實標「未實際執行」（對應本 change 自身 total:0 的 `synthesis-propose.json`）、側欄五個 requirement／對應 scenario 皆正確列出。
  > TDD: test/core/completions/command-registry.test.ts → GREEN ✓；手動驗證見上

## 3. 測試與驗收

**Covers**: `html-viewer-command`

- [x] 3.1 fixture change（完整＋不完整各一）＋ renderer 單元測試（vitest）
  - 證據：`test/fixtures/html-changes/{complete-change,incomplete-change,adversarial-change}`（第三組供 3.3 對抗性測試重用）；`test/core/render/html.test.ts` 分三個 describe 區塊涵蓋完整/不完整/對抗性三種 fixture。
  > TDD: test/core/render/html.test.ts → GREEN ✓ (32/32)

- [x] 3.2 確定性測試：連續兩次產出 byte-identical
  - 證據：`renderChangeHtml — determinism` describe 區塊：同一 fixture 連續兩次 render 以 `toBe`（非 `toEqual`）比對整份輸出字串完全相等；另一測試確認輸出內僅含 fixture 原文自帶的兩個已知時間戳，未被 renderer 額外注入新時間戳。
  > TDD: test/core/render/html.test.ts::"renderChangeHtml — determinism" → GREEN ✓ (2/2)

- [x] 3.3 對抗性測試：`<script>`／`<img onerror>` 僅以跳脫文字出現；零外部引用；無包殼字面
  - 證據：`test/fixtures/html-changes/adversarial-change`（proposal.md 含字面 `<script>alert(1)</script>`、spec.md scenario 含字面 `<img onerror=alert(1)>`、gate JSON 含 `<script>alert(2)</script>` payload）；`test/core/render/html.test.ts::"renderChangeHtml — adversarial fixture"` 斷言三處皆僅以 `&lt;...&gt;` 跳脫文字出現、輸出中所有 `<`/`</` 開頭的 tag 名稱都落在渲染器實際會產出的已知標籤白名單內（無新增可執行節點）、零 `<link>`/`@import`/外部 `src=`。
  > TDD: test/core/render/html.test.ts::"renderChangeHtml — adversarial fixture" → GREEN ✓ (5/5)

- [x] 3.4 對真實 change（odoo-claude-code archive 內任一）實跑驗收，瀏覽器開啟目視（`openspec html 2026-07-29-add-spec-html-skill` 於 odoo-claude-code workspace：exit 0、1300 行、無包殼、捷運線 archive 站正確、`--open` 實測開啟預設瀏覽器）
> TDD: [skip-tdd] 實機驗收

## 4. Review-fix 輪

**Covers**: `html-viewer-command`

> 上輪 triple-review FAIL（P1×4／P2×4）。本輪只修不重寫；`pnpm build` ＋ `pnpm test` 全綠（122 test files / 2201 tests，較上輪 +19 個新增測試：`test/commands/html.test.ts` 13→23、`test/core/render/html.test.ts` 32→41）。`pnpm lint` 0 error（僅 1 個與本 change 無關的既有 warning）。

- [x] 4.1 P1a — gate JSON 衍生值 XSS＋`isSynthesisShape` 形狀強化
  - 證據：`src/core/render/html.ts` `renderGateEvidenceBadge` 的 `passedCount`／`file.data.total` 一律 `escapeHtml(String(x))` 才插入 HTML（原本裸插）；`isSynthesisShape` 新增 `isSynthesisResultEntry` 逐筆驗 `{id:string,passed:boolean}` 形狀（`ai_review_needed` 若存在需為 boolean），任一 entry 不合法則整份 JSON 降級為「未識別形狀」（只進原文證據區塊，不參與 gate 狀態計算），`passed` 欄位若存在也驗證為 number。
  > TDD: `test/core/render/html.test.ts`「renderChangeHtml — gate JSON derived values are escaped (P1a)」→ GREEN ✓；既有 32 個 fixture 測試（含 adversarial）不受影響仍 GREEN。

- [x] 4.2 P1b — 偽造/矛盾 synthesis JSON 不得產生綠燈
  - 證據：新增 `classifySynthesisTrust`（`ok`／`empty`／`inconsistent` 三態）：`total:0` 但 `results` 非空、或 `total` 與 `results.length` 不符一律判為 `inconsistent`，整檔視為不可信——`computeGateStatuses` 對此類檔案 `continue`，絕不把其中的 `results` 灌進 `byId`；`ComputeGateStatusesResult` 新增 `inconsistentSynthesisFiles`，證據區塊對應顯示「證據不一致」（與合法未執行的「檔案存在但未實際執行」訊息區分）。
  > TDD: `computeGateStatuses`「treats total:0-with-non-empty-results as untrustworthy...」＋「treats a total/results.length mismatch...」→ GREEN ✓；`renderChangeHtml`「renderChangeHtml — inconsistent synthesis evidence is never green (P1b)」→ GREEN ✓（斷言無 `spec-gate pass`、含「證據不一致」、宣告的 gate 仍標「未產出」）。

- [x] 4.3 P1c — symlink TOCTOU 防護（change 目錄＋輸出落點）
  - 證據：`src/commands/html.ts` 新增匯出的 `resolveWithinContainer(candidatePath, containerPath, label)`：兩端各自 `fs.realpathSync` 後以 path-segment 邊界比對（`real === container || real.startsWith(container + path.sep)`，非字串前綴，`changes-evil` 不會誤過 `changes` 邊界檢查），失敗丟 `HtmlCommandError`。`execute()` 在任何讀檔前先對 `changeDir` 呼叫此檢查；輸出落點（預設路徑）在 `mkdirSync` 之後、`writeFileSync` 之前同樣檢查；顯式 `--out` 僅 `realpathSync` 解析（不做 changesDir 邊界比對，因為是使用者自選逃生口）。回傳值／實際讀寫沿用原始（未 realpath 替換）路徑，避免 macOS `/var` → `/private/var` 之類的 realpath 差異打斷既有「回傳路徑與 `path.join(changeDir,...)` 完全相等」的測試斷言。
  > TDD: `resolveWithinContainer (P1c symlink TOCTOU boundary check)` 4 個測試（合法子目錄放行、symlink 出界拒絕、`changes-evil` 字串前綴不誤放行、candidate 不存在時拋 `HtmlCommandError` 而非原始 fs 例外）→ GREEN ✓；`HtmlCommand`「symlink escape rejection (end-to-end)」端對端測試（`evil-link` 指向 changesDir 外）→ GREEN ✓（`getAvailableChanges` 的 Dirent 過濾＋本檢查雙重防護，皆導致 reject）。

- [x] 4.4 P2a — `rejectDangerousInput` 改用既有 allowlist；`openPath` Windows 分支改安全形式
  - 證據：`rejectDangerousInput` 改呼叫 `src/utils/change-utils.ts` 的 `validateChangeName()`（`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`），取代原本的字串 denylist（只擋 `/`、`\`、`..`，漏掉 `;`、`$()`、`&`、`|` 等 shell metacharacter）；`openPath` 的 win32 分支不再 `spawn('cmd', ['/c','start','""',filePath])`，改 `spawn('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Process -FilePath $args[0]', filePath])`——路徑以 `$args[0]` 綁定而非字串內插進 `-Command` 腳本文字，且 `powershell.exe` 本身不是 `cmd.exe`/`.bat` 那類受 Node 舊有 argv→command-line 重組瑕疵影響的目標；預設輸出路徑又恆為 allowlist 通過的 change 名稱＋字面 `spec-viewer.html`，雙重保險。
  > TDD: `dangerous input rejection`「rejects a name containing shell metacharacters not covered by the old denylist」＋「rejects a non-kebab-case name (uppercase)」→ GREEN ✓；`openPath`「routes through powershell.exe Start-Process on win32...」→ GREEN ✓（斷言 command 為 `powershell.exe`、路徑是獨立最後一個 argv 元素、未被內插進其他字串）。

- [x] 4.5 P2b — `openPath` 掛 spawn `error` listener
  - 證據：`spawn()` 對啟動失敗（如 launcher 不存在）是非同步 `'error'` event 而非同步 throw；未掛 listener 會是 unhandled error 讓整個 process crash。`openPath` 現在對回傳的 child 呼叫 `child?.on?.('error', ...)`（optional chaining 容忍測試替身缺 `.on`），swallow 並印警告（`console.warn`），維持「檔案已寫入、開啟失敗不致命」語意；同步 throw 分支（catch）訊息格式同步統一。
  > TDD: `async spawn error handling (P2b)`「registers an error listener...swallows a later async error without throwing」＋「does not throw when the returned child has no .on method at all」→ GREEN ✓。

- [x] 4.6 P2c — 非 delta spec.md 不得靜默丟內容
  - 證據：`renderCapabilitySection` 新增分支：`cap.requirements.length === 0`（且 `rawMarkdown` 非 null）時，改用既有 `renderMarkdownRaw` 呈現整份跳脫後原文（比照 proposal/design 對非標準內容的處理），並標「未解析出標準 Requirement 區塊，以下為原始內容」，取代原本的空表格（內容被靜默丟棄）。`parseSpecRequirements` 本身維持回傳 `[]` 的既有契約（純解析函式不變），修正點在渲染層的呼叫端行為。
  > TDD: `renderChangeHtml — non-delta spec.md falls back to raw content (P2c)`→ GREEN ✓（斷言原文字句與「未解析出標準 Requirement 區塊」皆出現）。

- [x] 4.7 P2d — `specs/<cap>/` 缺 spec.md 不得靜默略過
  - 證據：`readCapabilitySpecs` 改為每個 capability 目錄都回傳一筆（`markdown: string | null`），不再對缺 `spec.md` 的目錄整筆過濾掉；`CapabilitySpecFile.markdown`／`CapabilityView.rawMarkdown` 型別改 `string | null`；`renderCapabilitySection` 對 `rawMarkdown === null` 標「spec.md 未產出」（新區塊，非省略）；`resolveCapabilityDisplayName` 同步接受 `string | null`。
  > TDD: `renderChangeHtml — capability directory missing spec.md (P2d)`→ GREEN ✓（斷言側欄/區塊仍出現該 capability slug，且標「spec.md 未產出」而非整段消失）。

- [x] 4.8 P2e — `results` 含 `null`/非物件 entry 不得 crash
  - 證據：併入 4.1 的 `isSynthesisShape` 強化（`isSynthesisResultEntry` 逐筆檢查）——`results: [null]` 或 `results: ['not-an-object']` 使整份 JSON 判定為「非 SynthesisShape」，`computeGateStatuses` 走既有的「unrecognized shape」分支（不寫入 `byId`，不 throw）；`renderChangeHtml` 對單一 gate 檔解析失敗自然降級為原文呈現（`renderGateEvidenceBadge` 回空字串、`<pre class="spec-raw">` 仍顯示跳脫後原始 JSON），不中斷整份渲染。
  > TDD: `computeGateStatuses`「does not throw when a results entry is null...」＋「...results entry is a non-object (string)」→ GREEN ✓；`renderChangeHtml — malformed gate results entry does not crash the whole render (P2e)`（`{total:1,results:[null]}`）→ GREEN ✓（不 throw、原始 JSON 以 `&quot;` 跳脫呈現、無綠燈）。

- [x] 4.9 IDE 診斷修正 — `test/commands/html.test.ts` spread argument tuple 型別錯誤
  - 證據：`spawnMock` 原為 `vi.fn(() => ({...}))`（零參數實作，TS 推斷呼叫簽章為 `[]` tuple），與 `spawn: (...args: unknown[]) => spawnMock(...args)` 的 spread 不相容（TS2556: "A spread argument must either have a tuple type or be passed to a rest parameter"）。改為 `vi.fn((..._args: unknown[]) => ({...}))`，讓其呼叫簽章帶明確 rest 參數，spread 落在 rest parameter 上。
  > 驗證：`npx tsc --noEmit --strict ... test/commands/html.test.ts test/core/render/html.test.ts` 修正前重現該錯誤（TS2556 於第 8 行），修正後（含後續新增測試自身引入的另兩處衍生型別問題一併修正：win32 spawn 測試的 mock 實作簽章、`fake.mock.calls[0]` 解構後的型別斷言）無任何輸出（0 error）。

## 5. Review-fix 輪（第 3 輪，3 輪上限最後一輪）

> 上輪（4.1–4.9）triple-review FAIL（P1×2／P2×7）。核心問題：symlink 防護「有殼無芯」——`resolveWithinContainer` 的回傳值算出來後從未被使用，實際讀寫仍沿用未 resolve 的原始路徑，等於沒防。本輪只修不重寫；`pnpm build` 全綠；`pnpm test` 122 test files / 2218 tests 全綠（較上輪 +17：`test/commands/html.test.ts` 23→34、`test/core/render/html.test.ts` 41→47）；`pnpm lint` 0 error（僅 1 個與本 change 無關的既有 warning，`src/core/references.ts:195` 的 unused eslint-disable）。

- [x] 5.1 P1 — `resolveWithinContainer` 回傳值必須被使用（symlink 防護有殼無芯）
  - 證據：`src/commands/html.ts` `execute()` 改為 `const resolvedChangeDir = resolveWithinContainer(changeDir, changesDir, 'change directory');`，其回傳值取代後續一切讀取——`resolveSchemaSafely(resolvedChangeDir, projectRoot)` 與 `renderChangeHtml({ changeDir: resolvedChangeDir, ... })` 都吃 resolved 值，不再是「check 完就丟」。輸出落點同理：預設落點直接重用已驗證過的 `resolvedChangeDir`（不必也不重複再 resolve 一次同一個目錄），`--out` 落點則對其目錄呼叫 `fs.realpathSync` 後才 `path.join` 檔名，`outPath` 恆用 resolved 目錄組出。
  - 附帶影響：macOS 上 `os.tmpdir()`（`/var/...`）本身經 symlink 指向 `/private/var/...`（已用 `node -e` 實測驗證兩者 `fs.realpathSync` 不相等），改用 resolved 值後回傳路徑會是 `/private/var/...` 而非測試原本假設的 `/var/...`——這正是本項修正「動了真格」的直接證據，非 regression。既有兩個路徑相等斷言（預設落點／`--out`）已改用 `fs.realpathSync(...)` 正規化後比較。
  > TDD: `test/commands/html.test.ts`「writes spec-viewer.html to the change directory by default...」＋「honors --out to write to a custom path...」（改後仍 GREEN，斷言對象改為 realpath 正規化值）；既有 symlink end-to-end 拒絕測試不受影響仍 GREEN。

- [x] 5.2 P1 — 輸出檔本體防 symlink（寫入前拒絕、不跟隨覆寫目標）
  - 證據：新增 `HtmlCommand.rejectSymlinkOutputTarget(outPath)`：寫入前 `fs.lstatSync(outPath)`（用 `lstatSync` 不用 `statSync`，才不會自己先跟隨掉）；不存在則放行，存在且 `isSymbolicLink()` 則丟 `HtmlCommandError`（訊息含 `symlink` 關鍵字），完全不呼叫 `fs.writeFileSync`。預設落點與 `--out` 落點套用同一函式、同一規則。存在但是「普通檔案」（例如上次渲染留下的舊 `spec-viewer.html`）則正常覆寫，不受影響。
  > TDD: `test/commands/html.test.ts`「output file symlink rejection (item 2)」4 個測試——預設落點 symlink 拒絕＋確認 symlink 指向的檔案內容未被動過、`--out` 落點 symlink 拒絕＋同樣驗證未被覆寫、輸出路徑尚不存在時正常寫入、輸出路徑已是普通舊檔時正常覆寫（非 symlink 不受影響）→ GREEN ✓。

- [x] 5.3 P1 — 子 artifact 讀取防出界：`readArtifactSafely` + `specs`/`.gates` 目錄逐 entry lstat 檢查
  - 證據：`src/core/render/html.ts` 新增 `resolveRealBase`／`resolveArtifactPath`／`readArtifactSafely`／`isEntryWithinBoundary` 四個內部 helper：`proposal.md`／`design.md`／`tasks.md`／`specs/<slug>/spec.md` 全部改走 `readArtifactSafely(realBase, relPath)`——先對 `path.join(realBase, relPath)` 整條路徑（含中間任何一段）`fs.realpathSync`，以 path-segment 邊界（非字串前綴）確認仍在 `realBase` 內才 `readFileSync`；出界（symlink 目標在 `realBase` 外，或整段解析失敗）一律回傳 `null`，對應區塊自然落回既有「未產出」渲染路徑，不讀不 throw。`specs/`／`.gates/` 的 `readdirSync` 改在先驗證過邊界的 resolved 目錄（`specsDirReal`／`gatesDirReal`）上做，且每個 entry 額外過 `isEntryWithinBoundary`：非 symlink 一律放行（無需再驗證，本就在邊界內）；是 symlink 則再 `realpathSync` 一次，出界才排除（整個 capability 目錄／整個 gates 檔视為不存在，不列舉、不讀取）；lstat 失敗（entry 消失）不視為出界，放行讓後續讀取自然失敗降級（與 5.4 的 race 處理銜接一致，不會把單純的競態誤判成安全排除）。
  > TDD: `test/core/render/html.test.ts`「renderChangeHtml — symlink escape read protection (item 3)」5 個測試：`proposal.md` symlink 出界（不洩漏內容，標「proposal.md 未產出」）、`specs/<cap>` 目錄本身是出界 symlink（整個 capability 從清單消失，slug 名也不出現）、`specs/<cap>/spec.md` symlink 出界但目錄本身是真的（capability 仍列出、標「spec.md 未產出」，不洩漏內容）、`.gates/*.json` symlink 出界（不洩漏內容，整個 `.gates/` 視為未產出）、合法在界內的 gates 檔與出界 symlink 檔並存時前者正常渲染、後者被排除 → GREEN ✓ (5/5)。

- [x] 5.4 P2 — `.gates` 讀取 race：逐檔 `readFileSync` 包 try/catch，讀失敗標「無法讀取」不 crash 整指令
  - 證據：`readGatesFiles` 原本對 `.gates/*.json` 的 `fs.readFileSync` 完全沒有 try/catch——`readdirSync` 列出的檔案若在讀取前消失（刪除／替換的競態），會直接把原始 fs 例外拋出整個 `renderChangeHtml`／CLI 指令。改為每個檔案的 `readFileSync` 各自包 try/catch，失敗則該筆回傳 `{ filename, raw: '', data: undefined, unreadable: true }`；`GatesFileEntry` 新增 `unreadable?: boolean` 欄位。`renderGateEvidenceSection` 對 `unreadable` 的檔案顯示「無法讀取（列出目錄後檔案可能已被刪除或替換）」，且**不**渲染空的 `<pre>` 原文區塊（原文根本不存在，不是空字串），其餘檔案渲染不受影響、整份指令不中斷。
  - 測試技巧備註：vitest ESM 下無法直接 `vi.spyOn(fs, 'readFileSync')`（"Cannot redefine property"）——改用 `vi.mock('node:fs', factory)` 搭配 `vi.hoisted` 的可變開關（`readFileFailurePath`），只讓指定絕對路徑的 `readFileSync` 呼叫拋 `ENOENT`，其餘所有 `fs` API 透明轉呼叫 `importOriginal()` 的真實實作，不影響同檔案內其他測試。
  > TDD: `test/core/render/html.test.ts`「renderChangeHtml — .gates file vanishing between readdir and read does not crash (item 4)」→ GREEN ✓（`readdirSync` 已列出檔名後令其 `readFileSync` 失敗，斷言不 throw、輸出含檔名與「無法讀取」、無綠燈）。

- [x] 5.5 P2 — `.openspec.yaml` 缺席時依檔名形狀判斷渲染模式（湊兩項才套預設 schema，並誠實標註）
  - 證據：`HtmlCommand.resolveSchemaSafely` 改為：先用既有 `readChangeMetadata(changeDir, projectRoot)` 判斷 `.openspec.yaml` 是否存在（回傳 `null` 表不存在；拋例外表存在但格式錯誤——視為「有宣告意圖」，走原本 fallback-to-default 路徑，不觸發本項邏輯）。真的不存在時，檢查 `proposal.md`／`design.md`／`tasks.md`／`specs/` 四項命中數：< 2 一律 `schema: null`（不猜、不宣告任何 gate，維持「無已宣告的 gate」呈現）；≥ 2 才套用預設 schema（`spec-driven`）且回傳 `schemaAutoDefaulted: true`。`renderChangeHtml`／`RenderChangeHtmlOptions` 新增 `schemaAutoDefaulted?: boolean`（預設 `false`，不影響任何既有呼叫端），為 `true` 時 header 區塊多渲染一行 `schema 未宣告，依預設`，不讓猜測出來的預設值看起來像是真的宣告過。
  > TDD: `test/commands/html.test.ts`「.openspec.yaml absence — filename-shape schema inference (item 5)」3 個測試：命中 2 項（`proposal.md`＋`tasks.md`）時輸出含「schema 未宣告，依預設」、只命中 1 項（僅 `proposal.md`）時輸出不含該註記且顯示「無已宣告的 gate」、`.openspec.yaml` 確實存在且宣告 schema 時不顯示該註記 → GREEN ✓ (3/3)。

- [x] 5.6 P2 — archive 站 dead-code：讓已歸檔 change 真正可達
  - 證據：問題有兩層——(a) `rejectDangerousInput` 原本的 kebab-case allowlist（`^[a-z]...`）要求以小寫字母開頭，架構化的 archive 目錄名（`YYYY-MM-DD-slug`，如 `2026-01-15-add-auth`）以數字開頭，**在最前門就會被拒絕**；(b) 就算過了前門，`resolveChangeName`（現改名 `resolveChangeLocation`）也只查 `getAvailableChanges`（明確排除 `archive/`），從未列舉過 `archive/` 底下的目錄，導致 `determineStation` 裡的 `archive` 分支（偵測 `/changes/archive/` 路徑片段）永遠沒有任何呼叫路徑能餵到它。修正：新增獨立的 `ARCHIVE_NAME_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$/` allowlist（同樣結構性排除路徑分隔符／`..`／shell metacharacter，只是形狀不同），`rejectDangerousInput` 對兩個 allowlist 任一命中即放行；`resolveChangeLocation` 在 active 列表找不到、且輸入命中 archive 形狀時，才對 `changesDir/archive/` 做 `readdirSync`＋`isDirectory()` 過濾＋精確字串比對（**列舉比對，不組路徑試讀**，與現有 active-change 查找同一紀律），命中才回傳 `archive/<name>` 作為 `changeDir`（後續仍會經 `resolveWithinContainer` 做 symlink 邊界檢查）；找不到時的近似候選訊息維持只從 active 列表算（archive 名稱不會被建議、也不會被列出）。
  > TDD: `test/commands/html.test.ts`「archive reachability (item 6)」4 個測試：archive 形狀名稱不再被 `rejectDangerousInput` 擋下、精確比對到已歸檔 change 並渲染出 `<li class="station current">archive</li>`＋其內容、archive 形狀但目錄不存在時仍是「not found」且建議清單不含任何 archive 名稱、archive 條目本身是指向 `changesDir` 外的 symlink 時仍被 `resolveWithinContainer` 擋下（不會因為走了 archive 分支就繞過既有 symlink 邊界檢查）→ GREEN ✓ (4/4)。

## 6. 實機驗收後修正（主 session）

**Covers**: `html-viewer-command`

- [x] 6.1 TOCTOU 原子化：寫入 `writeFileNoFollow`（O_NOFOLLOW fd 寫）、讀取 `readFileNoFollow`（O_NOFOLLOW fd 讀，套用全部 artifact 與 .gates）；測試 mock 同步攔 openSync
> TDD: test/core/render/html.test.ts + test/commands/html.test.ts → GREEN（2218/2218）
- [x] 6.2 file:// 亂碼修正：輸出改完整獨立文件（doctype + head 含 meta charset utf-8），spec requirement 同步改寫；包殼測試反轉為「各恰一次＋charset 前 1024 bytes」，對抗性白名單補 wrapper 標籤（使用者實測抓到 CJK mojibake）
> TDD: 同上 GREEN
