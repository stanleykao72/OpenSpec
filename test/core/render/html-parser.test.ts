import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  sanitizeId,
  extractNormativePills,
  splitMermaidSegments,
  parseSpecRequirements,
  parseTaskGroups,
  splitLevel2Sections,
} from '../../../src/core/render/html-parser.js';

describe('escapeHtml', () => {
  it('escapes & first so entities are not double-escaped', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('escapes <, >, and "', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(escapeHtml('<img onerror=alert(1)>')).toBe('&lt;img onerror=alert(1)&gt;');
    expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;');
  });

  it('handles nullish input without throwing', () => {
    expect(escapeHtml(null as unknown as string)).toBe('');
    expect(escapeHtml(undefined as unknown as string)).toBe('');
  });
});

describe('sanitizeId', () => {
  it('lowercases and collapses non [a-z0-9] runs to a single hyphen', () => {
    expect(sanitizeId('User Auth v2', 'x')).toBe('user-auth-v2');
  });

  it('trims leading/trailing hyphens', () => {
    expect(sanitizeId('--foo--', 'x')).toBe('foo');
  });

  it('falls back when the sanitized result would be empty', () => {
    expect(sanitizeId('中文名稱', 'fallback-id')).toBe('fallback-id');
    expect(sanitizeId('###', 'fallback-id')).toBe('fallback-id');
  });

  it('only ever produces [a-z0-9-]+', () => {
    const out = sanitizeId('Weird!!Name__2026<script>', 'x');
    expect(out).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('extractNormativePills', () => {
  it('detects SHALL', () => {
    expect(extractNormativePills('The system SHALL do X.')).toEqual([{ cls: 'shall', label: 'SHALL' }]);
  });

  it('detects MUST NOT distinctly from MUST', () => {
    expect(extractNormativePills('The system MUST NOT do Y.')).toEqual([{ cls: 'must', label: 'MUST NOT' }]);
  });

  it('detects plain MUST when MUST NOT is absent', () => {
    expect(extractNormativePills('The system MUST do Z.')).toEqual([{ cls: 'must', label: 'MUST' }]);
  });

  it('detects both SHALL and MUST together', () => {
    expect(extractNormativePills('SHALL do X; MUST NOT do Y.')).toEqual([
      { cls: 'shall', label: 'SHALL' },
      { cls: 'must', label: 'MUST NOT' },
    ]);
  });

  it('does not pill SHOULD/MAY', () => {
    expect(extractNormativePills('The system SHOULD or MAY do X.')).toEqual([]);
  });
});

describe('splitMermaidSegments', () => {
  it('extracts a mermaid fence as its own segment', () => {
    const md = 'Intro text.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nOutro text.';
    const segments = splitMermaidSegments(md);
    const mermaidSegments = segments.filter((s) => s.kind === 'mermaid');
    expect(mermaidSegments).toHaveLength(1);
    expect(mermaidSegments[0].content).toContain('A --> B');
  });

  it('keeps non-mermaid fences as text segments (fence markers included)', () => {
    const md = '```js\nconst x = 1;\n```';
    const segments = splitMermaidSegments(md);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe('text');
    expect(segments[0].content).toContain('const x = 1;');
  });

  it('handles content with no fences at all as a single text segment', () => {
    const segments = splitMermaidSegments('Just a paragraph.\nAnother line.');
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe('text');
  });
});

describe('parseSpecRequirements', () => {
  it('parses ADDED requirements with WHEN/THEN scenarios', () => {
    const spec = `## ADDED Requirements

### Requirement: Widget export
The system SHALL allow users to export widgets.

#### Scenario: Successful export
- **WHEN** the user clicks Export
- **THEN** a file is downloaded
- **AND** a success toast is shown
`;
    const reqs = parseSpecRequirements(spec);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].name).toBe('Widget export');
    expect(reqs[0].descriptionText).toContain('SHALL allow users to export widgets');
    expect(reqs[0].pills).toEqual([{ cls: 'shall', label: 'SHALL' }]);
    expect(reqs[0].scenarios).toHaveLength(1);
    expect(reqs[0].scenarios[0].name).toBe('Successful export');
    expect(reqs[0].scenarios[0].rawFallback).toBeNull();
    expect(reqs[0].scenarios[0].rows).toEqual([
      { label: 'WHEN', text: 'the user clicks Export' },
      { label: 'THEN', text: 'a file is downloaded' },
      { label: 'THEN', text: 'a success toast is shown' },
    ]);
  });

  it('falls back to raw text for a non-standard scenario body', () => {
    const spec = `## ADDED Requirements

### Requirement: Odd one
The system MUST do the thing.

#### Scenario: Freeform
Some prose that is not WHEN/THEN shaped at all.
`;
    const reqs = parseSpecRequirements(spec);
    expect(reqs[0].scenarios[0].rawFallback).toContain('Some prose that is not WHEN/THEN shaped');
    expect(reqs[0].scenarios[0].rows).toEqual([]);
  });

  it('returns an empty list for non-delta content without crashing', () => {
    expect(parseSpecRequirements('# Just a title\n\nSome unrelated text.')).toEqual([]);
  });

  it('includes MODIFIED requirements alongside ADDED', () => {
    const spec = `## ADDED Requirements

### Requirement: New thing
The system SHALL do X.

#### Scenario: A
- **WHEN** a
- **THEN** b

## MODIFIED Requirements

### Requirement: Existing thing
The system SHALL do Y differently.

#### Scenario: B
- **WHEN** c
- **THEN** d
`;
    const reqs = parseSpecRequirements(spec);
    expect(reqs.map((r) => r.name)).toEqual(['New thing', 'Existing thing']);
  });
});

describe('parseTaskGroups', () => {
  it('groups by level-2 headings that directly hold checkboxes', () => {
    const tasks = `## 1. Setup

- [x] 1.1 Create module
- [ ] 1.2 Add deps

## 2. Core

- [x] 2.1 Implement thing
`;
    const groups = parseTaskGroups(tasks);
    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('1. Setup');
    expect(groups[0].items).toEqual([
      { done: true, id: '1.1', text: 'Create module' },
      { done: false, id: '1.2', text: 'Add deps' },
    ]);
    expect(groups[1].items).toEqual([{ done: true, id: '2.1', text: 'Implement thing' }]);
  });

  it('falls back to level-3 groups when level-2 sections have no direct checkboxes', () => {
    const tasks = `## 1. Parent

### 1.A Sub one

- [x] 1.1 Item

### 1.B Sub two

- [ ] 1.2 Item
`;
    const groups = parseTaskGroups(tasks);
    expect(groups.map((g) => g.name)).toEqual(['1.A Sub one', '1.B Sub two']);
  });

  it('returns an empty list for a file with no checkbox groups', () => {
    expect(parseTaskGroups('Just prose, no headings or checkboxes.')).toEqual([]);
  });

  it('ignores checkbox-looking lines inside fenced code blocks', () => {
    const tasks = `## 1. Setup

- [ ] 1.1 Real task

\`\`\`
- [ ] not a real task
\`\`\`
`;
    const groups = parseTaskGroups(tasks);
    expect(groups[0].items).toEqual([{ done: false, id: '1.1', text: 'Real task' }]);
  });
});

describe('splitLevel2Sections', () => {
  it('splits by ## headings and preserves preamble', () => {
    const md = `# Title

Preamble text.

## Why

Because reasons.

## What Changes

- a change
`;
    const sections = splitLevel2Sections(md);
    expect(sections.map((s) => s.title)).toEqual(['', 'Why', 'What Changes']);
    expect(sections[1].body).toContain('Because reasons.');
  });

  it('returns a single untitled section when there are no ## headings', () => {
    const sections = splitLevel2Sections('Just some text.');
    expect(sections).toEqual([{ title: '', body: 'Just some text.' }]);
  });
});
