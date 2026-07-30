/**
 * Markdown → HTML generator for the `openspec html` renderer.
 *
 * Change `html-viewer-markdown-artifact-mode`, spec Requirement
 * "markdown 內容以格式化 HTML 呈現" + "產出單檔自足且跳脫無例外".
 *
 * ## Why a third-party parser is used here, when the original renderer refused one
 *
 * `html-parser.ts` records the earlier decision: "no third-party markdown
 * engine — a parser that accepts raw HTML passthrough is exactly the XSS
 * surface 'escape with no exceptions' forbids". That rationale is about a
 * parser's **HTML output**. This module supersedes it on a narrower basis
 * (design.md Decision 1): `marked` is used **only as a lexer**. We take its
 * token tree — a structural description of the markdown — and emit every tag
 * ourselves from the fixed `switch` below, passing every text node through
 * `escapeHtml` and every attribute value through `escapeHtml` plus an
 * allowlist. `marked.parse()` is never called; no string produced by `marked`
 * is ever inserted into the output as markup. `type: 'html'` tokens (raw HTML
 * in the artifact) are emitted as escaped **text**, never passthrough.
 *
 * The invariant to preserve when extending this file: structure comes from
 * this module's own code, content comes from `escapeHtml`. Never emit a
 * token's `raw`/`text`/`href` directly into markup.
 */

import { marked, type Token, type Tokens } from 'marked';

import { escapeHtml, sanitizeId } from './html-parser.js';

/**
 * URL schemes allowed on a rendered link. Anything else (notably
 * `javascript:`, `data:`, `vbscript:`) is downgraded to plain text so no
 * `href` is emitted at all (spec Scenario: 對抗性連結).
 */
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * Decides whether a link destination may become an `href`.
 *
 * Deliberately conservative and structural rather than pattern-matching for
 * "bad" schemes: a fragment or a relative path is fine, an absolute URL must
 * parse *and* carry an allowlisted scheme. Control characters are stripped
 * before the check — `java\tscript:` and `java\nscript:` are treated by
 * browsers as `javascript:`, so leaving them in would let a blocklist-style
 * check pass while the browser still executes. A value that fails any step
 * yields `null`, and the caller renders text instead of a link.
 */
function safeHref(raw: string): string | null {
  // Control characters and whitespace are stripped before any scheme check:
  // browsers read `java\tscript:` / `java script:` as `javascript:`, so leaving
  // them in would let the check below pass while the browser still executes.
  // Written as explicit \u escapes — literal control bytes in source are invisible
  // to review (and an earlier revision of this line really did contain them).
  const cleaned = String(raw ?? '').replace(/[\u0000-\u0020\u007f]/g, '');
  if (cleaned.length === 0) return null;
  if (cleaned.startsWith('#')) return cleaned;

  // A scheme-looking prefix must be allowlisted. Anything without a scheme is
  // a relative reference, which cannot execute script.
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  if (!schemeMatch) {
    // Protocol-relative URLs (`//host/path`) inherit the page's scheme; for a
    // file:// viewer that is a dead link, and it is not a script vector.
    return cleaned;
  }
  const scheme = `${schemeMatch[1].toLowerCase()}:`;
  return ALLOWED_SCHEMES.has(scheme) ? cleaned : null;
}

/** Fence language tags become a class, so they must survive as `[a-z0-9-]+`
 * only — an unsanitized tag is an attribute-injection vector (spec Scenario:
 * 屬性注入). Returns null when nothing usable remains. */
function langClass(info: string | undefined): string | null {
  if (!info) return null;
  const first = info.trim().split(/\s+/)[0] ?? '';
  const cleaned = first.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? `lang-${cleaned}` : null;
}

/** Per-render heading id counter state. Ids must be unique within a document
 * and deterministic across runs (spec Requirement: 確定性輸出), so the
 * fallback is positional rather than random. */
interface RenderState {
  headingSeq: number;
}

function renderInlineTokens(tokens: Token[] | undefined, state: RenderState): string {
  if (!tokens || tokens.length === 0) return '';
  return tokens.map((token) => renderInline(token, state)).join('');
}

