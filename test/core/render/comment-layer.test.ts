import { describe, it, expect } from 'vitest';
import * as vm from 'node:vm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';

import {
  COMMENT_LAYER_STYLE,
  COMMENT_LAYER_HTML,
  COMMENT_LAYER_SCRIPT,
} from '../../../src/core/render/comment-layer.js';
import { renderChangeHtml } from '../../../src/core/render/html.js';
import type { SchemaYaml } from '../../../src/core/artifact-graph/types.js';

/**
 * 評論層行為測試（change `port-comment-layer-to-cli`）。
 *
 * 作法沿用 skill 端既有的離線 DOM 測試（`odoo-claude-code/deploy/templates/html/
 * tests/run-tests.js`）：把**真正要出貨的** script 常數放進 Node 的 `vm` context，
 * 對著 `fakedom.cjs` 模擬的 DOM 實跑「選取 → 評論 → 標記 → 匯出 → 刪除」的完整
 * 鏈路。刻意不維護一份手抄副本——測的是會被渲染進 viewer 的那一份。
 *
 * 為什麼不是 jsdom：評論層的核心是 Selection/Range 操作，jsdom 對這塊支援不完整
 * （skill 端就是因此才寫了 fakedom）。
 */

const require_ = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { FakeElement, FakeText, createFakeDocument } = require_('./fakedom.cjs') as any;

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 去掉 HTML 註解——BLOCK 標記註解裡有 `<script>` 這種字面文字，會讓「有沒有
 * script 元素」的判斷誤判。 */
function withoutHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, '');
}

/** 去掉 JS 行註解——移植進來的說明會提到 `document.title`（在講「刻意不用它」），
 * 那是文件不是程式碼。 */
function withoutLineComments(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
}

/** 從常數剝出 `<script>` 內的 JS 原始碼。 */
function scriptSource(): string {
  const m = /<script>([\s\S]*?)<\/script>/.exec(COMMENT_LAYER_SCRIPT);
  if (!m) throw new Error('COMMENT_LAYER_SCRIPT 內找不到 <script> 區塊');
  return m[1];
}

function makeMapLocalStorage() {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

function el(tag: string, attrs: Record<string, string> = {}): any {
  const e = new FakeElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'id') e.id = v;
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  return e;
}

function text(v: string): any {
  return new FakeText(v);
}

interface Page {
  doc: any;
  refs: Record<string, any>;
  storage: ReturnType<typeof makeMapLocalStorage>;
  clipboardWrites: string[];
  saveCalls: Array<{ filename: string; data: string }>;
  setSelection: (s: any) => void;
  submitVia: (selText: string, range: any, commentText: string) => void;
}

function makeRange(startNode: any, endNode: any): any {
  return {
    startContainer: startNode,
    endContainer: endNode,
    getBoundingClientRect: () => ({ bottom: 100, left: 50, width: 40, height: 16 }),
  };
}

function makeSelection(textValue: string, range: any): any {
  return {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => textValue,
    getRangeAt: () => range,
    removeAllRanges() {
      this.rangeCount = 0;
    },
  };
}

/**
 * 用程式建一份最小 viewer 頁（結構對應 renderer 實際輸出的 id/class），掛上評論層
 * HTML 對應的節點，然後在 vm 裡執行評論層 script。
 */
