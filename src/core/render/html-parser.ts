/**
 * Minimal markdown parsing helpers for the `openspec html` renderer
 * (design.md Decision 2: no third-party markdown engine — a parser that
 * accepts raw HTML passthrough is exactly the XSS surface "escape with no
 * exceptions" forbids).
 *
 * Reuses the repo's existing delta-spec block reader
 * (`core/parsers/requirement-blocks.ts`) for `### Requirement:` /
 * `#### Scenario:` extraction rather than re-implementing it, per
 * design.md Decision 2 ("優先重用" `src/core/parsers/`).
 */

import { buildCodeFenceMask } from '../parsers/requirement-text.js';
import { parseDeltaSpec, type RequirementBlock } from '../parsers/requirement-blocks.js';

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

// ── HTML entity escaping & id sanitization ──────────────────────────────

/**
 * Escapes text for insertion into an HTML text node or attribute value.
 * `&` MUST be replaced first — replacing it after `<`/`>`/`"` have already
 * been turned into entities would double-escape those entities' own `&`.
 * No exceptions: this applies to `<pre>` raw blocks and mermaid fences too
 * (spec Requirement: 產出單檔自足且跳脫無例外).
 */
export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sanitizes an artifact-derived name into a value safe to use as an
 * element `id` / `href` fragment / `data-target`: lowercase, non
 * `[a-z0-9]` runs collapsed to a single hyphen, leading/trailing hyphens
 * trimmed. Never returns an empty string — a name that sanitizes to
 * nothing (e.g. purely CJK/punctuation input) falls back to `fallback`.
 */
export function sanitizeId(raw: string, fallback: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
}

// ── SHALL/MUST pill extraction ──────────────────────────────────────────

export interface NormativePill {
  cls: 'shall' | 'must';
  label: string;
}

/** Scans requirement text for RFC-2119 keywords and returns the distinct
 * pills to render (SHALL, and MUST or the more specific MUST NOT — never
 * both MUST and MUST NOT for the same text). SHOULD/MAY are deliberately
 * not pilled (conventions.md "SHALL / MUST pill"). */
export function extractNormativePills(text: string): NormativePill[] {
  const pills: NormativePill[] = [];
  if (/\bSHALL\b/.test(text)) pills.push({ cls: 'shall', label: 'SHALL' });
  if (/\bMUST NOT\b/.test(text)) {
    pills.push({ cls: 'must', label: 'MUST NOT' });
  } else if (/\bMUST\b/.test(text)) {
    pills.push({ cls: 'must', label: 'MUST' });
  }
  return pills;
}

// ── Fenced-block extraction (mermaid vs. generic raw) ───────────────────

export type MarkdownSegment =
  | { kind: 'text'; content: string }
  | { kind: 'mermaid'; content: string };

/**
 * Splits a markdown blob into an ordered list of segments: mermaid fences
 * become their own `mermaid` segment (rendered later as
 * `<pre class="mermaid">`), everything else — headings, paragraphs, lists,
 * non-mermaid fences — is left as `text` segments to be escaped and shown
 * verbatim in a `<pre class="spec-raw">` block. This is deliberately not a
 * full markdown-to-HTML renderer (design.md Decision 2): non-standard
 * structure MUST render as raw text, not crash and not be dropped.
 */
