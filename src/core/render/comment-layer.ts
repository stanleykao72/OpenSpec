/**
 * 評論層（select-to-comment / Notes 面板 / 已審勾選 / 匯出）的三段構件。
 *
 * Change `port-comment-layer-to-cli`。移植自 odoo-claude-code 的
 * `deploy/templates/html/skeleton.html`（`BLOCK: 評論層 CSS` / `BLOCK: 評論層 HTML` /
 * `BLOCK: 評論層 script` 三段），行為契約與慣例見該 repo 的
 * `deploy/templates/html/conventions.md`「評論層（spec-comment-*）」章。
 *
 * ## 為什麼是「移植」而不是跨 repo 引用
 *
 * 這個 fork 的既有約束是 render 時 self-contained、不跨 repo 參照（見
 * `html-template.ts` 檔頭記錄的同一 sync discipline）。build 時去讀另一個 repo 的
 * skeleton.html 會建立 CI 與 npm 安裝情境都拿不到的路徑依賴。代價是兩份實作要人工
 * 同步——**改動 odoo-claude-code 的評論層時，這裡要跟著改**；行為契約以
 * `port-comment-layer-to-cli` 的 spec 為準，不要只改一邊就當完成。
 *
 * ## 與 skill 版唯一的行為差異
 *
 * change 名的來源：skill 版解析 `<title>` 的「<change-name> · spec-viewer」marker；
 * 這裡改讀內容根元素的 `data-change-name`（artifact-body 片段沒有 `<head>`/`<title>`，
 * 且 renderer 渲染時已知 change 名）。「缺席即強制 in-memory、絕不落到固定 fallback
 * key」的保護維持不變，只是判斷依據換了來源。見 design.md Decision 1。
 *
 * ## 可分離性
 *
 * 三段一起移除 MUST NOT 影響既有導覽（側欄樹 / scrollspy / 收合 / 抽屜）。script 段是
 * 獨立 IIFE，不與 `SPEC_VIEWER_NAV_SCRIPT` 共用任何變數或函式，也不呼叫其
 * `revealTarget()`。
 */

/** 評論層 CSS（`.spec-comment-*` / `.spec-review-*`）——**自帶 `<style>` 包裹**（skeleton
 * 裡這段住在主 style 區塊內；抽成獨立常數後若不包裹，會被當成純文字渲染在頁面上——
 * 實機 file:// 驗證抓到的 bug，離線測試看不到）。不覆寫任何既有 `.spec-*` 規則。 */
