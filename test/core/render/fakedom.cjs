"use strict";
/*
 * 極簡「離線 DOM 模擬」——不是完整瀏覽器實作，只實作 skeleton.html 評論層
 * `<script>`（見 conventions.md「評論層」一節、`BLOCK: 評論層 script` 標記）
 * 實際會用到的這一小組 DOM API（Node/Element/Text、TreeWalker、事件註冊、
 * 簡化版 innerHTML 解析、closest/querySelector 的簡化選擇器比對、
 * cloneNode 深複製）。用來讓真正要出貨的 <script> 原始碼在 Node 環境下實際
 * 跑一遍選取 → 評論 → 標記 → 匯出 → 刪除的完整鏈路，不需要真的開瀏覽器。
 */

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const VOID_TAGS = new Set(["BR", "IMG", "INPUT", "HR", "META", "LINK"]);

function parseSimpleSelector(sel) {
  sel = sel.trim();
  const m = /^([a-zA-Z0-9]*)((?:[.#][\w-]+)*)$/.exec(sel);
  if (!m) return null;
  const tag = m[1] ? m[1].toUpperCase() : null;
  const rest = m[2] || "";
  const classes = [];
  let id = null;
  const partRe = /([.#])([\w-]+)/g;
  let pm;
  while ((pm = partRe.exec(rest))) {
    if (pm[1] === ".") classes.push(pm[2]);
    else id = pm[2];
  }
  return { tag: tag, id: id, classes: classes };
}

function elementMatchesSimple(el, parsed) {
  if (!parsed) return false;
  if (parsed.tag && el.tagName !== parsed.tag) return false;
  if (parsed.id && el.id !== parsed.id) return false;
  for (const c of parsed.classes) {
    if (!el.classList.contains(c)) return false;
  }
  return true;
}

function matchesAny(el, selectorListStr) {
  const parts = selectorListStr.split(",").map((s) => parseSimpleSelector(s));
  return parts.some((p) => elementMatchesSimple(el, p));
}

class FakeText {
  constructor(value) {
    this.nodeType = TEXT_NODE;
    this.nodeValue = value;
    this.parentNode = null;
  }
  get textContent() {
    return this.nodeValue;
  }
  set textContent(v) {
    this.nodeValue = v;
  }
  get parentElement() {
    return this.parentNode;
  }
  cloneNode() {
    return new FakeText(this.nodeValue);
  }
}

function parseFragment(html) {
  const rootChildren = [];
  const stack = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/g;
  let lastIndex = 0;
  let m;
  function pushNode(node) {
    node.parentNode = stack.length ? stack[stack.length - 1] : null;
    if (stack.length) stack[stack.length - 1].childNodes.push(node);
    else rootChildren.push(node);
  }
  while ((m = tagRe.exec(html))) {
    if (m.index > lastIndex) {
      const text = html.slice(lastIndex, m.index);
      if (text) pushNode(new FakeText(text));
    }
    lastIndex = tagRe.lastIndex;
    if (m[4]) {
      if (stack.length) stack.pop();
    } else {
      const tag = m[1].toUpperCase();
      const attrStr = m[2] || "";
      const selfClosing = m[3] === "/";
      const el = new FakeElement(tag);
      const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s"'=<>`]+))?/g;
      let am;
      while ((am = attrRe.exec(attrStr))) {
        const name = am[1];
        const val = am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : am[2] || "";
        el.setAttribute(name, val);
      }
      pushNode(el);
      if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(el);
    }
  }
  if (lastIndex < html.length) {
    const text = html.slice(lastIndex);
    if (text) pushNode(new FakeText(text));
  }
  return rootChildren;
}

class FakeElement {
  constructor(tagName) {
    this.nodeType = ELEMENT_NODE;
    this.tagName = tagName.toUpperCase();
    this.id = "";
    this._classes = new Set();
    this._attrs = {};
    this.childNodes = [];
    this.parentNode = null;
    this._hidden = false;
    this._style = {};
    this._eventHandlers = {};
    this.value = "";
    this.checked = false;
  }
  get hidden() {
    return this._hidden;
  }
  set hidden(v) {
    this._hidden = !!v;
  }
  get style() {
    return this._style;
  }
  get children() {
    return this.childNodes.filter((n) => n.nodeType === ELEMENT_NODE);
  }
  get classList() {
    const self = this;
    return {
      contains: (c) => self._classes.has(c),
      add: (c) => self._classes.add(c),
      remove: (c) => self._classes.delete(c),
      toggle: (c) => {
        if (self._classes.has(c)) {
          self._classes.delete(c);
          return false;
        }
        self._classes.add(c);
        return true;
      },
    };
  }
  get className() {
    return Array.from(this._classes).join(" ");
  }
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  getAttribute(name) {
    if (name === "class") return this.className;
    if (name === "id") return this.id;
    return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
  }
  setAttribute(name, val) {
    if (name === "class") {
      this.className = val;
      return;
    }
    if (name === "id") {
      this.id = val;
      return;
    }
    this._attrs[name] = String(val);
  }
  removeAttribute(name) {
    delete this._attrs[name];
  }
  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node, ref) {
    node.parentNode = this;
    if (ref == null) {
      this.childNodes.push(node);
    } else {
      const i = this.childNodes.indexOf(ref);
      this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, node);
    }
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  replaceChild(newNode, oldNode) {
    const i = this.childNodes.indexOf(oldNode);
    if (i >= 0) {
      this.childNodes[i] = newNode;
      newNode.parentNode = this;
      oldNode.parentNode = null;
    }
    return oldNode;
  }
  normalize() {
    for (let i = this.childNodes.length - 1; i > 0; i--) {
      const a = this.childNodes[i - 1];
      const b = this.childNodes[i];
      if (a.nodeType === TEXT_NODE && b.nodeType === TEXT_NODE) {
        a.nodeValue += b.nodeValue;
        this.childNodes.splice(i, 1);
      }
    }
  }
  get textContent() {
    return this.childNodes.map((n) => (n.nodeType === TEXT_NODE ? n.nodeValue : n.textContent)).join("");
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== "") {
      const t = new FakeText(v);
      t.parentNode = this;
      this.childNodes.push(t);
    }
  }
  get innerHTML() {
    return this._innerHTML || "";
  }
  set innerHTML(v) {
    this._innerHTML = v;
    const nodes = parseFragment(v);
    this.childNodes = nodes;
    nodes.forEach((n) => (n.parentNode = this));
  }
  addEventListener(type, handler) {
    (this._eventHandlers[type] = this._eventHandlers[type] || []).push(handler);
  }
  removeEventListener() {}
  dispatch(type, evObj) {
    (this._eventHandlers[type] || []).forEach((h) => h(evObj));
  }
  closest(selectorListStr) {
    let el = this;
    while (el && el.nodeType === ELEMENT_NODE) {
      if (matchesAny(el, selectorListStr)) return el;
      el = el.parentNode;
    }
    return null;
  }
  contains(node) {
    let n = node;
    while (n) {
      if (n === this) return true;
      n = n.parentNode;
    }
    return false;
  }
  // 深複製（review-fix P1 的 cleanSectionTitleText() 需要 cloneNode(true)）：
  // 複製 tag/id/class/attrs 與（deep 時）整棵子樹，複製品的 parentNode 全部
  // 重新指向複製後的樹，不共用原樹的節點物件，因此對 clone 動 removeChild
  // 不會影響原始頁面 DOM。
  cloneNode(deep) {
    const clone = new FakeElement(this.tagName);
    clone.id = this.id;
    clone._classes = new Set(this._classes);
    clone._attrs = Object.assign({}, this._attrs);
    clone._hidden = this._hidden;
    clone.value = this.value;
    clone.checked = this.checked;
    if (deep) {
      this.childNodes.forEach((child) => {
        const childClone = child.cloneNode(true);
        childClone.parentNode = clone;
        clone.childNodes.push(childClone);
      });
    }
    return clone;
  }
  focus() {}
  select() {}
  scrollIntoView() {}
  setAttribute$$() {} // placeholder (unused)
}

function findAll(root, predicate, acc) {
  acc = acc || [];
  (root.childNodes || []).forEach((child) => {
    if (child.nodeType === ELEMENT_NODE) {
      if (predicate(child)) acc.push(child);
      findAll(child, predicate, acc);
    }
  });
  return acc;
}

function createFakeDocument(rootEl) {
  return {
    _root: rootEl,
    title: "",
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (v) => new FakeText(v),
    createTreeWalker: (root /*, whatToShow */) => {
      const list = [];
      (function walk(node) {
        if (node.nodeType === TEXT_NODE) list.push(node);
        (node.childNodes || []).forEach(walk);
      })(root);
      let idx = -1;
      return {
        nextNode() {
          idx++;
          return idx < list.length ? list[idx] : null;
        },
      };
    },
    getElementById(id) {
      return findAll(this._root, (el) => el.id === id)[0] || null;
    },
    querySelector(sel) {
      return findAll(this._root, (el) => matchesAny(el, sel))[0] || null;
    },
    querySelectorAll(sel) {
      return findAll(this._root, (el) => matchesAny(el, sel));
    },
    _handlers: {},
    addEventListener(type, handler) {
      (this._handlers[type] = this._handlers[type] || []).push(handler);
    },
    dispatch(type, evObj) {
      (this._handlers[type] || []).forEach((h) => h(evObj));
    },
  };
}

module.exports = { FakeElement, FakeText, createFakeDocument, parseFragment };