export function splitMermaidSegments(markdown: string): MarkdownSegment[] {
  const normalized = normalizeLineEndings(markdown);
  const fenceRe = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\n`]*)\n([\s\S]*?)^ {0,3}\1[ \t]*$/gm;
  const segments: MarkdownSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(normalized)) !== null) {
    const [whole, , info, body] = match;
    const isMermaid = info.trim().toLowerCase() === 'mermaid';
    const before = normalized.slice(lastIndex, match.index);
    if (before.length > 0) segments.push({ kind: 'text', content: before });
    if (isMermaid) {
      segments.push({ kind: 'mermaid', content: body.replace(/\n$/, '') });
    } else {
      // Non-mermaid fence: keep the fence markers so the raw block still
      // reads like the original artifact.
      segments.push({ kind: 'text', content: whole });
    }
    lastIndex = match.index + whole.length;
  }

  const rest = normalized.slice(lastIndex);
  if (rest.length > 0) segments.push({ kind: 'text', content: rest });

  return segments;
}

// ── Requirement / scenario detail parsing ───────────────────────────────

export interface ScenarioRow {
  label: 'WHEN' | 'THEN';
  text: string;
}

export interface ParsedScenario {
  name: string;
  rows: ScenarioRow[];
  /** Set when the scenario body didn't match the WHEN/THEN bullet shape —
   * the raw (unescaped) original text to render verbatim instead. */
  rawFallback: string | null;
}

export interface ParsedRequirement {
  name: string;
  /** Requirement description text (excludes the header line and any
   * scenario blocks), raw (unescaped) markdown. */
  descriptionText: string;
  scenarios: ParsedScenario[];
  pills: NormativePill[];
}

const SCENARIO_HEADER_RE = /^####\s+Scenario:\s*(.+?)\s*$/i;
const ANY_HEADER_RE = /^#{1,4}\s/;
const BULLET_RE = /^\s*[-*]\s*\*\*(WHEN|THEN|AND)\*\*\s*(.*)$/i;

function parseScenarioBody(name: string, bodyLines: string[]): ParsedScenario {
  const rows: ScenarioRow[] = [];
  let lastLabel: 'WHEN' | 'THEN' | null = null;
  let matchedAny = false;

  for (const line of bodyLines) {
    const m = line.match(BULLET_RE);
    if (!m) continue;
    matchedAny = true;
    const keyword = m[1].toUpperCase();
    const text = m[2].trim();
    if (keyword === 'AND') {
      if (lastLabel) rows.push({ label: lastLabel, text });
      continue;
    }
    lastLabel = keyword as 'WHEN' | 'THEN';
    rows.push({ label: lastLabel, text });
  }

  if (!matchedAny) {
    const rawText = bodyLines.join('\n').trim();
    return { name, rows: [], rawFallback: rawText };
  }

  return { name, rows, rawFallback: null };
}

/**
 * Parses one `### Requirement: ...` block (as returned by
 * `parseDeltaSpec`/`parseRequirementBlocksFromSection`) into a description
 * plus its scenarios.
 */
export function parseRequirementDetail(block: RequirementBlock): ParsedRequirement {
  const lines = normalizeLineEndings(block.raw).split('\n');
  const fenceMask = buildCodeFenceMask(lines);

  let i = 1; // skip the header line itself
  const descriptionLines: string[] = [];
  while (i < lines.length && !(!fenceMask[i] && SCENARIO_HEADER_RE.test(lines[i]))) {
    descriptionLines.push(lines[i]);
    i++;
  }

  const scenarios: ParsedScenario[] = [];
  while (i < lines.length) {
    if (fenceMask[i]) { i++; continue; }
    const headerMatch = lines[i].match(SCENARIO_HEADER_RE);
    if (!headerMatch) { i++; continue; }
    const name = headerMatch[1].trim();
    i++;
    const bodyLines: string[] = [];
    while (i < lines.length && !(!fenceMask[i] && (SCENARIO_HEADER_RE.test(lines[i]) || ANY_HEADER_RE.test(lines[i])))) {
      bodyLines.push(lines[i]);
      i++;
    }
    scenarios.push(parseScenarioBody(name, bodyLines));
  }

  const descriptionText = descriptionLines.join('\n').trim();
  return {
    name: block.name,
    descriptionText,
    scenarios,
    pills: extractNormativePills(descriptionText),
  };
}

/**
 * Parses a delta-format capability spec.md into its ADDED + MODIFIED
 * requirement blocks (REMOVED/RENAMED are metadata-only and not shown as
 * viewer requirement cards). Non-delta / malformed content simply yields
 * an empty list — callers render "no requirements" rather than crash.
 */
export function parseSpecRequirements(specMarkdown: string): ParsedRequirement[] {
  const plan = parseDeltaSpec(specMarkdown);
  const blocks = [...plan.added, ...plan.modified];
  return blocks.map(parseRequirementDetail);
}

// ── Tasks.md group parsing (group = same-level heading directly holding
//    checkboxes; conventions.md "Tasks 群組進度") ─────────────────────────

export interface TaskItem {
  done: boolean;
  id: string;
  text: string;
}

export interface TaskGroup {
  name: string;
  items: TaskItem[];
}