export const COMMENT_LAYER_STYLE = `<style>
  /* ============================================================================
     BLOCK: 評論層 CSS（.spec-comment-* / .spec-review-*）— 可分離附加構件。
     這段與下方對應的 HTML 區塊、獨立 <script> 一起構成評論層；三者一起刪除
     MUST NOT 影響上方既有導覽（生命週期路線圖 / 側欄內容樹 / scrollspy /
     revealTarget）與摺疊機制。設計依據見 conventions.md「評論層」一節。
     ============================================================================ */

  /* 導讀列的 Notes 面板開關（徽章顯示目前評論筆數） */
  .spec-comment-toggle {
    display: inline-flex; align-items: center; gap: .35rem;
    background: var(--spec-bg-card); color: var(--spec-fg);
    border: 1px solid var(--spec-border); border-radius: 999px;
    padding: .3rem .8rem; font-size: .82rem; cursor: pointer;
  }
  .spec-comment-toggle:hover { border-color: var(--spec-accent); color: var(--spec-accent); }

  /* localStorage 不可用時的明示提醒，放在面板最上方 */
  .spec-comment-storage-note {
    margin: 0 0 .6rem; padding: .5rem .7rem; border-radius: 6px;
    background: color-mix(in srgb, var(--spec-sev-medium) 25%, transparent);
    border: 1px solid var(--spec-sev-medium); font-size: .78rem;
  }

  /* review-fix P3-3：常駐（非條件式）的儲存邊界提醒，固定顯示在面板最上方——
     跟上面 .spec-comment-storage-note（只在 localStorage 不可用時才顯示的
     警告）不同，這則不論儲存是否可用都一直顯示，語氣是中性告知而非警告，
     因此用資訊藍而非 severity 黃 */
  .spec-comment-privacy-note {
    margin: 0 0 .6rem; padding: .5rem .7rem; border-radius: 6px;
    background: color-mix(in srgb, var(--spec-info) 18%, transparent);
    border: 1px solid var(--spec-info); font-size: .76rem; color: var(--spec-fg-muted);
  }

  /* Notes 側欄面板：獨立於既有 .spec-sidebar（不同構件、不同 DOM 子樹），
     固定於畫面右側，預設收在畫面外，靠 .open 滑入 */
  .spec-comment-panel {
    position: fixed; top: 0; right: 0; height: 100vh; width: 22rem; max-width: 90vw;
    background: var(--spec-bg-card); border-left: 1px solid var(--spec-border);
    box-shadow: -2px 0 12px rgba(0, 0, 0, .2);
    transform: translateX(100%); transition: transform .2s ease;
    z-index: 30; overflow-y: auto; padding: 1rem 1.1rem;
    font-size: .85rem;
  }
  .spec-comment-panel.open { transform: translateX(0); }
  .spec-comment-panel-head {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: .6rem;
  }
  .spec-comment-panel-head h4 { margin: 0; font-size: 1rem; }
  .spec-comment-panel-close {
    background: none; border: none; color: var(--spec-fg-muted);
    font-size: 1.1rem; cursor: pointer; line-height: 1;
  }
  .spec-comment-progress {
    margin: 0 0 .8rem; padding: .4rem .6rem; border-radius: 6px;
    background: var(--spec-bg); border: 1px solid var(--spec-border);
    font-size: .8rem; color: var(--spec-fg-muted);
  }
  .spec-comment-export-btn {
    display: block; width: 100%; margin: 0 0 .8rem; padding: .5rem .7rem;
    background: var(--spec-accent); color: var(--spec-accent-fg);
    border: none; border-radius: 6px; font-size: .85rem; font-weight: 700;
    cursor: pointer;
  }
  .spec-comment-export-btn:hover { opacity: .9; }
  .spec-comment-export-result { margin: -.4rem 0 .8rem; font-size: .76rem; color: var(--spec-fg-muted); }

  .spec-comment-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .6rem; }
  .spec-comment-empty { color: var(--spec-fg-muted); font-style: italic; font-size: .8rem; }
  .spec-comment-item {
    position: relative; border: 1px solid var(--spec-border); border-radius: 8px;
    padding: .55rem .65rem .5rem; background: var(--spec-bg);
  }
  .spec-comment-jump {
    display: block; width: 100%; text-align: left; background: none; border: none;
    padding: 0; cursor: pointer; color: inherit; font: inherit;
  }
  .spec-comment-quote {
    margin: 0 0 .35rem; padding: .3rem .55rem; border-left: 3px solid var(--spec-accent);
    background: var(--spec-bg-card); font-size: .78rem; color: var(--spec-fg-muted);
  }
  .spec-comment-text { margin: 0 0 .35rem; font-size: .82rem; word-break: break-word; }
  .spec-comment-meta {
    display: flex; flex-wrap: wrap; gap: .4rem; align-items: center;
    font-size: .72rem; color: var(--spec-fg-muted);
  }
  .spec-comment-changed {
    padding: .05rem .45rem; border-radius: 999px; font-weight: 700;
    background: var(--spec-sev-medium); color: #1a1a1a;
  }
  .spec-comment-delete {
    position: absolute; top: .4rem; right: .4rem; background: none; border: none;
    color: var(--spec-fg-muted); cursor: pointer; font-size: .85rem; line-height: 1;
    padding: .1rem .3rem; border-radius: 4px;
  }
  .spec-comment-delete:hover { color: var(--spec-sev-critical); background: var(--spec-bg-card); }

  /* 頁內原文標記：包住被引用文字的既有文字節點（切割後插入），不改動原 HTML 結構 */
  mark.spec-comment-mark {
    background: color-mix(in srgb, var(--spec-sev-medium) 55%, transparent);
    color: inherit; padding: 0 .1rem; border-radius: 2px; cursor: pointer;
  }

  /* 浮動「+ 評論」按鈕：主內容區單一區塊內有效選取時浮出 */
  .spec-comment-float-btn {
    position: fixed; z-index: 25; padding: .3rem .7rem; border-radius: 6px;
    background: var(--spec-accent); color: var(--spec-accent-fg); border: none;
    font-size: .78rem; font-weight: 700; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, .25);
  }

  /* 評論輸入彈出框 */
  .spec-comment-form {
    position: fixed; z-index: 26; width: 18rem; max-width: 90vw;
    background: var(--spec-bg-card); border: 1px solid var(--spec-border);
    border-radius: 8px; padding: .7rem .8rem; box-shadow: 0 4px 16px rgba(0, 0, 0, .25);
  }
  .spec-comment-form-quote {
    margin: 0 0 .5rem; padding: .35rem .55rem; border-left: 3px solid var(--spec-accent);
    background: var(--spec-bg); font-size: .76rem; color: var(--spec-fg-muted);
    max-height: 4.5rem; overflow-y: auto;
  }
  .spec-comment-form textarea {
    width: 100%; min-height: 4.5rem; resize: vertical; font: inherit;
    padding: .4rem .5rem; border: 1px solid var(--spec-border); border-radius: 6px;
    background: var(--spec-bg); color: var(--spec-fg); box-sizing: border-box;
  }
  .spec-comment-form-actions { display: flex; justify-content: flex-end; gap: .5rem; margin-top: .5rem; }
  .spec-comment-form-actions button {
    padding: .3rem .8rem; border-radius: 6px; font-size: .8rem; cursor: pointer;
    border: 1px solid var(--spec-border); background: var(--spec-bg-card); color: var(--spec-fg);
  }
  .spec-comment-form-actions button[type="submit"] {
    background: var(--spec-accent); color: var(--spec-accent-fg); border-color: transparent;
  }

  /* 匯出剪貼簿失敗時的 fallback modal：內含已全選唯讀 textarea */
  .spec-comment-modal {
    position: fixed; inset: 0; z-index: 40; display: flex; align-items: center;
    justify-content: center; background: rgba(0, 0, 0, .45); padding: 1.5rem;
  }
  /* hidden 屬性防護：作者樣式的 display 會壓過 UA 的 [hidden]{display:none}——
     上面 .spec-comment-modal 的 display:flex 正是實例（Artifact 實測抓到：modal
     載入即常駐、關閉鈕無效）。此全域規則確保任何帶 hidden 屬性的元素一律隱藏，
     不論其 class 是否宣告 display。MUST NOT 移除。 */
  [hidden] { display: none !important; }
  .spec-comment-modal-body {
    background: var(--spec-bg-card); border: 1px solid var(--spec-border);
    border-radius: 10px; padding: 1rem 1.1rem; width: 100%; max-width: 40rem;
  }
  .spec-comment-modal-body h4 { margin: 0 0 .5rem; }
  .spec-comment-modal-textarea {
    width: 100%; height: 16rem; font-size: .78rem; line-height: 1.4;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: .6rem .7rem; border: 1px solid var(--spec-border); border-radius: 6px;
    background: var(--spec-bg); color: var(--spec-fg); box-sizing: border-box; resize: vertical;
  }
  .spec-comment-modal-close {
    display: block; margin-top: .6rem; margin-left: auto; padding: .35rem .9rem;
    border-radius: 6px; border: 1px solid var(--spec-border); background: var(--spec-bg);
    color: var(--spec-fg); cursor: pointer;
  }

  /* 區塊「已審」checkbox：掛在 proposal／各 capability 的 specs 卡／tasks／design
     標題列（<h3> 內），與內容同一個 .spec-card，不新增額外區塊 */
  .spec-review-check {
    display: inline-flex; align-items: center; gap: .3rem; margin-left: .75rem;
    font-size: .78rem; font-weight: 400; color: var(--spec-fg-muted); cursor: pointer;
    vertical-align: middle;
  }
  .spec-review-check input { cursor: pointer; }
</style>`;