function bootPage(
  options: {
    changeName?: string | null;
    localStorage?: ReturnType<typeof makeMapLocalStorage>;
    clipboard?: 'ok' | 'fail' | 'absent';
    // downloads capability stub（change comment-downloads-readback）：
    // 'absent'＝window.claude 無 downloads 成員；'ok'＝save 成功；
    // 其餘值＝以該 error code reject
    // T-337：'legacy-member'＝只有舊式 window.claude.downloads 成員、use 回 null；
    // 'use-rejects'＝use() reject；'no-claude'＝頁面根本沒有 window.claude
    downloads?:
      | 'absent' | 'ok' | 'declined' | 'rate_limited' | 'bad_request' | 'too_large' | 'unavailable'
      | 'legacy-member' | 'use-rejects' | 'use-throws' | 'no-claude';
  } = {}
): Page {
  const { changeName = 'demo-change', clipboard = 'ok' } = options;
  const storage = options.localStorage ?? makeMapLocalStorage();

  const root = el('div', { class: 'spec-viewer' });
  if (changeName !== null) root.setAttribute('data-change-name', changeName);

  const main = el('main', { class: 'spec-main' });
  root.appendChild(main);

  // proposal 卡（含帶「已審」checkbox 的 h3，結構對應 sectionHeading() 的輸出）
  const proposal = el('section', { id: 'proposal', class: 'spec-card' });
  const h3 = el('h3');
  h3.appendChild(text('Proposal'));
  const reviewLabel = el('label', { class: 'spec-review-check' });
  const cbProposal = el('input', { class: 'spec-review-checkbox', type: 'checkbox' });
  cbProposal.setAttribute('data-review-key', 'proposal');
  cbProposal.setAttribute('data-review-label', 'Proposal');
  reviewLabel.appendChild(cbProposal);
  reviewLabel.appendChild(text(' 已審'));
  h3.appendChild(reviewLabel);
  proposal.appendChild(h3);
  const pText = el('p');
  pText.appendChild(text('alpha beta gamma delta'));
  proposal.appendChild(pText);
  main.appendChild(proposal);

  // 第二個區塊：requirement（跨區塊選取要被拒絕）
  const req = el('div', { id: 'req-cap-1', class: 'spec-requirement' });
  const h4 = el('h4');
  h4.appendChild(text('Requirement: 示例'));
  req.appendChild(h4);
  const reqP = el('p');
  reqP.appendChild(text('epsilon zeta eta theta'));
  req.appendChild(reqP);
  main.appendChild(req);

  // 評論層 HTML 對應的節點（程式建構，id 對應 COMMENT_LAYER_HTML 內的宣告）
  const panel = el('aside', { id: 'spec-comment-panel', class: 'spec-comment-panel' });
  const privacy = el('p', { id: 'spec-comment-privacy-note' });
  privacy.appendChild(text('評論存在瀏覽器本機，勿貼入密鑰或機密'));
  panel.appendChild(privacy);
  const storageNote = el('p', { id: 'spec-comment-storage-note' });
  storageNote.hidden = true;
  panel.appendChild(storageNote);
  const progress = el('p', { id: 'spec-comment-progress' });
  panel.appendChild(progress);
  const exportBtn = el('button', { id: 'spec-comment-export-btn' });
  panel.appendChild(exportBtn);
  const saveBtn = el('button', { id: 'spec-comment-save-btn' });
  saveBtn.hidden = true;
  panel.appendChild(saveBtn);
  const exportResult = el('p', { id: 'spec-comment-export-result' });
  exportResult.hidden = true;
  panel.appendChild(exportResult);
  const list = el('ul', { id: 'spec-comment-list' });
  panel.appendChild(list);
  root.appendChild(panel);

  const toggle = el('button', { id: 'spec-comment-toggle' });
  const countSpan = el('span', { id: 'spec-comment-count' });
  toggle.appendChild(countSpan);
  root.appendChild(toggle);

  const floatBtn = el('button', { id: 'spec-comment-float-btn' });
  floatBtn.hidden = true;
  root.appendChild(floatBtn);

  const form = el('form', { id: 'spec-comment-form' });
  form.hidden = true;
  const formQuote = el('blockquote', { id: 'spec-comment-form-quote' });
  form.appendChild(formQuote);
  const formInput = el('textarea', { id: 'spec-comment-input' });
  form.appendChild(formInput);
  const formCancel = el('button', { id: 'spec-comment-form-cancel' });
  form.appendChild(formCancel);
  root.appendChild(form);

  const modal = el('div', { id: 'spec-comment-modal' });
  modal.hidden = true;
  const modalTextarea = el('textarea', { id: 'spec-comment-modal-textarea' });
  modal.appendChild(modalTextarea);
  const modalClose = el('button', { id: 'spec-comment-modal-close' });
  modal.appendChild(modalClose);
  root.appendChild(modal);

  // fakedom 的 querySelector 只走子孫、不含根節點本身；包一層容器當 document 根
  const docRoot = el('div');
  docRoot.appendChild(root);
  const doc = createFakeDocument(docRoot);

  const clipboardWrites: string[] = [];
  let clipboardImpl: any;
  if (clipboard === 'ok') {
    clipboardImpl = { writeText: (t: string) => (clipboardWrites.push(t), Promise.resolve()) };
  } else if (clipboard === 'fail') {
    clipboardImpl = { writeText: () => Promise.reject(new Error('denied')) };
  } else {
    clipboardImpl = undefined;
  }

  let selectionState: any = null;
  const win: any = {
    innerWidth: 1200,
    localStorage: storage.api,
    getSelection: () => selectionState,
  };

  // downloads capability stub（runtime contract 0.2.x，T-337）：window.claude 只帶
  // use，namespace 由 use("downloads") 非同步 resolve（frozen），不可用時 resolve
  // null。'legacy-member' 另掛舊式 window.claude.downloads，驗證評論層不讀成員。
  const saveCalls: Array<{ filename: string; data: string }> = [];
  const downloads = options.downloads ?? 'absent';
  const downloadsNs = Object.freeze({
    save: (req: { filename: string; data: string }) => {
      saveCalls.push({ filename: req.filename, data: req.data });
      return downloads === 'ok'
        ? Promise.resolve({ status: 'saved' })
        : Promise.reject({ code: downloads, message: downloads });
    },
  });
  if (downloads !== 'no-claude') {
    win.claude = {
      use: (name: string) => {
        if (downloads === 'use-throws') throw new Error('use exploded synchronously');
        if (downloads === 'use-rejects') return Promise.reject(new Error('module failed to load'));
        const served = name === 'downloads' && downloads !== 'absent' && downloads !== 'legacy-member';
        return Promise.resolve(served ? downloadsNs : null);
      },
    };
    if (downloads === 'legacy-member') win.claude.downloads = downloadsNs;
  }

  const ctx = vm.createContext({
    document: doc,
    window: win,
    navigator: { clipboard: clipboardImpl },
    NodeFilter: { SHOW_TEXT: 4 },
    console,
    Date,
    Math,
    JSON,
  });
  vm.runInContext(scriptSource(), ctx, { filename: 'comment-layer-script' });

  const refs = {
    root, main, proposal, pText, req, reqP, panel, privacy, storageNote, progress,
    exportBtn, saveBtn, exportResult, list, toggle, countSpan, floatBtn, form, formQuote,
    formInput, formCancel, modal, modalTextarea, modalClose, cbProposal,
  };

  return {
    doc,
    refs,
    storage,
    clipboardWrites,
    saveCalls,
    setSelection: (s) => (selectionState = s),
    submitVia(selText, range, commentText) {
      this.setSelection(makeSelection(selText, range));
      doc.dispatch('mouseup', {});
      refs.floatBtn.dispatch('click', {});
      refs.formInput.value = commentText;
      refs.form.dispatch('submit', { preventDefault() {} });
    },
  };
}