/**
 * Inline-level generator. Every branch either wraps *rendered children* in a
 * tag or escapes a leaf's text; the `default` branch escapes, so an
 * unrecognised inline token degrades to visible text instead of vanishing.
 */
function renderInline(token: Token, state: RenderState): string {
  switch (token.type) {
    case 'text': {
      const t = token as Tokens.Text;
      // A `text` token can itself carry inline children (e.g. inside a table
      // cell); prefer them so nested emphasis is not flattened to raw markers.
      if (t.tokens && t.tokens.length > 0) return renderInlineTokens(t.tokens, state);
      return escapeHtml(t.text);
    }
    case 'escape':
      return escapeHtml((token as Tokens.Escape).text);
    case 'strong':
      return `<strong>${renderInlineTokens((token as Tokens.Strong).tokens, state)}</strong>`;
    case 'em':
      return `<em>${renderInlineTokens((token as Tokens.Em).tokens, state)}</em>`;
    case 'del':
      return `<del>${renderInlineTokens((token as Tokens.Del).tokens, state)}</del>`;
    case 'codespan':
      return `<code>${escapeHtml((token as Tokens.Codespan).text)}</code>`;
    case 'br':
      return '<br>';
    case 'link': {
      const link = token as Tokens.Link;
      const inner = renderInlineTokens(link.tokens, state) || escapeHtml(link.text);
      // GFM bare autolinks (raw carries no `[`/`<` syntax shell) are outside
      // the declared support set and mangle content — a `user:pw@host`
      // connection string gets its password segment carved into a mailto link
      // (T-185). Degrade them to text; explicit `[x](url)`, reference-style
      // `[x][ref]` and CommonMark `<url>` autolinks keep their shell and pass.
      if (!link.raw.startsWith('[') && !link.raw.startsWith('<')) return inner;
      const href = safeHref(link.href);
      // No `title` attribute is emitted at all: it carries no information the
      // viewer needs, and every attribute is one more injection surface to
      // defend (spec Scenario: 屬性注入).
      if (href === null) return inner;
      return `<a href="${escapeHtml(href)}" rel="noreferrer">${inner}</a>`;
    }
    case 'image': {
      // Images are never emitted as `<img>`: the viewer is a single
      // self-contained file with zero external resource references, and an
      // artifact-supplied src is both a network fetch and an injection
      // surface. Render the alt text so nothing is silently dropped.
      const img = token as Tokens.Image;
      return escapeHtml(img.text || img.href || '');
    }
    case 'html':
      // Raw HTML in the artifact is content, not markup (spec Scenario:
      // 原始 HTML 不透傳).
      return escapeHtml((token as Tokens.HTML).raw);
    default:
      return escapeHtml((token as { raw?: string; text?: string }).raw ?? (token as { text?: string }).text ?? '');
  }
}

function renderListItems(items: Tokens.ListItem[], state: RenderState): string {
  return items
    .map((item) => `<li>${renderBlockTokens(item.tokens, state)}</li>`)
    .join('');
}

function renderTable(table: Tokens.Table, state: RenderState): string {
  const alignClass = (align: 'center' | 'left' | 'right' | null): string =>
    align ? ` class="align-${align}"` : '';

  const head = table.header
    .map((cell, i) => `<th${alignClass(table.align[i] ?? null)}>${renderInlineTokens(cell.tokens, state)}</th>`)
    .join('');
  const body = table.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) => `<td${alignClass(table.align[i] ?? null)}>${renderInlineTokens(cell.tokens, state)}</td>`)
          .join('')}</tr>`
    )
    .join('');

  // Wrapped so a wide table scrolls inside its own container instead of making
  // the page body scroll sideways.
  return `<div class="spec-md-scroll"><table class="spec-md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/**
 * Block-level generator. As with inline, the `default` branch escapes the
 * token's raw source into a `<pre>` so unsupported or malformed markdown
 * shows up verbatim rather than disappearing (spec Scenario: 不支援語法走原文
 * fallback).
 */