/** 評論層 HTML：Notes 面板、浮動評論按鈕、評論輸入框、匯出 fallback modal。
 * **不含** skeleton 的既有導覽 script（那是 `SPEC_VIEWER_NAV_SCRIPT`；抽取時邊界必須
 * 止於它之前，否則輸出會重複一份導覽邏輯）。 */
export const COMMENT_LAYER_HTML = `<!-- ================================================================================
     BLOCK: 評論層 HTML — Notes 面板 / 浮動評論按鈕 / 評論輸入框 / 匯出 fallback modal。
     可分離構件：複製骨架即得，不需依 change 內容客製（審查勾選除外，見上方各
     .spec-review-check）。整段（含下方獨立 <script>）一起刪除 MUST NOT 影響上面
     既有導覽（生命週期路線圖／側欄內容樹／scrollspy／revealTarget）與摺疊機制。
     設計依據見 conventions.md「評論層」一節。
     ================================================================================ -->
<aside class="spec-comment-panel" id="spec-comment-panel" aria-label="評論面板">
  <div class="spec-comment-panel-head">
    <h4>Notes</h4>
    <button type="button" class="spec-comment-panel-close" id="spec-comment-panel-close" aria-label="關閉面板">✕</button>
  </div>
  <!-- review-fix P3-3：常駐提醒，不受 hidden 控制、任何時候都顯示 -->
  <p class="spec-comment-privacy-note" id="spec-comment-privacy-note">
    評論存在瀏覽器本機、同網域其他頁面可讀，勿貼入密鑰或機密
  </p>
  <p class="spec-comment-storage-note" id="spec-comment-storage-note" hidden>
    本次評論不會保存（此環境 localStorage 不可用，僅本頁瀏覽期間有效）
  </p>
  <p class="spec-comment-progress" id="spec-comment-progress">已審 0 / 0 區塊</p>
  <button type="button" class="spec-comment-export-btn" id="spec-comment-export-btn">匯出評論為 Markdown</button>
  <button type="button" class="spec-comment-export-btn" id="spec-comment-save-btn" hidden>存成檔案（給 Claude Code 讀回）</button>
  <p class="spec-comment-export-result" id="spec-comment-export-result" hidden></p>
  <ul class="spec-comment-list" id="spec-comment-list">
    <li class="spec-comment-empty">尚無評論——在主內容區反白文字即可留下評論。</li>
  </ul>
</aside>

<button type="button" class="spec-comment-float-btn" id="spec-comment-float-btn" hidden>+ 評論</button>

<form class="spec-comment-form" id="spec-comment-form" hidden>
  <blockquote class="spec-comment-form-quote" id="spec-comment-form-quote"></blockquote>
  <textarea id="spec-comment-input" placeholder="輸入評論……" required></textarea>
  <div class="spec-comment-form-actions">
    <button type="button" id="spec-comment-form-cancel">取消</button>
    <button type="submit">送出</button>
  </div>
</form>

<div class="spec-comment-modal" id="spec-comment-modal" hidden>
  <div class="spec-comment-modal-body">
    <h4>剪貼簿無法使用，請手動複製</h4>
    <textarea class="spec-comment-modal-textarea" id="spec-comment-modal-textarea" readonly></textarea>
    <button type="button" class="spec-comment-modal-close" id="spec-comment-modal-close">關閉</button>
  </div>
</div>`;