function marksIn(node: any): any[] {
  const acc: any[] = [];
  (function walk(n: any) {
    (n.childNodes || []).forEach((c: any) => {
      if (c.nodeType === 1) {
        if (c.tagName === 'MARK') acc.push(c);
        walk(c);
      }
    });
  })(node);
  return acc;
}

// ── 結構審計（沿用本 repo 其他測試的作法：審實際宣告的標籤/屬性，不掃文字）──
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>/g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/g;
const PANEL_ALLOWED_TAGS = new Set(['li', 'button', 'blockquote', 'p', 'div', 'span']);
const PANEL_ALLOWED_ATTRS = new Set(['class', 'data-comment-id', 'type', 'aria-label']);

function auditMarkup(html: string): { rogueTags: string[]; rogueAttrs: string[] } {
  const tags: string[] = [];
  const attrs: string[] = [];
  for (const m of html.matchAll(TAG_RE)) {
    tags.push(m[1].toLowerCase());
    for (const a of (m[2] ?? '').matchAll(ATTR_RE)) attrs.push(a[1].toLowerCase());
  }
  return {
    rogueTags: tags.filter((t) => !PANEL_ALLOWED_TAGS.has(t)),
    rogueAttrs: attrs.filter((a) => !PANEL_ALLOWED_ATTRS.has(a)),
  };
}

