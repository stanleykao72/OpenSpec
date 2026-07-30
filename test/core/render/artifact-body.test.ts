import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { renderChangeHtml } from '../../../src/core/render/html.js';
import type { SchemaYaml } from '../../../src/core/artifact-graph/types.js';

/**
 * Two output modes (change `html-viewer-markdown-artifact-mode`):
 *   default        → full standalone document, opened via file://
 *   --artifact-body → wrapper-free fragment, published as a Claude Artifact
 *
 * Every escaping assertion here runs against BOTH modes (spec Scenario:
 * 對抗性標記 — "兩種模式的輸出中均…"), because a mode split is exactly where
 * coverage goes asymmetric.
 */

const SCHEMA: SchemaYaml = { name: 'test-schema', version: 1, artifacts: [] } as SchemaYaml;

function withTempChangeDir(files: Record<string, string>, run: (changeDir: string) => void): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-artifact-body-'));
  try {
    const changeDir = path.join(tempDir, 'temp-change');
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(changeDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf-8');
    }
    run(changeDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function render(changeDir: string, artifactBody: boolean): string {
  return renderChangeHtml({
    changeDir,
    changeName: 'temp-change',
    schema: SCHEMA,
    schemaAutoDefaulted: false,
    artifactBody,
  });
}

const WRAPPER_TAGS = ['<!doctype', '<html', '</html', '<head', '</head', '<body', '</body'];

describe('artifact-body mode — no document wrapper', () => {
  it('emits no wrapper tags and exactly one top-level element', () => {
    withTempChangeDir({ 'proposal.md': '# P\n\nwhy\n' }, (dir) => {
      const frag = render(dir, true);
      for (const tag of WRAPPER_TAGS) {
        expect(frag.toLowerCase(), `wrapper leaked: ${tag}`).not.toContain(tag);
      }
      // The root carries data-change-name (the comment layer's localStorage
      // scoping key), so match the opening tag by prefix rather than exactly.
      expect(frag.trimStart()).toMatch(/^<div class="spec-viewer" data-change-name="[^"]*">/);
      expect(frag.trimEnd().endsWith('</div>')).toBe(true);
    });
  });

  it('carries its own style and script inline, with no external references', () => {
    withTempChangeDir({ 'proposal.md': '# P\n\nwhy\n' }, (dir) => {
      const frag = render(dir, true);
      expect(frag).toContain('<style>');
      expect(frag).toContain('<script>');
      expect(frag).not.toMatch(/<link\b/i);
      expect(frag).not.toMatch(/src\s*=\s*["']http/i);
      expect(frag).not.toMatch(/@import/i);
      expect(frag).not.toMatch(/https?:\/\//);
    });
  });

  it('scopes every style rule under the viewer root so a host page is untouched', () => {
    withTempChangeDir({ 'proposal.md': '# P\n' }, (dir) => {
      const style = /<style>\s*([\s\S]*?)<\/style>/.exec(render(dir, true))?.[1] ?? '';
      expect(style.length).toBeGreaterThan(0);
      // Strip comments, then every rule's selector list must be scoped: either
      // under .spec-viewer, or a :root/@-rule that only defines variables.
      const withoutComments = style.replace(/\/\*[\s\S]*?\*\//g, '');
      const selectors = [...withoutComments.matchAll(/(^|\}|\{)\s*([^{}@]+)\{/g)].map((m) => m[2].trim());
      expect(selectors.length).toBeGreaterThan(10);
      // The safety property is namespacing: every selector must be anchored on
      // one of this renderer's own `.spec-*` classes (`details.spec-collapse`
      // qualifies — it only matches elements carrying our class), or be a
      // `:root` variable block. A selector with no `.spec-` anchor — `body`,
      // `a`, `*` — is what would restyle a host page.
      const unscoped = selectors.filter(
        (sel) => !sel.split(',').every((s) => s.includes('.spec-') || s.trim().startsWith(':root'))
      );
      expect(unscoped).toEqual([]);
    });
  });

  it('keeps mermaid as pre.mermaid and embeds no mermaid runtime', () => {
    withTempChangeDir({ 'design.md': '## Context\n\n```mermaid\nflowchart LR\n  A --> B\n```\n' }, (dir) => {
      for (const mode of [true, false]) {
        const html = render(dir, mode);
        expect(html).toContain('<pre class="mermaid">');
        expect(html).toContain('flowchart LR');
        // A bundled mermaid runtime would announce itself; none is shipped.
        expect(html).not.toMatch(/mermaid\.min\.js/i);
        expect(html).not.toMatch(/mermaid\.initialize/i);
        expect(html.length).toBeLessThan(500_000);
      }
    });
  });
});

describe('default mode — unchanged standalone document', () => {
  it('starts with a doctype and declares charset within the first 1024 bytes', () => {
    withTempChangeDir({ 'proposal.md': '# 中文標題\n\n中文內容\n' }, (dir) => {
      const html = render(dir, false);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(Buffer.from(html, 'utf-8').subarray(0, 1024).toString('utf-8')).toContain(
        '<meta charset="utf-8">'
      );
      expect((html.match(/<html\b/gi) ?? []).length).toBe(1);
      expect((html.match(/<body\b/gi) ?? []).length).toBe(1);
      expect((html.match(/<head\b/gi) ?? []).length).toBe(1);
    });
  });

  it('contains the same body content as the fragment', () => {
    withTempChangeDir({ 'proposal.md': '# P\n\n| a | b |\n|---|---|\n| 1 | 2 |\n' }, (dir) => {
      expect(render(dir, false)).toContain(render(dir, true));
    });
  });
});

describe('markdown is rendered in both modes', () => {
  it('renders proposal tables as tables, not pipe text', () => {
    withTempChangeDir({ 'proposal.md': '# P\n\n## Why\n\n| 零件 | 現況 |\n|---|---|\n| CLI | 可用 |\n' }, (dir) => {
      for (const mode of [true, false]) {
        const html = render(dir, mode);
        expect(html).toContain('<table class="spec-md-table">');
        expect(html).toContain('<th');
        expect(html).toContain('零件');
        expect(html).not.toContain('| 零件 |');
      }
    });
  });

  it('renders bold without leaking asterisks', () => {
    withTempChangeDir({ 'design.md': '## Goals\n\n**Goals:**\n\n- one\n' }, (dir) => {
      for (const mode of [true, false]) {
        const html = render(dir, mode);
        expect(html).toContain('<strong>Goals:</strong>');
        expect(html).not.toContain('**Goals:**');
      }
    });
  });
});

/**
 * Structural audit: extract every element and attribute the output declares
 * and compare against what this renderer is allowed to emit. Text matching on
 * the output string cannot do this job — escaped payload text legitimately
 * contains `onerror=` while creating no attribute.
 */
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>/g;
// Consumes the value as well as the name, so text *inside* a quoted attribute
// value is never mistaken for another attribute (`content="width=device-width"`
// declares `content`, not `width`).
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/g;

const ALLOWED_TAGS = new Set([
  'html', 'head', 'body', 'meta', 'title', 'style', 'script',
  'div', 'nav', 'main', 'section', 'button', 'span', 'p', 'a', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'code', 'pre', 'br', 'hr',
  'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
  'details', 'summary', 'dl', 'dt', 'dd',
  // 評論層構件（change port-comment-layer-to-cli）
  'aside', 'form', 'label', 'input', 'textarea', 'mark',
]);
const ALLOWED_ATTRS = new Set([
  'id', 'class', 'href', 'rel', 'start', 'lang', 'charset', 'name', 'content',
  'type', 'open', 'aria-controls', 'aria-expanded', 'aria-label', 'data-target', 'style',
  // 評論層構件（change port-comment-layer-to-cli）：checkbox 的分組 key／顯示名、
  // 內容根元素的 localStorage 分域依據、面板控制項
  'data-change-name', 'data-review-key', 'data-review-label', 'data-comment-id',
  'placeholder', 'readonly', 'hidden',
]);

function auditMarkup(html: string): { tags: string[]; attrs: string[] } {
  // The inline <script> contains string literals with angle brackets; excluding
  // it keeps the audit about *markup* rather than about JS source text. The
  // script itself is a constant in this repo, not artifact-derived.
  const markupOnly = html.replace(/<script>[\s\S]*?<\/script>/g, '<script></script>');
  const tags: string[] = [];
  const attrs: string[] = [];
  for (const m of markupOnly.matchAll(TAG_RE)) {
    tags.push(m[1].toLowerCase());
    for (const a of (m[2] ?? '').matchAll(ATTR_RE)) attrs.push(a[1].toLowerCase());
  }
  return { tags, attrs };
}

describe('escaping has no exceptions — both modes', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<div onclick="x">hi</div>',
    '<img src=x onerror=alert(1)>',
    '<style/>',
    '<!--!><script>alert(1)</script>--!>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '[click](javascript:alert(1))',
    '[click](data:text/html,<script>alert(1)</script>)',
    '```js" onmouseover="alert(1)\ncode\n```',
    '| <script>alert(1)</script> |\n|---|\n| <img src=x onerror=1> |',
  ];

  it.each(payloads)('produces no rogue element or attribute for %s', (payload) => {
    withTempChangeDir(
      {
        'proposal.md': `# P\n\n## Why\n\n${payload}\n`,
        'design.md': `## Context\n\n${payload}\n`,
        'tasks.md': `## 1. G\n\n- [ ] 1.1 ${payload}\n`,
        'specs/cap/spec.md': `# cap\n\n## ADDED Requirements\n\n### Requirement: ${payload}\n\nMUST ${payload}\n`,
      },
      (dir) => {
        for (const mode of [true, false]) {
          const html = render(dir, mode);
          const { tags, attrs } = auditMarkup(html);
          expect(tags.filter((t) => !ALLOWED_TAGS.has(t)), `mode=${mode}`).toEqual([]);
          expect(attrs.filter((a) => !ALLOWED_ATTRS.has(a)), `mode=${mode}`).toEqual([]);
          expect(html).not.toMatch(/href\s*=\s*"javascript:/i);
          expect(html).not.toMatch(/href\s*=\s*"data:/i);
        }
      }
    );
  });
});

describe('determinism — both modes', () => {
  it('produces byte-identical output on repeated renders', () => {
    withTempChangeDir(
      {
        'proposal.md': '# P\n\n## Why\n\nwhy\n',
        'design.md': '## Context\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n| a |\n|---|\n| 1 |\n',
        'tasks.md': '## 1. G\n\n- [x] 1.1 done\n- [ ] 1.2 todo\n',
        'specs/cap/spec.md': '# cap\n\n## ADDED Requirements\n\n### Requirement: R\n\nMUST do.\n',
      },
      (dir) => {
        for (const mode of [true, false]) {
          expect(render(dir, mode)).toBe(render(dir, mode));
        }
      }
    );
  });
});