/** 評論層 script：獨立 IIFE。 */
export const COMMENT_LAYER_SCRIPT = `<!-- ================================================================================
     BLOCK: 評論層 script — 獨立 IIFE，不與上方既有導覽的 script 區塊共用變數/函式，
     不呼叫、不修改其 revealTarget()／scrollspy／drawer 邏輯。移除本區塊（含上方
     HTML 與 CSS 段）MUST NOT 影響既有導覽與摺疊機制。見 conventions.md「評論層」一節。
     ================================================================================ -->
<script>
(function () {
  "use strict";

  /* ============================================================================
     評論層邏輯（獨立 IIFE，不與上方既有導覽 <script> 共用任何變數/函式）。
     ============================================================================ */

  /* ---- 工具函式 ---- */

  // HTML entity 跳脫：& 必須最先處理，否則後面轉出的 entity 會被二次跳脫
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function truncate(str, max) {
    str = str || "";
    return str.length > max ? str.slice(0, max - 1) + "…" : str;
  }

  function formatTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // change 名稱取自內容根元素的 data-change-name（openspec html 渲染時寫入）。
  // 與 skill 版（解析 document.title 的「<change-name> · spec-viewer」marker）刻意不同：
  // artifact-body 片段沒有 head/title 元素，發佈後的 document.title 由平台決定，不在
  // renderer 掌握中；而 CLI 在渲染時本來就知道 change 名，沒有理由從標題反推。
  // 見 change port-comment-layer-to-cli 的 design.md Decision 1。
  //
  // 缺席（屬性不存在或為空）時回傳 null——呼叫端據此判定「這個名稱不可信，
  // MUST NOT 拿來當 localStorage key 的分域依據」，而不是落到某個固定字面
  // fallback 後仍嘗試持久化（那樣會讓所有缺屬性的頁面共用同一把 key，互相污染
  // 彼此的評論）。這條保護與 skill 版一致，只是判斷依據換了來源。
  function detectChangeName() {
    // 屬性條件刻意寫在 JS 而不是選擇器裡（不用 ".spec-viewer[data-change-name]"）：
    // 屬性選擇器對「缺席」與「空字串」的處理要另外想，而這裡兩者都必須一律當
    // 不可信；分成「找根元素」＋「讀屬性並 trim」兩步，語意最直白。
    var root = document.querySelector(".spec-viewer");
    if (!root) return null;
    var name = (root.getAttribute("data-change-name") || "").trim();
    return name || null;
  }

  /* ---- localStorage（不可用時降級 in-memory，見 conventions.md「評論層」） ---- */

  var DETECTED_CHANGE_NAME = detectChangeName();
  // CHANGE_NAME 只供顯示／匯出文字使用（面板標題、匯出 Markdown 的 change 名）；
  // 下面 storageAvailable 的判定刻意不採信這個 fallback 字面值，見 detectChangeName 說明。
  var CHANGE_NAME = DETECTED_CHANGE_NAME || "unknown-change";
  var STORAGE_KEY_COMMENTS = "spec-viewer:" + CHANGE_NAME + ":comments";
  var STORAGE_KEY_REVIEWED = "spec-viewer:" + CHANGE_NAME + ":reviewed";

  var memoryStore = {};
  var storageAvailable = (function () {
    // data-change-name 缺席時強制走 in-memory（承襲 skill 版 P3-2 的保護），
    // 不嘗試探測／使用 localStorage，也不落地任何一筆評論或審查勾選
    if (!DETECTED_CHANGE_NAME) return false;
    try {
      var testKey = "__spec_viewer_storage_test__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  })();

  function showStorageWarning() {
    var el = document.getElementById("spec-comment-storage-note");
    if (el) el.hidden = false;
  }

  function storageGet(key) {
    if (storageAvailable) {
      try {
        var v = window.localStorage.getItem(key);
        if (v !== null) return v;
        return null;
      } catch (e) {
        storageAvailable = false;
        showStorageWarning();
      }
    }
    return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
  }

  function storageSet(key, value) {
    memoryStore[key] = value; // 恆常保留一份 in-memory 備援，不論 localStorage 是否可用
    if (storageAvailable) {
      try {
        window.localStorage.setItem(key, value);
      } catch (e) {
        storageAvailable = false;
        showStorageWarning();
      }
    }
  }

  function loadComments() {
    var raw = storageGet(STORAGE_KEY_COMMENTS);
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveComments() {
    storageSet(STORAGE_KEY_COMMENTS, JSON.stringify(comments));
  }

  function loadReviewed() {
    var raw = storageGet(STORAGE_KEY_REVIEWED);
    if (!raw) return {};
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveReviewed() {
    storageSet(STORAGE_KEY_REVIEWED, JSON.stringify(reviewed));
  }

  /* ---- 狀態 ---- */

  var comments = loadComments();
  var reviewed = loadReviewed();
  var orphanedIds = {}; // comment.id -> true，表示引文比對失敗（原文已變更），不落地保存
  var pendingSelection = null; // { text, block, quoteExcerpt }

  if (!storageAvailable) showStorageWarning();

  /* ---- 就近區塊判定 ---- */

  function closestBlock(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    if (!el || typeof el.closest !== "function") return null;
    return el.closest(".spec-scenario, .spec-requirement, .spec-card");
  }

  function getSectionTitle(container) {
    if (!container) return "";
    var children = container.children || [];
    for (var i = 0; i < children.length; i++) {
      var tag = children[i].tagName;
      if (tag === "H3" || tag === "H4" ||
        (children[i].classList && children[i].classList.contains("name"))) {
        return cleanSectionTitleText(children[i]);
      }
    }
    return container.id || "";
  }

  // review-fix P1：標題節點（<h3>/<h4>）常內嵌「已審」checkbox 的 <label
  // class="spec-review-check">，直接讀 textContent 會把「已審」二字一併吃進
  // sectionTitle，污染 Notes 面板顯示與匯出的區塊標題。做法：clone 標題節點
  // （不動實際頁面 DOM）、移除 clone 內的 .spec-review-check 子樹後才取
  // textContent，確保 sectionTitle 只含標題本身。
  function cleanSectionTitleText(titleEl) {
    var clone = titleEl.cloneNode(true);
    stripReviewCheckLabels(clone);
    return (clone.textContent || "").trim();
  }

  function stripReviewCheckLabels(root) {
    var toRemove = [];
    (function walk(node) {
      var kids = node.childNodes || [];
      for (var i = 0; i < kids.length; i++) {
        var child = kids[i];
        if (child.nodeType === 1) {
          if (child.classList && child.classList.contains("spec-review-check")) {
            toRemove.push(child);
          } else {
            walk(child);
          }
        }
      }
    })(root);
    toRemove.forEach(function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
  }

  /* ---- 引文標記復原（design.md Decision 1：區塊 id 定位 → 文字比對 → mark 包裹） ---- */

  function findTextNodes(root) {
    var nodes = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  // 在單一文字節點內把 [start, end) 這段字元切成三段，中段包成 <mark>；
  // 只動文字節點本身，不改動周圍的既有 HTML 結構
  function wrapTextNodeRange(node, start, end, commentId) {
    var text = node.nodeValue;
    var before = text.slice(0, start);
    var matched = text.slice(start, end);
    var after = text.slice(end);

    var mark = document.createElement("mark");
    mark.className = "spec-comment-mark";
    mark.setAttribute("data-comment-id", commentId);
    mark.textContent = matched; // textContent 指派本身即安全，不會被解析成標記

    var parent = node.parentNode;
    if (!parent) return;
    if (before) parent.insertBefore(document.createTextNode(before), node);
    parent.insertBefore(mark, node);
    if (after) parent.insertBefore(document.createTextNode(after), node);
    parent.removeChild(node);
  }

  // review-fix P2a：comment.quote 來自 selection.toString()，跨區塊/跨行內元素
  // 選取時瀏覽器可能在邊界插入合成換行，使其與 TreeWalker 依 DOM 順序原樣串接
  // 出的 nodeValue 在空白字元（換行/連續空白）上不完全一致，即便兩者語意上是
  // 同一段引文。逐字比對（indexOf）優先——這是原本就成立的多數情況，維持
  // 原行為；找不到才退而比對「雙方皆做 \\s+ → 單一空格正規化」後的字串，命中
  // 位置再透過 buildNormalizedIndex() 的索引反推回原始字元區間。正規化仍找不到
  // 才視為「原文已變更」。
  function findQuoteRange(concat, quote) {
    var idx = concat.indexOf(quote);
    if (idx !== -1) return { start: idx, end: idx + quote.length };

    var normalized = buildNormalizedIndex(concat);
    var normalizedQuote = quote.replace(/\\s+/g, " ");
    if (!normalizedQuote) return null;
    var normIdx = normalized.text.indexOf(normalizedQuote);
    if (normIdx === -1) return null;

    var normEnd = normIdx + normalizedQuote.length;
    return { start: normalized.starts[normIdx], end: normalized.starts[normEnd] };
  }

  // 把原始字串內連續空白（含換行）各自收斂成一個正規化空格，同時記錄每個
  // 正規化字元對應回原始字串的起始偏移。starts 陣列長度＝正規化字串長度＋1，
  // 最後一項是原始字串總長度（供比對命中終點反推用），使命中的正規化區間
  // 可以精確反推回原始字元的 [start, end) 區間（含被收斂掉的整段空白跨距）。
  function buildNormalizedIndex(str) {
    var text = "";
    var starts = [];
    var i = 0;
    var n = str.length;
    while (i < n) {
      if (/\\s/.test(str.charAt(i))) {
        starts.push(i);
        text += " ";
        while (i < n && /\\s/.test(str.charAt(i))) i++;
      } else {
        starts.push(i);
        text += str.charAt(i);
        i++;
      }
    }
    starts.push(n);
    return { text: text, starts: starts };
  }

  // 回傳 true＝找到原文並完成標記；false＝原文已變更（找不到，含正規化仍找不到），面板需標示
  function applyMarkForComment(comment) {
    if (!comment || !comment.sectionId || !comment.quote) return false;
    var block = document.getElementById(comment.sectionId);
    if (!block) return false;

    var textNodes = findTextNodes(block);
    var concat = "";
    var segments = [];
    textNodes.forEach(function (node) {
      var start = concat.length;
      concat += node.nodeValue;
      segments.push({ node: node, start: start, end: concat.length });
    });

    var range = findQuoteRange(concat, comment.quote);
    if (!range) return false;
    var matchStart = range.start;
    var matchEnd = range.end;

    var toWrap = [];
    segments.forEach(function (seg) {
      var overlapStart = Math.max(seg.start, matchStart);
      var overlapEnd = Math.min(seg.end, matchEnd);
      if (overlapStart < overlapEnd) {
        toWrap.push({
          node: seg.node,
          localStart: overlapStart - seg.start,
          localEnd: overlapEnd - seg.start
        });
      }
    });

    toWrap.forEach(function (item) {
      wrapTextNodeRange(item.node, item.localStart, item.localEnd, comment.id);
    });
    return toWrap.length > 0;
  }

  function reapplyAllMarks() {
    orphanedIds = {};
    comments.forEach(function (c) {
      var ok = applyMarkForComment(c);
      if (!ok) orphanedIds[c.id] = true;
    });
  }

  // 依 data-comment-id 屬性相等比對尋找/移除標記（沿用既有 scrollspy 的作法：
  // 不把 id 字串拼進 CSS selector，全部用 JS 屬性比對，見 conventions.md「Scrollspy」一節）
  function forEachMarkOfComment(commentId, fn) {
    var marks = document.querySelectorAll("mark.spec-comment-mark");
    Array.prototype.forEach.call(marks, function (mark) {
      if (mark.getAttribute("data-comment-id") === commentId) fn(mark);
    });
  }

  // review-fix P2c：同一段文字被兩則評論的引文覆蓋時會產生巢狀 <mark>
  // （conventions.md「已知限制」一節）。若只對「要刪除的那一則」呼叫
  // mark.textContent 攤平取代，外層 mark 一旦是被刪除的那個，取用它的
  // textContent 會把內層另一則評論的 <mark> 元素一併拿掉、直接塌成純文字——
  // 內層那則評論的頁內標記就此消失（評論本身沒丟，但標記位置的視覺線索沒了）。
  // 因此 deleteComment() 改為「整頁全拆」＋「其餘評論重新套用」兩步，而不是
  // 針對單一 commentId 做局部替換：先把頁面上所有 .spec-comment-mark 依巢狀
  // 深度由內而外逐層攤平回純文字（removeAllMarks），再對刪除後仍存在的
  // comments 重新跑一次 reapplyAllMarks()，讓其餘評論的標記從乾淨的文字節點
  // 重建，不會被任何一次的攤平動作提前吃掉。
  function removeAllMarks() {
    var guard = 0;
    var marks;
    while ((marks = Array.prototype.slice.call(document.querySelectorAll("mark.spec-comment-mark"))).length && guard < 1000) {
      guard++;
      // 每輪只安全處理「不包住其他 mark」的最內層節點：這些節點攤平成文字
      // 不會波及尚未處理、被巢狀在別處的其他 mark
      var innermost = marks.filter(function (m) {
        return !marks.some(function (other) { return other !== m && m.contains(other); });
      });
      if (!innermost.length) innermost = marks; // 保底：理論上不會發生（無巢狀時每個都是最內層）
      innermost.forEach(function (mark) {
        var parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
      });
    }
  }

  // 展開祖先 details 再捲動到位；獨立於既有 revealTarget()，不呼叫、不依賴它
  function revealAncestorsAndScrollTo(el) {
    var node = el && el.parentNode;
    while (node && node.nodeType === 1) {
      if (node.tagName === "DETAILS") node.open = true;
      node = node.parentNode;
    }
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function jumpToComment(commentId) {
    var target = null;
    forEachMarkOfComment(commentId, function (mark) {
      if (!target) target = mark;
    });
    if (target) revealAncestorsAndScrollTo(target);
  }

  /* ---- artifact 出處推定（design.md Decision 4） ---- */

  function inferArtifactFile(sectionId) {
    if (!sectionId) return "（未知出處）";
    var block = document.getElementById(sectionId);
    var explicit = block && block.getAttribute ? block.getAttribute("data-artifact") : null;
    if (explicit) return explicit;

    if (sectionId === "proposal") return "proposal.md";
    if (sectionId === "tasks") return "tasks.md";
    if (sectionId === "design") return "design.md";
    if (sectionId === "gate-evidence") return ".gates/";

    var specsMatch = /^specs-(.+)$/.exec(sectionId);
    if (specsMatch) return "specs/" + specsMatch[1] + "/spec.md";

    var reqId = sectionId.replace(/-s\\d+$/, "");
    var reqMatch = /^req-(.+)-\\d+$/.exec(reqId);
    if (reqMatch) return "specs/" + reqMatch[1] + "/spec.md";

    return "（未知出處：" + sectionId + "）";
  }

  /* ---- 審查勾選（Requirement「主要區塊具審查勾選」） ---- */

  function getReviewGroups() {
    var boxes = Array.prototype.slice.call(document.querySelectorAll(".spec-review-checkbox"));
    return boxes.map(function (cb) {
      var key = cb.getAttribute("data-review-key") || "";
      return {
        key: key,
        label: cb.getAttribute("data-review-label") || key,
        checked: !!reviewed[key]
      };
    });
  }

  function updateReviewProgress() {
    var groups = getReviewGroups();
    var checked = groups.filter(function (g) { return g.checked; }).length;
    var el = document.getElementById("spec-comment-progress");
    if (el) el.textContent = "已審 " + checked + " / " + groups.length + " 區塊";
  }

  function initReviewCheckboxes() {
    var boxes = Array.prototype.slice.call(document.querySelectorAll(".spec-review-checkbox"));
    boxes.forEach(function (cb) {
      var key = cb.getAttribute("data-review-key");
      cb.checked = !!reviewed[key];
      cb.addEventListener("change", function () {
        reviewed[key] = cb.checked;
        saveReviewed();
        updateReviewProgress();
      });
    });
  }

  /* ---- Notes 面板渲染 ---- */

  function updateCommentCount() {
    var el = document.getElementById("spec-comment-count");
    if (el) el.textContent = String(comments.length);
  }

  function renderCommentList() {
    var listEl = document.getElementById("spec-comment-list");
    if (!listEl) return;

    if (!comments.length) {
      listEl.innerHTML = '<li class="spec-comment-empty">尚無評論——在主內容區反白文字即可留下評論。</li>';
    } else {
      var html = comments.map(function (c) {
        var quoteEsc = escapeHtml(truncate(c.quote, 120));
        var textEsc = escapeHtml(c.text);
        var titleEsc = escapeHtml(c.sectionTitle || c.sectionId || "");
        var timeEsc = escapeHtml(formatTime(c.createdAt));
        var idEsc = escapeHtml(c.id);
        var changedBadge = orphanedIds[c.id]
          ? '<span class="spec-comment-changed">原文已變更</span>'
          : "";
        return (
          '<li class="spec-comment-item" data-comment-id="' + idEsc + '">' +
            '<button type="button" class="spec-comment-jump" data-comment-id="' + idEsc + '">' +
              '<blockquote class="spec-comment-quote">' + quoteEsc + '</blockquote>' +
            '</button>' +
            '<p class="spec-comment-text">' + textEsc + '</p>' +
            '<div class="spec-comment-meta">' +
              '<span class="spec-comment-source">' + titleEsc + '</span>' +
              '<span class="spec-comment-time">' + timeEsc + '</span>' +
              changedBadge +
            '</div>' +
            '<button type="button" class="spec-comment-delete" data-comment-id="' + idEsc + '" aria-label="刪除評論">✕</button>' +
          '</li>'
        );
      }).join("");
      listEl.innerHTML = html;
    }
    updateCommentCount();
  }

  /* ---- 選取即評論 ---- */

  function isCommentFormOpen() {
    var formEl = document.getElementById("spec-comment-form");
    return !!(formEl && !formEl.hidden);
  }

  function hideFloatButton() {
    var btn = document.getElementById("spec-comment-float-btn");
    if (btn) btn.hidden = true;
  }

  function showFloatButton(rect) {
    var btn = document.getElementById("spec-comment-float-btn");
    if (!btn) return;
    var top = rect.bottom + 8;
    var left = rect.left;
    var maxLeft = window.innerWidth - 120;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;
    btn.style.top = top + "px";
    btn.style.left = left + "px";
    btn.hidden = false;
  }

  function onSelectionMaybeChanged() {
    if (isCommentFormOpen()) return; // 撰寫評論中，不重新判定選取

    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      hideFloatButton();
      pendingSelection = null;
      return;
    }
    var text = sel.toString();
    if (!text || !text.trim()) {
      hideFloatButton();
      pendingSelection = null;
      return;
    }

    var range = sel.getRangeAt(0);
    var mainEl = document.querySelector(".spec-main");
    if (!mainEl || !mainEl.contains(range.startContainer) || !mainEl.contains(range.endContainer)) {
      hideFloatButton();
      pendingSelection = null;
      return;
    }

    // 單一區塊驗證：跨區塊或找不到就近區塊一律不出按鈕（Requirement「選取即評論」）
    var startBlock = closestBlock(range.startContainer);
    var endBlock = closestBlock(range.endContainer);
    if (!startBlock || !endBlock || startBlock !== endBlock) {
      hideFloatButton();
      pendingSelection = null;
      return;
    }

    pendingSelection = { text: text, block: startBlock };
    var rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hideFloatButton();
      pendingSelection = null;
      return;
    }
    showFloatButton(rect);
  }

  function openCommentForm() {
    if (!pendingSelection) return;
    var formEl = document.getElementById("spec-comment-form");
    var quoteEl = document.getElementById("spec-comment-form-quote");
    var textarea = document.getElementById("spec-comment-input");
    var floatBtn = document.getElementById("spec-comment-float-btn");
    if (!formEl || !textarea) return;

    if (quoteEl) quoteEl.textContent = truncate(pendingSelection.text, 200);
    textarea.value = "";

    if (floatBtn) {
      formEl.style.top = floatBtn.style.top;
      formEl.style.left = floatBtn.style.left;
      floatBtn.hidden = true;
    }
    formEl.hidden = false;
    textarea.focus();
  }

  function hideCommentForm() {
    var formEl = document.getElementById("spec-comment-form");
    if (formEl) formEl.hidden = true;
  }

  function clearSelectionNative() {
    if (window.getSelection) {
      var sel = window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    }
  }

  function submitComment() {
    if (!pendingSelection) return;
    var textarea = document.getElementById("spec-comment-input");
    var text = textarea ? textarea.value.trim() : "";
    if (!text) {
      if (textarea) textarea.focus();
      return;
    }
    var block = pendingSelection.block;
    var comment = {
      id: "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      quote: pendingSelection.text,
      sectionId: block.id || "",
      sectionTitle: getSectionTitle(block),
      text: text,
      createdAt: new Date().toISOString()
    };
    comments.push(comment);
    saveComments();
    var ok = applyMarkForComment(comment);
    orphanedIds[comment.id] = !ok;
    renderCommentList();
    hideCommentForm();
    pendingSelection = null;
    clearSelectionNative();
  }

  function deleteComment(commentId) {
    comments = comments.filter(function (c) { return c.id !== commentId; });
    saveComments();
    // P2c：整頁拆掉全部 mark 再對剩餘 comments 重建，而非只對這一則 commentId
    // 做局部替換——避免巢狀 mark 時外層攤平連帶吃掉尚未刪除的內層標記
    // （reapplyAllMarks() 內部會重置並重算 orphanedIds，取代原本的
    // \`delete orphanedIds[commentId]\`）
    removeAllMarks();
    reapplyAllMarks();
    renderCommentList();
  }

  /* ---- 匯出 Markdown（Requirement「評論一鍵匯出」；審查進度摘要一併附上） ---- */

  // review-fix P2b：引文預設用 blockquote（"> " 前綴，多行以 "\\n> " 延續延伸）。
  // 若引文本身含 code fence 記號（\`\`\`），逐行加 "> " 前綴仍可能讓引文內部
  // 原有的 fence 標記與外層結構混在一起；改用一個比引文內最長連續反引號還長
  // 的 fence 整段包住，確保原始內容裡的 \`\`\` 不會被誤判成提前結束的 fence。
  function renderQuoteBlock(quote) {
    quote = quote || "";
    if (quote.indexOf("\`\`\`") === -1) {
      return "> " + quote.replace(/\\n/g, "\\n> ");
    }
    var longestRun = 0;
    var runs = quote.match(/\`+/g) || [];
    runs.forEach(function (run) {
      if (run.length > longestRun) longestRun = run.length;
    });
    var fenceLen = Math.max(4, longestRun + 1);
    var fence = new Array(fenceLen + 1).join("\`");
    return fence + "\\n" + quote + "\\n" + fence;
  }

  // review-fix P2b：匯出的 sink 是剪貼簿／已全選的 <textarea>，兩者都不是
  // HTML 解析情境（貼回 Claude session 或任何純文字/Markdown 環境）——沿用
  // 面板顯示用的 escapeHtml() 只會讓貼出去的內容變成「&lt;script&gt;」這種
  // 給人看的 entity 字面，不是原文。因此本函式一律輸出原始文字，不跳脫；
  // 面板 innerHTML 路徑（renderCommentList()）維持 escapeHtml() 不變，因為
  // 那裡的 sink 才是真正的 HTML 解析情境。conventions.md「跳脫慣例延伸」
  // 一節「匯出也套用 escapeHtml」的舊決策記載已改寫為「依 sink 跳脫」。
  function buildExportMarkdown() {
    var changeName = CHANGE_NAME;
    var lines = [];
    lines.push("# Spec-viewer 審查評論匯出 — " + changeName);
    lines.push("");
    lines.push(
      "> 這是對 change \`" + changeName + "\` 的審查評論。" +
      "請 AI 依下列各條評論，修訂 \`" + changeName +
      "\` 對應的 artifacts 檔案（proposal.md／design.md／tasks.md／" +
      "specs/<capability>/spec.md）。"
    );
    lines.push("");
    lines.push("## 評論（" + comments.length + " 筆）");
    lines.push("");

    if (!comments.length) {
      lines.push("（本次匯出無評論）");
    } else {
      var sorted = comments.slice().sort(function (a, b) {
        return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1;
      });
      sorted.forEach(function (c, i) {
        var artifactFile = inferArtifactFile(c.sectionId);
        var title = c.sectionTitle || c.sectionId || "";
        // P2d：每條記錄各自附一次 change 名（不只依賴文首的指令標頭），單條
        // 評論被摘出、脫離匯出全文脈絡時仍看得出屬於哪個 change
        lines.push("### " + (i + 1) + ". " + title + "（" + artifactFile + "） · change: " + changeName);
        lines.push("");
        lines.push(renderQuoteBlock(c.quote));
        lines.push("");
        lines.push(c.text);
        lines.push("");
      });
    }

    lines.push("## 審查進度");
    lines.push("");
    var groups = getReviewGroups();
    var checkedCount = groups.filter(function (g) { return g.checked; }).length;
    lines.push("已審：" + checkedCount + " / " + groups.length);
    lines.push("");
    groups.forEach(function (g) {
      lines.push("- [" + (g.checked ? "x" : " ") + "] " + g.label);
    });
    lines.push("");
    lines.push("未審清單：");
    var unreviewed = groups.filter(function (g) { return !g.checked; });
    if (!unreviewed.length) {
      lines.push("（全部已審）");
    } else {
      unreviewed.forEach(function (g) { lines.push("- " + g.label); });
    }

    return lines.join("\\n");
  }

  function showExportResult(msg) {
    var el = document.getElementById("spec-comment-export-result");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function showExportFallbackModal(markdown) {
    var modal = document.getElementById("spec-comment-modal");
    var textarea = document.getElementById("spec-comment-modal-textarea");
    if (!modal || !textarea) return;
    textarea.value = markdown;
    modal.hidden = false;
    textarea.focus();
    textarea.select();
  }

  function exportComments() {
    var markdown = buildExportMarkdown();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(markdown).then(
        function () {
          showExportResult("已複製到剪貼簿（" + comments.length + " 筆評論）");
        },
        function () {
          showExportFallbackModal(markdown);
          showExportResult("剪貼簿寫入失敗，已顯示可複製的文字區塊");
        }
      );
    } else {
      showExportFallbackModal(markdown);
      showExportResult("此環境不支援剪貼簿 API，已顯示可複製的文字區塊");
    }
  }

  /* ---- 存成檔案（change comment-downloads-readback）----
     Artifact runtime downloads capability：window.claude.downloads 存在時才
     現形（按鈕以 hidden 出廠，HTML 常數維持靜態、確定性不受影響）。sink 是
     檔案內容（純文字，非 HTML 解析情境），與剪貼簿 sink 同級——輸出
     buildExportMarkdown() 原文不跳脫，兩路徑逐字相同。 ---- */

  function sanitizedSaveFilename() {
    var base = (CHANGE_NAME || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      // 檔名長度防呆：runtime 對 >512 字元檔名回 bad_request，且常見檔案系統
      // 上限 255 bytes；截斷後再去尾 dash 保持形狀
      .slice(0, 120)
      .replace(/-+$/, "");
    return "spec-comments-" + (base || "unknown-change") + ".md";
  }

  function saveCommentsFile() {
    var dl = window.claude && window.claude.downloads;
    if (!dl) return;
    var filename = sanitizedSaveFilename();
    dl.save({ filename: filename, data: buildExportMarkdown() }).then(
      function () {
        showExportResult(
          "已存成檔案 " + filename + "（" + comments.length +
          " 筆評論）——回 Claude Code 說「讀回評論」即可"
        );
      },
      function (err) {
        var code = err && err.code;
        if (code === "declined") {
          // 型別定義明言 declined 絕不自動重試
          showExportResult("已取消存檔");
        } else if (code === "rate_limited") {
          showExportResult("已有確認框開啟或請求過密，稍後再試");
        } else if (code === "bad_request" || code === "transform_error") {
          showExportFallbackModal(buildExportMarkdown());
          showExportResult("存檔請求無效，已顯示可複製的文字區塊");
        } else if (code === "too_large") {
          // 可恢復：內容大小所致，刪減評論後仍可再存——不藏按鈕，給可複製退路
          showExportFallbackModal(buildExportMarkdown());
          showExportResult("內容超過存檔大小上限，已顯示可複製的文字區塊");
        } else {
          // unavailable / not_granted / capability_* / 未知 code：本頁存檔
          // 不可用，收起入口、指向剪貼簿路徑
          var btn = document.getElementById("spec-comment-save-btn");
          if (btn) btn.hidden = true;
          showExportResult("此環境無法存檔，請改用「匯出評論為 Markdown」");
        }
      }
    );
  }

  /* ---- 事件綁定 ---- */

  document.addEventListener("mouseup", onSelectionMaybeChanged);
  document.addEventListener("touchend", onSelectionMaybeChanged);
  document.addEventListener("keyup", function (ev) {
    if (ev.shiftKey || ev.key === "Shift") onSelectionMaybeChanged();
  });

  var floatBtnEl = document.getElementById("spec-comment-float-btn");
  if (floatBtnEl) {
    floatBtnEl.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
    floatBtnEl.addEventListener("click", openCommentForm);
  }

  var formEl = document.getElementById("spec-comment-form");
  if (formEl) {
    formEl.addEventListener("submit", function (ev) {
      ev.preventDefault();
      submitComment();
    });
    var cancelBtn = document.getElementById("spec-comment-form-cancel");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        hideCommentForm();
        pendingSelection = null;
      });
    }
  }

  var commentToggle = document.getElementById("spec-comment-toggle");
  var commentPanel = document.getElementById("spec-comment-panel");
  if (commentToggle && commentPanel) {
    commentToggle.addEventListener("click", function () {
      var open = commentPanel.classList.toggle("open");
      commentToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
  var panelCloseBtn = document.getElementById("spec-comment-panel-close");
  if (panelCloseBtn && commentPanel && commentToggle) {
    panelCloseBtn.addEventListener("click", function () {
      commentPanel.classList.remove("open");
      commentToggle.setAttribute("aria-expanded", "false");
    });
  }

  var listEl = document.getElementById("spec-comment-list");
  if (listEl) {
    listEl.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t && t.nodeType !== 1) t = t.parentElement;
      if (!t || typeof t.closest !== "function") return;
      var jumpBtn = t.closest(".spec-comment-jump");
      if (jumpBtn) {
        jumpToComment(jumpBtn.getAttribute("data-comment-id"));
        return;
      }
      var delBtn = t.closest(".spec-comment-delete");
      if (delBtn) {
        deleteComment(delBtn.getAttribute("data-comment-id"));
      }
    });
  }

  var exportBtn = document.getElementById("spec-comment-export-btn");
  if (exportBtn) exportBtn.addEventListener("click", exportComments);

  var saveBtn = document.getElementById("spec-comment-save-btn");
  if (saveBtn && window.claude && window.claude.downloads) {
    saveBtn.hidden = false;
    saveBtn.addEventListener("click", saveCommentsFile);
  }

  var modalCloseBtn = document.getElementById("spec-comment-modal-close");
  var modalEl = document.getElementById("spec-comment-modal");
  if (modalCloseBtn && modalEl) {
    modalCloseBtn.addEventListener("click", function () { modalEl.hidden = true; });
  }

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    if (modalEl && !modalEl.hidden) { modalEl.hidden = true; return; }
    if (isCommentFormOpen()) {
      hideCommentForm();
      pendingSelection = null;
      return;
    }
    hideFloatButton();
  });

  /* ---- 初始化 ---- */

  reapplyAllMarks();
  renderCommentList();
  initReviewCheckboxes();
  updateReviewProgress();
})();
</script>`;