describe('comment layer — ported constants', () => {
  it('ships all three separable blocks', () => {
    // CSS 常數必須自帶 <style> 包裹——裸 CSS 進 body 會被當純文字渲染在頁面上
    // （實機 file:// 驗證抓到的 bug）
    expect(COMMENT_LAYER_STYLE.trimStart().startsWith('<style>')).toBe(true);
    expect(COMMENT_LAYER_STYLE.trimEnd().endsWith('</style>')).toBe(true);
    expect(COMMENT_LAYER_STYLE).toContain('.spec-comment-mark');
    expect(COMMENT_LAYER_STYLE).toContain('.spec-review-check');
    expect(COMMENT_LAYER_HTML).toContain('spec-comment-privacy-note');
    expect(COMMENT_LAYER_SCRIPT).toContain('<script>');
  });

  it('carries no duplicate of the navigation script', () => {
    expect(withoutHtmlComments(COMMENT_LAYER_HTML)).not.toMatch(/<script/);
    expect(COMMENT_LAYER_SCRIPT).not.toContain('function revealTarget');
  });

  it('scopes storage on data-change-name, never document.title', () => {
    expect(COMMENT_LAYER_SCRIPT).toContain('getAttribute("data-change-name")');
    expect(withoutLineComments(scriptSource())).not.toContain('document.title');
  });

  it('keeps the always-on storage-boundary notice', () => {
    expect(COMMENT_LAYER_HTML).toMatch(/spec-comment-privacy-note/);
    expect(COMMENT_LAYER_HTML).toMatch(/勿貼入密鑰|機密/);
  });
});

describe('comment layer — select → comment → mark（4.1）', () => {
  it('adds a comment on a single-block selection: mark appears, panel lists it', () => {
    const p = bootPage();
    const tn = p.refs.pText.childNodes[0];
    p.submitVia('beta gamma', makeRange(tn, tn), '這段要改');

    const marks = marksIn(p.refs.proposal);
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('beta gamma');
    expect(marks[0].getAttribute('data-comment-id')).toMatch(/^c-/);
    expect(p.refs.list.innerHTML).toContain('這段要改');
    expect(p.refs.countSpan.textContent).toBe('1');
    // 持久化：分域 key 內含 change 名
    expect(p.storage.store.has('spec-viewer:demo-change:comments')).toBe(true);
  });

  it('rejects a cross-block selection: no float button, no comment', () => {
    const p = bootPage();
    const t1 = p.refs.pText.childNodes[0];
    const t2 = p.refs.reqP.childNodes[0];
    p.setSelection(makeSelection('delta epsilon', makeRange(t1, t2)));
    p.doc.dispatch('mouseup', {});
    expect(p.refs.floatBtn.hidden).toBe(true);
    expect(marksIn(p.refs.root).length).toBe(0);
  });

  it('deletes a comment and restores the original text', () => {
    const p = bootPage();
    const tn = p.refs.pText.childNodes[0];
    p.submitVia('beta gamma', makeRange(tn, tn), 'note-1');
    const id = marksIn(p.refs.proposal)[0].getAttribute('data-comment-id');

    // 由面板的刪除鈕觸發（closest('.spec-comment-delete') 路徑）
    const delBtn = el('button', { class: 'spec-comment-delete' });
    delBtn.setAttribute('data-comment-id', id);
    p.refs.list.appendChild(delBtn);
    p.refs.list.dispatch('click', { target: delBtn });

    expect(marksIn(p.refs.proposal).length).toBe(0);
    expect(p.refs.pText.textContent).toBe('alpha beta gamma delta');
  });

  it('deleting one of two nested/overlapping comments keeps the other mark（P2c）', () => {
    const p = bootPage();
    const tn = p.refs.pText.childNodes[0];
    p.submitVia('beta gamma delta', makeRange(tn, tn), 'outer');
    // 第二則的引文落在第一則 mark 的文字內 → 巢狀
    const innerTn = marksIn(p.refs.proposal)[0].childNodes[0];
    p.submitVia('gamma', makeRange(innerTn, innerTn), 'inner');

    const before = marksIn(p.refs.proposal);
    expect(before.length).toBeGreaterThanOrEqual(2);
    const outerId = before[0].getAttribute('data-comment-id');

    const delBtn = el('button', { class: 'spec-comment-delete' });
    delBtn.setAttribute('data-comment-id', outerId);
    p.refs.list.appendChild(delBtn);
    p.refs.list.dispatch('click', { target: delBtn });

    // 內層那則的標記必須存活，且原文完整
    const after = marksIn(p.refs.proposal);
    expect(after.length).toBe(1);
    expect(after[0].textContent).toBe('gamma');
    expect(p.refs.proposal.textContent).toContain('alpha beta gamma delta');
  });
});