interface HeadingLine {
  level: number;
  title: string;
  startLine: number;
}

const CHECKBOX_RE = /^\s*-\s*\[( |x|X)\]\s+(.*)$/;
const TASK_ID_RE = /^(\d+(?:\.\d+)*)\s+(.*)$/;

function findHeadings(lines: string[], fenceMask: boolean[]): HeadingLine[] {
  const headings: HeadingLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenceMask[i]) continue;
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m) headings.push({ level: m[1].length, title: m[2].trim(), startLine: i });
  }
  return headings;
}

function directChecklistItems(
  lines: string[],
  fenceMask: boolean[],
  heading: HeadingLine,
  headings: HeadingLine[],
  headingIndex: number
): TaskItem[] {
  const start = heading.startLine + 1;
  const end = headingIndex + 1 < headings.length ? headings[headingIndex + 1].startLine : lines.length;
  const items: TaskItem[] = [];
  for (let i = start; i < end; i++) {
    if (fenceMask[i]) continue;
    const m = lines[i].match(CHECKBOX_RE);
    if (!m) continue;
    const done = m[1].toLowerCase() === 'x';
    const rest = m[2];
    const idMatch = rest.match(TASK_ID_RE);
    items.push({
      done,
      id: idMatch ? idMatch[1] : '',
      text: idMatch ? idMatch[2] : rest,
    });
  }
  return items;
}

// ── Level-2 section splitting (proposal.md / design.md progressive
//    disclosure — each `## ` section becomes its own collapsible block) ──

export interface MarkdownSection {
  title: string;
  body: string;
}

/**
 * Splits a markdown document into level-2 (`## `) sections, preserving any
 * preamble before the first heading as a section titled `''`. This is not
 * a general markdown parser (design.md Decision 2) — it only recognizes
 * the top-level heading boundary needed to render "one collapsible block
 * per proposal/design section".
 */
export function splitLevel2Sections(markdown: string): MarkdownSection[] {
  const lines = normalizeLineEndings(markdown).split('\n');
  const fenceMask = buildCodeFenceMask(lines);
  const headings: HeadingLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenceMask[i]) continue;
    const m = lines[i].match(/^##\s+(.+)$/);
    if (m) headings.push({ level: 2, title: m[1].trim(), startLine: i });
  }

  if (headings.length === 0) {
    const whole = markdown.trim();
    return whole.length > 0 ? [{ title: '', body: whole }] : [];
  }

  const sections: MarkdownSection[] = [];
  if (headings[0].startLine > 0) {
    const preamble = lines.slice(0, headings[0].startLine).join('\n').trim();
    if (preamble) sections.push({ title: '', body: preamble });
  }
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].startLine + 1;
    const end = i + 1 < headings.length ? headings[i + 1].startLine : lines.length;
    sections.push({ title: headings[i].title, body: lines.slice(start, end).join('\n').trim() });
  }
  return sections;
}

/**
 * Groups tasks.md by "the deepest heading level that directly holds
 * checkbox items", uniformly for the whole file (never mixing levels).
 * Prefers level-2 (`##`) groups — the common shape used by this repo's
 * schema templates — and falls back to level-3 (`###`) groups nested
 * under a level-2 section when no level-2 section has direct checkboxes.
 */
export function parseTaskGroups(tasksMarkdown: string): TaskGroup[] {
  const lines = normalizeLineEndings(tasksMarkdown).split('\n');
  const fenceMask = buildCodeFenceMask(lines);
  const headings = findHeadings(lines, fenceMask);

  const level2 = headings
    .map((h, idx) => ({ h, idx }))
    .filter(({ h }) => h.level === 2);

  const level2Groups: TaskGroup[] = level2.map(({ h, idx }) => ({
    name: h.title,
    items: directChecklistItems(lines, fenceMask, h, headings, idx),
  }));

  if (level2Groups.some((g) => g.items.length > 0)) {
    return level2Groups;
  }

  const level3 = headings
    .map((h, idx) => ({ h, idx }))
    .filter(({ h }) => h.level === 3);

  return level3.map(({ h, idx }) => ({
    name: h.title,
    items: directChecklistItems(lines, fenceMask, h, headings, idx),
  }));
}