function renderBlock(token: Token, state: RenderState): string {
  switch (token.type) {
    case 'space':
      return '';
    case 'heading': {
      const h = token as Tokens.Heading;
      const level = Math.min(Math.max(h.depth, 1), 6);
      state.headingSeq += 1;
      const id = sanitizeId(h.text, `md-h${state.headingSeq}`);
      return `<h${level} id="${id}">${renderInlineTokens(h.tokens, state)}</h${level}>`;
    }
    case 'paragraph':
      return `<p>${renderInlineTokens((token as Tokens.Paragraph).tokens, state)}</p>`;
    case 'text': {
      const t = token as Tokens.Text;
      const inner = t.tokens && t.tokens.length > 0 ? renderInlineTokens(t.tokens, state) : escapeHtml(t.text);
      return inner;
    }
    case 'list': {
      const list = token as Tokens.List;
      const tag = list.ordered ? 'ol' : 'ul';
      const startAttr =
        list.ordered && typeof list.start === 'number' && list.start !== 1 ? ` start="${list.start}"` : '';
      return `<${tag}${startAttr}>${renderListItems(list.items, state)}</${tag}>`;
    }
    case 'blockquote':
      return `<blockquote>${renderBlockTokens((token as Tokens.Blockquote).tokens, state)}</blockquote>`;
    case 'code': {
      const code = token as Tokens.Code;
      const cls = langClass(code.lang);
      const codeClass = cls ? ` class="${cls}"` : '';
      return `<pre class="spec-md-code"><code${codeClass}>${escapeHtml(code.text)}</code></pre>`;
    }
    case 'hr':
      return '<hr>';
    case 'table':
      return renderTable(token as Tokens.Table, state);
    case 'html':
      return `<pre class="spec-raw">${escapeHtml((token as Tokens.HTML).raw)}</pre>`;
    default:
      return `<pre class="spec-raw">${escapeHtml((token as { raw?: string }).raw ?? '')}</pre>`;
  }
}

function renderBlockTokens(tokens: Token[] | undefined, state: RenderState): string {
  if (!tokens || tokens.length === 0) return '';
  return tokens.map((token) => renderBlock(token, state)).join('');
}

/**
 * Renders a markdown blob into HTML.
 *
 * Never throws and never returns an empty string for non-empty input: a lexer
 * failure or an unrecognised shape falls back to the escaped source in a
 * `<pre>`, because losing artifact content silently is worse than showing it
 * unformatted (the same fail-visible stance as the renderer's other fallbacks).
 */
export function renderMarkdown(markdown: string): string {
  const source = String(markdown ?? '');
  if (source.length === 0) return '';

  const rawFallback = (): string => `<pre class="spec-raw">${escapeHtml(source)}</pre>`;

  let tokens: Token[];
  try {
    tokens = marked.lexer(source.replace(/\r\n?/g, '\n'), { gfm: true });
  } catch {
    return rawFallback();
  }

  let html: string;
  try {
    html = renderBlockTokens(tokens, { headingSeq: 0 });
  } catch {
    return rawFallback();
  }

  // Whitespace-only or otherwise structure-free input tokenizes to nothing;
  // show the source rather than emitting an empty block.
  return html.trim().length > 0 ? html : rawFallback();
}

/**
 * Renders a single line of markdown **inline** — no wrapping `<p>`, no block
 * constructs. Used for text that already sits in its own structural slot:
 * requirement descriptions, scenario WHEN/THEN cells, task rows. Those are
 * the most-read text in the viewer, and leaving them raw is what made spec
 * prose show its backticks (`` `<table>` ``) on screen.
 *
 * Same invariant as `renderMarkdown`: structure from this module, text through
 * `escapeHtml`. Falls back to plain escaped text if the lexer refuses the
 * input, so a malformed line degrades to readable text and never disappears.
 */
export function renderMarkdownInline(text: string): string {
  const src = String(text ?? '');
  if (src.length === 0) return '';
  try {
    const tokens = marked.Lexer.lexInline(src.replace(/\r\n?/g, '\n'), { gfm: true });
    const html = renderInlineTokens(tokens, { headingSeq: 0 });
    return html.length > 0 ? html : escapeHtml(src);
  } catch {
    return escapeHtml(src);
  }
}