describe('comment layer — review checkboxes（4.2）', () => {
  it('persists a check under the change-scoped key and leaves content untouched', () => {
    const p = bootPage();
    const contentBefore = p.refs.proposal.textContent;
    p.refs.cbProposal.checked = true;
    p.refs.cbProposal.dispatch('change', {});
    expect(p.storage.store.get('spec-viewer:demo-change:reviewed')).toContain('"proposal":true');
    expect(p.refs.proposal.textContent).toBe(contentBefore);
    expect(p.refs.progress.textContent).toContain('已審 1 / 1');
  });

  it('restores checked state from storage on boot', () => {
    const storage = makeMapLocalStorage();
    storage.store.set('spec-viewer:demo-change:reviewed', JSON.stringify({ proposal: true }));
    const p = bootPage({ localStorage: storage });
    expect(p.refs.cbProposal.checked).toBe(true);
  });
});

describe('comment layer — export（4.3 / 3.2）', () => {
  it('writes markdown to the clipboard when available', () => {
    const p = bootPage();
    const tn = p.refs.pText.childNodes[0];
    p.submitVia('beta gamma', makeRange(tn, tn), '第一筆');
    p.refs.exportBtn.dispatch('click', {});
    expect(p.clipboardWrites.length).toBe(1);
    const md = p.clipboardWrites[0];
    expect(md).toContain('demo-change');
    expect(md).toContain('> beta gamma');
    expect(md).toContain('第一筆');
    expect(md).toContain('（proposal.md）');
  });

  it('falls back to a selectable modal when the clipboard write is rejected', async () => {
    const p = bootPage({ clipboard: 'fail' });
    const tn = p.refs.pText.childNodes[0];
    p.submitVia('beta', makeRange(tn, tn), 'x');
    p.refs.exportBtn.dispatch('click', {});
    await new Promise((r) => setImmediate(r)); // 等 promise rejection 的 fallback 分支
    expect(p.refs.modal.hidden).toBe(false);
    expect(p.refs.modalTextarea.value).toContain('> beta');
  });

  it('falls back immediately when no clipboard API exists — never silently', () => {
    const p = bootPage({ clipboard: 'absent' });
    p.refs.exportBtn.dispatch('click', {});
    expect(p.refs.modal.hidden).toBe(false);
    expect(p.refs.exportResult.hidden).toBe(false);
  });

  it('wraps a quote containing code fences in a longer fence（P2b）', () => {
    const p = bootPage();
    const fenceQuote = 'x ```js alert``` y';
    p.refs.pText.textContent = fenceQuote;
    const tn = p.refs.pText.childNodes[0];
    p.submitVia(fenceQuote, makeRange(tn, tn), 'has fence');
    p.refs.exportBtn.dispatch('click', {});
    const md = p.clipboardWrites[0];
    // 引文被 ≥4 個反引號的 fence 包住，內部的 ``` 不會提前結束區塊
    expect(md).toMatch(/````\n[\s\S]*```[\s\S]*\n````/);
  });

  it('keeps raw text in the export (plain-text sink, no HTML entities)', () => {
    const p = bootPage();
    const tn = p.refs.pText.childNodes[0];
    p.submitVia('beta', makeRange(tn, tn), '<b>不是標籤</b> & 管線|符');
    p.refs.exportBtn.dispatch('click', {});
    const md = p.clipboardWrites[0];
    expect(md).toContain('<b>不是標籤</b> & 管線|符'); // 原文
    expect(md).not.toContain('&lt;b&gt;'); // 不是 entity
  });
});

describe('comment layer — storage scoping（4.4）', () => {
  it('keeps two change names in disjoint keys', () => {
    const shared = makeMapLocalStorage();
    const a = bootPage({ changeName: 'change-a', localStorage: shared });
    const tnA = a.refs.pText.childNodes[0];
    a.submitVia('beta', makeRange(tnA, tnA), 'from-a');

    const b = bootPage({ changeName: 'change-b', localStorage: shared });
    expect(b.refs.list.innerHTML).not.toContain('from-a');
    expect(shared.store.has('spec-viewer:change-a:comments')).toBe(true);
    expect(shared.store.has('spec-viewer:change-b:comments')).toBe(false);
  });

  it('missing data-change-name → in-memory only, zero storage keys', () => {
    const p = bootPage({ changeName: null });
    const tn = p.refs.pText.childNodes[0];
    p.submitVia('beta', makeRange(tn, tn), 'ephemeral');
    // 評論功能仍可用（面板有列出）……
    expect(p.refs.list.innerHTML).toContain('ephemeral');
    // ……但一個 key 都不落地，且降級提示已顯示
    expect(p.storage.store.size).toBe(0);
    expect(p.refs.storageNote.hidden).toBe(false);
  });
});

describe('comment layer — comment text is untrusted input（3.1）', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<div onclick="x">hi</div>',
    '&lt;script&gt;walk-back&lt;/script&gt;',
    '<!--!><script>alert(1)</script>--!>',
    '" onmouseover="alert(1)',
  ];

  it.each(payloads)('panel innerHTML declares no rogue element/attribute for %s', (payload) => {
    const p = bootPage();
    const tn = p.refs.pText.childNodes[0];
    p.submitVia('beta gamma', makeRange(tn, tn), payload);
    const { rogueTags, rogueAttrs } = auditMarkup(p.refs.list.innerHTML);
    expect(rogueTags).toEqual([]);
    expect(rogueAttrs).toEqual([]);
    // 內容仍在（跳脫呈現，不是被吞掉）
    expect(p.refs.list.innerHTML.length).toBeGreaterThan(0);
  });

  it('a hostile quote loaded back from storage is escaped in the panel', () => {
    const storage = makeMapLocalStorage();
    storage.store.set(
      'spec-viewer:demo-change:comments',
      JSON.stringify([
        {
          id: 'c-evil',
          quote: '<img src=x onerror=alert(1)>',
          sectionId: 'proposal',
          sectionTitle: '<script>t</script>',
          text: '<svg onload=alert(1)>',
          createdAt: 'not-a-date',
        },
      ])
    );
    const p = bootPage({ localStorage: storage });
    const { rogueTags, rogueAttrs } = auditMarkup(p.refs.list.innerHTML);
    expect(rogueTags).toEqual([]);
    expect(rogueAttrs).toEqual([]);
  });
});

describe('comment layer — data-change-name injection（3.3, renderer side）', () => {
  it('escapes a hostile change name in the root attribute', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-ccl-'));
    try {
      const changeDir = path.join(tempDir, 'x');
      fs.mkdirSync(changeDir, { recursive: true });
      fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# P\n', 'utf-8');
      const html = renderChangeHtml({
        changeDir,
        changeName: '"><script>alert(1)</script>',
        schema: { name: 't', version: 1, artifacts: [] } as SchemaYaml,
        artifactBody: true,
      });
      // 屬性值內只允許跳脫形式；不得因 change 名而多出可執行節點
      expect(html).toContain('data-change-name="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
      // Notes 開關必須在輸出裡——沒有它評論加得進去卻沒入口看（使用者實測抓到的缺漏）
      expect(html).toContain('id="spec-comment-toggle"');
      expect(html).toContain('id="spec-comment-count"');
      expect(html).toContain('id="spec-comment-panel"');
      // 數「真正的 script 元素」要成對剝除，不能數字面 <script> 字樣——script 的
      // JS 註解裡就含這字樣（本檔稍早的教訓）。成對剝除後恰好 2 個：導覽 + 評論層。
      let elementCount = 0;
      html.replace(/<script>[\s\S]*?<\/script>/g, () => {
        elementCount++;
        return '';
      });
      expect(elementCount).toBe(2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('comment layer — separability（5.1 靜態面）', () => {
  it('nav script and comment script reference none of each other', async () => {
    const { SPEC_VIEWER_NAV_SCRIPT } = await import('../../../src/core/render/html-template.js');
    // 導覽 script 完全不知道評論層的存在——移除評論層三段後它不會缺任何東西
    expect(SPEC_VIEWER_NAV_SCRIPT).not.toContain('spec-comment');
    expect(SPEC_VIEWER_NAV_SCRIPT).not.toContain('spec-review');
    // 反向：評論層不呼叫導覽的函式（去行註解——註解裡正是在講「不呼叫 revealTarget」）
    expect(withoutLineComments(scriptSource())).not.toContain('revealTarget');
  });
});

describe('comment layer — separability（5.1/5.2 的離線部分）', () => {
  it('boots and navigation targets survive add/delete cycles', () => {
    const p = bootPage();
    const tn = p.refs.pText.childNodes[0];
    p.submitVia('beta gamma', makeRange(tn, tn), 'n1');
    // 標記改動內文 DOM 後，區塊 id 仍可命中（scrollspy/錨點的前提）
    expect(p.doc.getElementById('proposal')).toBeTruthy();
    expect(p.doc.getElementById('req-cap-1')).toBeTruthy();
    const id = marksIn(p.refs.proposal)[0].getAttribute('data-comment-id');
    const delBtn = el('button', { class: 'spec-comment-delete' });
    delBtn.setAttribute('data-comment-id', id);
    p.refs.list.appendChild(delBtn);
    p.refs.list.dispatch('click', { target: delBtn });
    expect(p.doc.getElementById('proposal')).toBeTruthy();
    expect(p.refs.pText.textContent).toBe('alpha beta gamma delta');
  });
});

describe('存成檔案 — downloads capability（change comment-downloads-readback）', () => {
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  // claude.use("downloads") 非同步 resolve（契約保證不在首次同步執行內），
  // 按鈕在 resolve 後才現形——斷言前先讓 microtask 跑完
  const bootReady = async (options: Parameters<typeof bootPage>[0]) => {
    const page = bootPage(options);
    await flush();
    return page;
  };

  it('capability 缺席時按鈕維持 hidden，匯出行為不變', async () => {
    const p = await bootReady({});
    expect(p.refs.saveBtn.hidden).toBe(true);
    p.refs.exportBtn.dispatch('click', {});
    await flush();
    expect(p.clipboardWrites.length).toBe(1);
    expect(p.saveCalls.length).toBe(0);
  });

  it('按鈕不在首次同步執行內現形，claude.use resolve 後才出現（T-337）', async () => {
    const page = bootPage({ downloads: 'ok' });
    expect(page.refs.saveBtn.hidden).toBe(true);
    await flush();
    expect(page.refs.saveBtn.hidden).toBe(false);
  });

  it('只有舊式 window.claude.downloads 成員、use 回 null：按鈕維持 hidden（契約只保證 use）', async () => {
    const p = await bootReady({ downloads: 'legacy-member' });
    expect(p.refs.saveBtn.hidden).toBe(true);
    p.refs.saveBtn.dispatch('click', {});
    await flush();
    expect(p.saveCalls.length).toBe(0);
  });

  it('claude.use reject：按鈕維持 hidden、不拋錯', async () => {
    const p = await bootReady({ downloads: 'use-rejects' });
    expect(p.refs.saveBtn.hidden).toBe(true);
  });

  it('claude.use 同步拋錯：評論層照常啟動、按鈕維持 hidden', async () => {
    const p = await bootReady({ downloads: 'use-throws' });
    expect(p.refs.saveBtn.hidden).toBe(true);
    p.refs.exportBtn.dispatch('click', {});
    await flush();
    expect(p.clipboardWrites.length).toBe(1);
  });

  it('頁面無 window.claude（file:// 直開）：按鈕維持 hidden、匯出不受影響', async () => {
    const p = await bootReady({ downloads: 'no-claude' });
    expect(p.refs.saveBtn.hidden).toBe(true);
    p.refs.exportBtn.dispatch('click', {});
    await flush();
    expect(p.clipboardWrites.length).toBe(1);
  });

  it('capability 存在時按鈕現形；save 收到淨化檔名與逐字相同的 Markdown', async () => {
    const p = await bootReady({ downloads: 'ok' });
    expect(p.refs.saveBtn.hidden).toBe(false);
    p.refs.saveBtn.dispatch('click', {});
    await flush();
    expect(p.saveCalls.length).toBe(1);
    expect(p.saveCalls[0].filename).toBe('spec-comments-demo-change.md');
    expect(p.refs.exportResult.textContent).toContain('已存成檔案');
    p.refs.exportBtn.dispatch('click', {});
    await flush();
    expect(p.clipboardWrites[0]).toBe(p.saveCalls[0].data);
  });

  it('change 名淨化後為空時檔名用 unknown-change', async () => {
    const p = await bootReady({ downloads: 'ok', changeName: '純中文名稱' });
    p.refs.saveBtn.dispatch('click', {});
    await flush();
    expect(p.saveCalls[0].filename).toBe('spec-comments-unknown-change.md');
  });

  it('declined：提示已取消、不重試、不開 fallback modal', async () => {
    const p = await bootReady({ downloads: 'declined' });
    p.refs.saveBtn.dispatch('click', {});
    await flush();
    expect(p.saveCalls.length).toBe(1);
    expect(p.refs.exportResult.textContent).toContain('取消');
    expect(p.refs.modal.hidden).toBe(true);
    expect(p.refs.saveBtn.hidden).toBe(false);
  });

  it('bad_request：退回可全選複製的 fallback modal', async () => {
    const p = await bootReady({ downloads: 'bad_request' });
    p.refs.saveBtn.dispatch('click', {});
    await flush();
    expect(p.refs.modal.hidden).toBe(false);
    expect(p.refs.modalTextarea.value).toContain('Spec-viewer 審查評論匯出');
  });

  it('too_large：可恢復——不藏按鈕、退回 fallback modal', async () => {
    const p = await bootReady({ downloads: 'too_large' });
    p.refs.saveBtn.dispatch('click', {});
    await flush();
    expect(p.refs.saveBtn.hidden).toBe(false);
    expect(p.refs.modal.hidden).toBe(false);
    expect(p.refs.exportResult.textContent).toContain('上限');
  });

  it('超長 change 名的檔名被截斷到安全長度', async () => {
    const long = 'a'.repeat(300);
    const p = await bootReady({ downloads: 'ok', changeName: long });
    p.refs.saveBtn.dispatch('click', {});
    await flush();
    expect(p.saveCalls[0].filename.length).toBeLessThanOrEqual(140);
    expect(p.saveCalls[0].filename).toMatch(/^spec-comments-a+\.md$/);
  });

  it('截斷邊界落在 dash 時尾端連字號被清除', async () => {
    // 119 個 a + 非法字元（轉成 '-'）+ 更多字：截到 120 字元時第 120 位是 '-'
    const name = 'a'.repeat(119) + '!' + 'b'.repeat(50);
    const p = await bootReady({ downloads: 'ok', changeName: name });
    p.refs.saveBtn.dispatch('click', {});
    await flush();
    const base = p.saveCalls[0].filename.replace(/^spec-comments-/, '').replace(/\.md$/, '');
    expect(base.endsWith('-')).toBe(false);
    expect(base).toBe('a'.repeat(119));
  });

  it('unavailable：隱藏按鈕並指向剪貼簿路徑', async () => {
    const p = await bootReady({ downloads: 'unavailable' });
    p.refs.saveBtn.dispatch('click', {});
    await flush();
    expect(p.refs.saveBtn.hidden).toBe(true);
    expect(p.refs.exportResult.textContent).toContain('匯出');
  });
});
