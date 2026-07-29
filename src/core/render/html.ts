/**
 * `openspec html` renderer: reads a change directory's artifacts and
 * synthesizes a single self-contained `spec-viewer.html` string.
 *
 * Behavioral contract lives in
 * `openspec/changes/add-openspec-html-command/specs/html-viewer-command/spec.md`
 * (5 requirements: command surface, artifact reading + missing markers,
 * self-contained escaping, honest gate presentation, determinism). This
 * module owns requirements 2-5; `src/commands/html.ts` owns requirement 1
 * (the command surface itself).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SchemaYaml } from '../artifact-graph/types.js';
import {
  SPEC_VIEWER_STYLE,
  SPEC_VIEWER_NAV_SCRIPT,
  LIFECYCLE_STATIONS,
  TREE_LEGEND_TEXT,
  type LifecycleStation,
} from './html-template.js';
import {
  escapeHtml,
  sanitizeId,
  parseSpecRequirements,
  parseTaskGroups,
  splitLevel2Sections,
  splitMermaidSegments,
  type ParsedRequirement,
  type TaskGroup,
} from './html-parser.js';

// ── Public entry point ───────────────────────────────────────────────────

export interface RenderChangeHtmlOptions {
  /** Absolute (or at least consistent) path to the change directory. This
   * MUST already be the boundary-checked, symlink-resolved directory the
   * caller obtained from `resolveWithinContainer` — the renderer resolves
   * it again itself (via `realpathSync`) purely as defense in depth, not
   * as a substitute for the caller doing that check. */
  changeDir: string;
  /** Display name for the change (used in <title> and the header). */
  changeName: string;
  /** Resolved schema for gate declarations, or null when unresolvable —
   * the renderer then falls back to whatever gate ids appear in
   * `.gates/*.json` evidence (design.md Decision 4). */
  schema: SchemaYaml | null;
  /** True when `schema` was silently applied as a default because
   * `.openspec.yaml` was absent (spec Requirement "artifacts 讀取與缺席
   * 處理": ".openspec.yaml 缺席時依檔名形狀判斷渲染模式") — the header then
   * says so explicitly rather than let a guessed default look like an
   * authoritative declaration. Defaults to `false` (no note) so existing
   * callers that pass an explicitly-resolved schema are unaffected. */
  schemaAutoDefaulted?: boolean;
}

export function renderChangeHtml(options: RenderChangeHtmlOptions): string {
  const { changeDir, changeName, schema, schemaAutoDefaulted = false } = options;

  // Every subsequent filesystem read is anchored to this single
  // `realpathSync` of the change directory, computed once up front — every
  // artifact path is then resolved and boundary-checked against it (see
  // `resolveArtifactPath` / `readArtifactSafely` below). When the change
  // directory itself can no longer be resolved (deleted out from under us,
  // or never existed) every artifact degrades to "not produced" rather
  // than throwing.
  const realBase = resolveRealBase(changeDir);

  const proposalMd = realBase ? readArtifactSafely(realBase, 'proposal.md') : null;
  const designMd = realBase ? readArtifactSafely(realBase, 'design.md') : null;
  const tasksMd = realBase ? readArtifactSafely(realBase, 'tasks.md') : null;
  const capabilities = realBase ? readCapabilitySpecs(realBase) : [];
  const gatesFiles = realBase ? readGatesFiles(realBase) : [];

  const station = determineStation({
    changeDir,
    hasProposal: proposalMd !== null,
    tasksMd,
    gatesFilenames: gatesFiles.map((f) => f.filename),
  });

  const gateIds = collectGateIdsForStation(schema, station);
  const {
    statuses: gateStatuses,
    emptySynthesisFiles,
    inconsistentSynthesisFiles,
  } = computeGateStatuses(gateIds, gatesFiles);

  const capabilityViews: CapabilityView[] = capabilities.map((cap) => ({
    slug: cap.slug,
    displayName: resolveCapabilityDisplayName(proposalMd, cap.slug, cap.markdown),
    requirements: cap.markdown !== null ? parseSpecRequirements(cap.markdown) : [],
    rawMarkdown: cap.markdown,
  }));

  const parts: string[] = [];
  // Full standalone document wrapper. Unlike the skill/Artifact variant of
  // this template (where the publishing platform supplies the skeleton and
  // wrapper tags are forbidden), the CLI's primary consumption is a file://
  // open in a browser — without an explicit <meta charset="utf-8"> the
  // browser guesses the encoding and CJK content renders as mojibake
  // (caught in real-world acceptance, 2026-07-29).
  parts.push('<!doctype html>');
  parts.push('<html lang="zh-Hant">');
  parts.push('<head>');
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push(`<title>${escapeHtml(changeName)} · spec-viewer</title>`);
  parts.push(SPEC_VIEWER_STYLE);
  parts.push('</head>');
  parts.push('<body>');
  parts.push(renderHeader(changeName, gateStatuses, schemaAutoDefaulted));
  parts.push(renderRoute(station));
  parts.push(
    renderShell({
      changeName,
      capabilityViews,
      proposalMd,
      designMd,
      tasksMd,
      gatesFiles,
      emptySynthesisFiles,
      inconsistentSynthesisFiles,
    })
  );
  parts.push(SPEC_VIEWER_NAV_SCRIPT);
  parts.push('</body>');
  parts.push('</html>');

  return parts.join('\n');
}

// ── Filesystem reads (symlink-escape-safe) ────────────────────────────────
//
// Every read in this section goes through `resolveArtifactPath`/
// `readArtifactSafely`: the candidate path is resolved with `realpathSync`
// (following the *entire* symlink chain, not just the final segment) and
// the result MUST still sit inside `realBase` at a path-segment boundary.
// A relative path whose resolved target escapes that boundary — whether
// because the artifact file itself is a symlink, or because some
// directory earlier in the path is — is treated exactly like "this
// artifact does not exist": the corresponding section renders its normal
// "未產出" marker, nothing is read, and nothing throws.

function resolveRealBase(changeDir: string): string | null {
  try {
    return fs.realpathSync(changeDir);
  } catch {
    return null;
  }
}

function withinBoundary(real: string, realBase: string): boolean {
  return real === realBase || real.startsWith(realBase + path.sep);
}

/**
 * Resolves `relPath` (joined onto `realBase`) through the filesystem and
 * returns the real path only if it stays inside `realBase`; `null`
 * otherwise (missing entirely, broken symlink, or an out-of-bounds
 * escape — all three collapse to the same "not produced" outcome).
 */
function resolveArtifactPath(realBase: string, relPath: string): string | null {
  const candidate = path.join(realBase, relPath);
  let real: string;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return null;
  }
  return withinBoundary(real, realBase) ? real : null;
}

/**
 * Reads a file through a descriptor opened with `O_NOFOLLOW`: the kernel
 * atomically refuses a symlink at the final path component, closing the
 * window between any prior boundary check and the actual read (a regular
 * file swapped for an out-of-tree symlink mid-race would otherwise leak
 * arbitrary readable content into the generated HTML). Deliberately
 * stricter than the realpath boundary check alone: even an *in-bounds*
 * final-component symlink is treated as absent — artifacts are expected
 * to be regular files. Residual (documented, accepted): symlinks in
 * directory components; platforms without `O_NOFOLLOW` (Windows) fall
 * back to the realpath boundary check performed by callers.
 */
function readFileNoFollow(filePath: string): string | null {
  const O = fs.constants;
  const noFollow = typeof O.O_NOFOLLOW === 'number' ? O.O_NOFOLLOW : 0;
  let fd: number;
  try {
    fd = fs.openSync(filePath, O.O_RDONLY | noFollow);
  } catch {
    return null;
  }
  try {
    return fs.readFileSync(fd, 'utf-8');
  } catch {
    return null; // post-open read failure (e.g. EIO) degrades like open failure
  } finally {
    fs.closeSync(fd);
  }
}

function readArtifactSafely(realBase: string, relPath: string): string | null {
  const real = resolveArtifactPath(realBase, relPath);
  if (real === null) return null;
  // Read the boundary-verified *resolved* path, not the unresolved join —
  // every directory component of `real` was already resolved at check time,
  // shrinking the directory-component residual at zero cost; the final
  // component stays kernel-protected by O_NOFOLLOW either way.
  return readFileNoFollow(real);
}

/**
 * Per-entry guard for a `readdirSync` listing done on a boundary-checked
 * directory (`specs/`, `.gates/`). Distinguishes two very different
 * situations that both look like "can't stat it anymore":
 *
 * - The entry vanished (or was never lstat-able) between the `readdirSync`
 *   call and here — a plain race, not a security escape. It is let
 *   through; the caller's own subsequent read attempt will fail on its
 *   own and degrade gracefully (never silently dropped, never crashed).
 * - The entry IS an lstat-able symlink whose fully-resolved target sits
 *   outside `realBase` — a genuine escape attempt. This is the only case
 *   that gets excluded outright: the entry is treated as if it never
 *   existed, never followed, never read.
 */
function isEntryWithinBoundary(dirReal: string, entryName: string, realBase: string): boolean {
  const entryPath = path.join(dirReal, entryName);
  let st: fs.Stats;
  try {
    st = fs.lstatSync(entryPath);
  } catch {
    return true; // vanished mid-race — not an exclusion, let the read fail naturally
  }
  if (!st.isSymbolicLink()) return true;
  let real: string;
  try {
    real = fs.realpathSync(entryPath);
  } catch {
    return true; // dangling symlink — nothing to leak, let the read fail naturally
  }
  return withinBoundary(real, realBase);
}

interface CapabilitySpecFile {
  slug: string;
  /** `null` when the `specs/<slug>/` directory exists but has no
   * `spec.md` inside it — the capability MUST still be represented (as
   * "未產出"), never silently dropped from the output (spec Requirement:
   * 個別檔案缺席時對應區塊 MUST 標「未產出」而非省略). */
  markdown: string | null;
}

function readCapabilitySpecs(realBase: string): CapabilitySpecFile[] {
  const specsDirReal = resolveArtifactPath(realBase, 'specs');
  if (specsDirReal === null) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(specsDirReal, { withFileTypes: true });
  } catch {
    return [];
  }

  const slugs = entries
    .filter((e) => e.isDirectory() && isEntryWithinBoundary(specsDirReal, e.name, realBase))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  // Every capability directory is represented, even ones missing spec.md —
  // filtering those out here would make a scaffolded-but-empty capability
  // indistinguishable from one that never existed at all.
  return slugs.map((slug) => ({
    slug,
    markdown: readArtifactSafely(realBase, path.join('specs', slug, 'spec.md')),
  }));
}

export interface GatesFileEntry {
  filename: string;
  raw: string;
  data: unknown;
  /** True when the file was listed by `readdirSync` but could no longer be
   * read by the time `readFileSync` ran (deleted/replaced mid-race). The
   * evidence section then shows a "無法讀取" marker for just this one file
   * instead of raw content, and the whole render still completes — a
   * single vanished evidence file MUST NOT crash the entire command. */
  unreadable?: boolean;
}

function readGatesFiles(realBase: string): GatesFileEntry[] {
  const gatesDirReal = resolveArtifactPath(realBase, '.gates');
  if (gatesDirReal === null) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(gatesDirReal, { withFileTypes: true });
  } catch {
    return [];
  }

  const filenames = entries
    .filter(
      (e) => e.isFile() && e.name.toLowerCase().endsWith('.json') && isEntryWithinBoundary(gatesDirReal, e.name, realBase)
    )
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  return filenames.map((filename) => {
    // .gates race: the directory listing above and this read are not
    // atomic — a file can be deleted or *replaced with an out-of-tree
    // symlink* in the gap between them. `readFileNoFollow` closes the
    // symlink half of that race at the kernel level (O_NOFOLLOW); a
    // vanished/unopenable file degrades just this one entry to
    // "unreadable", never crashing the whole render.
    const raw = readFileNoFollow(path.join(gatesDirReal, filename));
    if (raw === null) {
      return { filename, raw: '', data: undefined, unreadable: true };
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      data = undefined;
    }
    return { filename, raw, data };
  });
}

// ── Lifecycle station (station-inference heuristic per design.md Decision 4; conservative
//    by construction — ties/ambiguity resolve to the earlier station) ────

export interface StationInput {
  changeDir: string;
  hasProposal: boolean;
  tasksMd: string | null;
  gatesFilenames: string[];
}

export function determineStation(input: StationInput): LifecycleStation {
  const normalized = input.changeDir.split(path.sep).join('/');
  if (/\/changes\/archive(\/|$)/.test(normalized)) return 'archive';

  const hasPostApplyEvidence = input.gatesFilenames.some(
    (name) => /verify/i.test(name) || /handoff/i.test(name) || /scorecard/i.test(name)
  );
  if (hasPostApplyEvidence) return 'verify';

  const hasCheckedTask = input.tasksMd !== null && /-\s*\[[xX]\]/.test(input.tasksMd);
  if (hasCheckedTask) return 'apply';

  if (input.hasProposal) return 'propose';

  return 'explore';
}

// ── Gate declarations (schema-driven) + status resolution ────────────────

export function collectGateIdsForStation(schema: SchemaYaml | null, station: LifecycleStation): string[] {
  if (!schema) return [];
  const phaseKey: 'propose' | 'verify' = station === 'verify' || station === 'archive' ? 'verify' : 'propose';
  const phase = schema[phaseKey];
  const pre = phase?.gates?.pre ?? [];
  const post = phase?.gates?.post ?? [];
  const ids: string[] = [];
  for (const gate of [...pre, ...post]) {
    if (!ids.includes(gate.id)) ids.push(gate.id);
  }
  return ids;
}

export type GateState = 'pass' | 'fail' | 'pending' | 'missing';

export interface GateStatus {
  id: string;
  state: GateState;
}

interface SynthesisShape {
  total: number;
  passed?: number;
  results: Array<{ id: string; passed: boolean; ai_review_needed?: boolean }>;
}

function isSynthesisResultEntry(
  value: unknown
): value is { id: string; passed: boolean; ai_review_needed?: boolean } {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== 'string') return false;
  if (typeof entry.passed !== 'boolean') return false;
  if (entry.ai_review_needed !== undefined && typeof entry.ai_review_needed !== 'boolean') return false;
  return true;
}

/**
 * A file only counts as a trustworthy synthesis report when `total` and
 * (if present) `passed` are numbers AND every `results` entry is a
 * well-shaped `{id: string, passed: boolean}` object. A single malformed
 * entry (`null`, a non-object, wrong field types) degrades the WHOLE file
 * to "unrecognized JSON shape" — shown as raw evidence, never used to
 * derive a gate status — rather than crashing on it or silently
 * cherry-picking the valid-looking entries (P1a/P2e: this is also what
 * stops `results: [null]` from throwing when a status would otherwise be
 * derived from `result.id`/`result.passed` on a `null` entry).
 */
function isSynthesisShape(data: unknown): data is SynthesisShape {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.total !== 'number') return false;
  if (!Array.isArray(obj.results)) return false;
  if (obj.passed !== undefined && typeof obj.passed !== 'number') return false;
  return obj.results.every(isSynthesisResultEntry);
}

type SynthesisTrust = 'ok' | 'empty' | 'inconsistent';

/**
 * Classifies a (shape-validated) synthesis report's trustworthiness:
 * - `'empty'`: legitimately never run (`total: 0` AND `results: []`) —
 *   honestly reported, just hasn't executed yet.
 * - `'inconsistent'`: `total` doesn't match `results.length` — e.g.
 *   `total: 0` but `results` non-empty, or vice versa. This is either a
 *   forged/hand-edited file or a synthesis bug; either way the file MUST
 *   NOT be trusted to source a gate status (never a green gate from a
 *   contradictory file).
 * - `'ok'`: consistent and non-empty; safe to derive gate statuses from.
 */
function classifySynthesisTrust(data: SynthesisShape): SynthesisTrust {
  if (data.total === 0 && data.results.length === 0) return 'empty';
  if (data.total !== data.results.length) return 'inconsistent';
  return 'ok';
}

interface ResolvedGateShape {
  id: string;
  passed: boolean;
}

function isResolvedGateShape(data: unknown): data is ResolvedGateShape {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.id === 'string' && typeof obj.passed === 'boolean' && !Array.isArray(obj.results);
}

export interface ComputeGateStatusesResult {
  statuses: GateStatus[];
  /** Filenames of `.gates/*.json` files that parsed as a synthesis report
   * but were legitimately never run (`total: 0` AND `results: []`) —
   * evidence exists on disk but the gate run never actually happened
   * (spec Requirement: gate 誠實呈現). */
  emptySynthesisFiles: string[];
  /** Filenames of `.gates/*.json` files that parsed as a synthesis report
   * but were internally inconsistent (`total` doesn't match
   * `results.length`, e.g. `total: 0` with non-empty `results`) — treated
   * as untrustworthy and NEVER used to derive a gate status, so a
   * forged/edited evidence file can't smuggle a green gate through. */
  inconsistentSynthesisFiles: string[];
}

export function computeGateStatuses(
  gateIds: string[],
  gatesFiles: GatesFileEntry[]
): ComputeGateStatusesResult {
  const byId = new Map<string, { passed: boolean; ai_review_needed?: boolean }>();
  const emptySynthesisFiles: string[] = [];
  const inconsistentSynthesisFiles: string[] = [];

  const sorted = [...gatesFiles].sort((a, b) => a.filename.localeCompare(b.filename));
  for (const file of sorted) {
    if (isSynthesisShape(file.data)) {
      const trust = classifySynthesisTrust(file.data);
      if (trust !== 'ok') {
        (trust === 'empty' ? emptySynthesisFiles : inconsistentSynthesisFiles).push(file.filename);
        // Untrustworthy file (never run, or internally inconsistent):
        // never populate `byId` from it — a forged `total: 0` file with
        // non-empty passing `results` MUST NOT be able to produce a green
        // gate.
        continue;
      }
      for (const result of file.data.results) {
        byId.set(result.id, { passed: result.passed, ai_review_needed: result.ai_review_needed });
      }
    } else if (isResolvedGateShape(file.data)) {
      byId.set(file.data.id, { passed: file.data.passed });
    }
    // Unrecognized JSON shape: not used for status, still shown as raw
    // evidence in the Gate 證據 section.
  }

  // Schema declared no gates for this station: fall back to whatever gate
  // ids actually appear in evidence rather than rendering nothing
  // (design.md Decision 4: "讀不到宣告時只渲染 evidence 內實際出現過的 id").
  const idsToRender = gateIds.length > 0 ? gateIds : Array.from(byId.keys()).sort();

  const statuses: GateStatus[] = idsToRender.map((id) => {
    const entry = byId.get(id);
    if (!entry) return { id, state: 'missing' };
    if (!entry.passed) return { id, state: 'fail' };
    if (entry.ai_review_needed) return { id, state: 'pending' };
    return { id, state: 'pass' };
  });

  return { statuses, emptySynthesisFiles, inconsistentSynthesisFiles };
}

// ── Capability display name resolution ────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Priority order (conventions.md "capability 顯示名"): (1) the proposal's
 * Capabilities list line for this slug's spec file — the description after
 * the dash; (2) the spec.md's own first `# heading`, if it isn't just the
 * slug restated; (3) fall back to the slug itself.
 */
function resolveCapabilityDisplayName(
  proposalMd: string | null,
  slug: string,
  specMarkdown: string | null
): string {
  if (proposalMd) {
    const pattern = new RegExp(
      `specs/${escapeRegExp(slug)}/spec\\.md[^\\n]*?[\\u2014-]\\s*(.+)`,
      'i'
    );
    const match = proposalMd.match(pattern);
    if (match) {
      const desc = match[1].trim().replace(/[.:;,。，]+$/, '').trim();
      if (desc.length > 0) return desc;
    }
  }

  if (specMarkdown !== null) {
    const headingMatch = specMarkdown.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      const title = headingMatch[1].trim();
      if (title.length > 0 && sanitizeId(title, '') !== slug) {
        return title;
      }
    }
  }

  return slug;
}

// ── HTML assembly ─────────────────────────────────────────────────────────

function renderHeader(changeName: string, gateStatuses: GateStatus[], schemaAutoDefaulted: boolean): string {
  const pills =
    gateStatuses.length > 0
      ? gateStatuses
          .map((g) => {
            const suffix = g.state === 'missing' ? '（未產出）' : '';
            return `<span class="spec-gate ${g.state}"><span class="dot"></span> ${escapeHtml(g.id)}${suffix}</span>`;
          })
          .join('\n    ')
      : '<span class="spec-gate missing"><span class="dot"></span> 無已宣告的 gate</span>';

  const lines = [
    '<div class="spec-header">',
    `  <h1>${escapeHtml(changeName)}</h1>`,
    '  <div class="spec-gate-row">',
    `    ${pills}`,
    '  </div>',
  ];
  if (schemaAutoDefaulted) {
    // `.openspec.yaml` was absent; the gate set above comes from a
    // silently-applied default schema, not a real declaration — say so
    // explicitly rather than let a guessed default look authoritative
    // (spec Requirement "artifacts 讀取與缺席處理").
    lines.push('  <p class="spec-missing">schema 未宣告，依預設</p>');
  }
  lines.push('</div>');
  return lines.join('\n');
}

function renderRoute(station: LifecycleStation): string {
  const currentIndex = LIFECYCLE_STATIONS.indexOf(station);
  const items: string[] = [];
  LIFECYCLE_STATIONS.forEach((name, index) => {
    if (index > 0) {
      const connectorDone = index <= currentIndex;
      items.push(`<li class="connector${connectorDone ? ' done' : ''}"></li>`);
    }
    let cls = 'station';
    if (index < currentIndex) cls += ' done';
    else if (index === currentIndex) cls += ' current';
    items.push(`<li class="${cls}">${name}</li>`);
  });

  return [
    '<nav class="spec-route" aria-label="生命週期路線圖">',
    '  <ol class="spec-route-line">',
    `    ${items.join('\n    ')}`,
    '  </ol>',
    '</nav>',
  ].join('\n');
}

interface CapabilityView {
  slug: string;
  displayName: string;
  requirements: ParsedRequirement[];
  /** `null` when `specs/<slug>/spec.md` doesn't exist at all; the raw
   * (unescaped) markdown otherwise — used as the fallback render when
   * `requirements` came back empty because the content isn't in delta-spec
   * shape (spec Requirement: 非標準 markdown 結構 MUST 以原文區塊呈現). */
  rawMarkdown: string | null;
}

interface ShellInput {
  changeName: string;
  capabilityViews: CapabilityView[];
  proposalMd: string | null;
  designMd: string | null;
  tasksMd: string | null;
  gatesFiles: GatesFileEntry[];
  emptySynthesisFiles: string[];
  inconsistentSynthesisFiles: string[];
}

function renderShell(input: ShellInput): string {
  return [
    '<div class="spec-shell">',
    '  <button type="button" class="spec-drawer-toggle" aria-controls="spec-sidebar" aria-expanded="false">',
    '    ☰ 內容導覽',
    '  </button>',
    renderSidebar(input.changeName, input.capabilityViews),
    '  <main class="spec-main">',
    renderProposalSection(input.proposalMd),
    ...renderSpecsSections(input.capabilityViews),
    renderTasksSection(input.tasksMd),
    renderDesignSection(input.designMd),
    renderGateEvidenceSection(input.gatesFiles, input.emptySynthesisFiles, input.inconsistentSynthesisFiles),
    '  </main>',
    '</div>',
  ].join('\n');
}

function requirementId(capSlug: string, index: number): string {
  return `req-${sanitizeId(capSlug, 'capability')}-${index + 1}`;
}

function scenarioId(reqId: string, index: number): string {
  return `${reqId}-s${index + 1}`;
}

function renderSidebar(changeName: string, capabilityViews: CapabilityView[]): string {
  const lines: string[] = [
    '  <nav class="spec-sidebar" id="spec-sidebar" aria-label="內容導覽樹">',
    `    <p class="spec-tree-title">${escapeHtml(changeName)}</p>`,
    `    <p class="spec-tree-legend">${escapeHtml(TREE_LEGEND_TEXT)}</p>`,
  ];

  if (capabilityViews.length === 0) {
    lines.push('    <p class="spec-missing">specs/ 未產出</p>');
  } else {
    for (const cap of capabilityViews) {
      lines.push('    <details open class="spec-tree-node">');
      lines.push('      <summary>');
      lines.push(
        `        <span class="spec-tier cap">規格</span><span class="spec-tree-cap-name">${escapeHtml(cap.displayName)}</span>`
      );
      lines.push('      </summary>');
      lines.push(`      <span class="spec-tree-cap-slug">${escapeHtml(cap.slug)}</span>`);
      lines.push('      <ul>');
      cap.requirements.forEach((req, reqIndex) => {
        const reqId = requirementId(cap.slug, reqIndex);
        lines.push('        <li>');
        lines.push(
          `          <a class="spec-tree-link" href="#${reqId}" data-target="${reqId}"><span class="spec-tier req">需求</span>${escapeHtml(req.name)}</a>`
        );
        if (req.scenarios.length > 0) {
          lines.push('          <ul>');
          req.scenarios.forEach((scn, scnIndex) => {
            const scnId = scenarioId(reqId, scnIndex);
            lines.push(
              `            <li><a class="spec-tree-link" href="#${scnId}" data-target="${scnId}"><span class="spec-tier scn">情境</span>${escapeHtml(scn.name)}</a></li>`
            );
          });
          lines.push('          </ul>');
        }
        lines.push('        </li>');
      });
      lines.push('      </ul>');
      lines.push('    </details>');
    }
  }

  // Block-level fallback links always present so proposal/tasks/design/gate
  // evidence stay reachable from the tree even when specs/ is empty
  // (conventions.md "specs 為零時" — the CLI keeps this even when specs
  // exist, it's cheap and harmless).
  lines.push('    <ul>');
  lines.push('      <li><a class="spec-tree-link" href="#proposal" data-target="proposal">Proposal</a></li>');
  lines.push('      <li><a class="spec-tree-link" href="#tasks" data-target="tasks">Tasks</a></li>');
  lines.push('      <li><a class="spec-tree-link" href="#design" data-target="design">Design</a></li>');
  lines.push(
    '      <li><a class="spec-tree-link" href="#gate-evidence" data-target="gate-evidence">Gate 證據</a></li>'
  );
  lines.push('    </ul>');
  lines.push('  </nav>');

  return lines.join('\n');
}

function renderMarkdownRaw(markdown: string): string {
  const segments = splitMermaidSegments(markdown);
  const html: string[] = [];
  for (const seg of segments) {
    if (seg.content.trim().length === 0) continue;
    if (seg.kind === 'mermaid') {
      html.push(`<pre class="mermaid">${escapeHtml(seg.content)}</pre>`);
    } else {
      html.push(`<pre class="spec-raw">${escapeHtml(seg.content)}</pre>`);
    }
  }
  return html.join('\n');
}

function renderProposalSection(proposalMd: string | null): string {
  if (proposalMd === null) {
    return [
      '    <section id="proposal" class="spec-card">',
      '      <h3>Proposal</h3>',
      '      <div class="spec-missing">proposal.md 未產出</div>',
      '    </section>',
    ].join('\n');
  }

  const sections = splitLevel2Sections(proposalMd);
  const body: string[] = [];
  for (const section of sections) {
    const rendered = renderMarkdownRaw(section.body);
    if (rendered.length === 0) continue;
    if (section.title.toLowerCase() === 'why') {
      body.push('      <h4>Why</h4>');
      body.push(rendered);
    } else {
      body.push('      <details class="spec-collapse">');
      body.push(`        <summary>${escapeHtml(section.title || 'Overview')}</summary>`);
      body.push(rendered);
      body.push('      </details>');
    }
  }

  return [
    '    <section id="proposal" class="spec-card">',
    '      <h3>Proposal</h3>',
    ...body,
    '    </section>',
  ].join('\n');
}

function renderDesignSection(designMd: string | null): string {
  if (designMd === null) {
    return [
      '    <section id="design" class="spec-card">',
      '      <h3>Design</h3>',
      '      <div class="spec-missing">design.md 未產出</div>',
      '    </section>',
    ].join('\n');
  }

  const sections = splitLevel2Sections(designMd);
  const body: string[] = [];
  for (const section of sections) {
    const rendered = renderMarkdownRaw(section.body);
    if (rendered.length === 0) continue;
    body.push('      <details class="spec-collapse">');
    body.push(`        <summary>${escapeHtml(section.title || 'Overview')}</summary>`);
    body.push(rendered);
    body.push('      </details>');
  }

  return ['    <section id="design" class="spec-card">', '      <h3>Design</h3>', ...body, '    </section>'].join(
    '\n'
  );
}

function renderSpecsSections(capabilityViews: CapabilityView[]): string[] {
  if (capabilityViews.length === 0) {
    return [
      [
        '    <section id="specs" class="spec-card">',
        '      <h3>Specs</h3>',
        '      <div class="spec-missing">specs/ 未產出</div>',
        '    </section>',
      ].join('\n'),
    ];
  }

  return capabilityViews.map((cap) => renderCapabilitySection(cap));
}

function renderCapabilitySection(cap: CapabilityView): string {
  // P2d: specs/<slug>/ exists but has no spec.md at all — mark "未產出"
  // rather than silently omitting the capability from the output.
  if (cap.rawMarkdown === null) {
    return [
      `    <section id="specs-${sanitizeId(cap.slug, 'capability')}" class="spec-card">`,
      `      <h3>Specs · ${escapeHtml(cap.slug)}</h3>`,
      '      <div class="spec-missing">spec.md 未產出</div>',
      '    </section>',
    ].join('\n');
  }

  // P2c: spec.md exists but parseSpecRequirements found no delta-format
  // `### Requirement:` blocks in it (non-delta content, prose, malformed
  // structure, ...) — fall back to the escaped raw content, matching how
  // non-standard markdown is handled everywhere else in this renderer,
  // instead of silently dropping it behind an empty requirements table.
  if (cap.requirements.length === 0) {
    const rendered = renderMarkdownRaw(cap.rawMarkdown);
    return [
      `    <section id="specs-${sanitizeId(cap.slug, 'capability')}" class="spec-card">`,
      `      <h3>Specs · ${escapeHtml(cap.slug)}</h3>`,
      '      <div class="spec-missing">未解析出標準 Requirement 區塊，以下為原始內容</div>',
      rendered,
      '    </section>',
    ].join('\n');
  }

  const scenarioCount = cap.requirements.reduce((sum, r) => sum + r.scenarios.length, 0);
  const rows: string[] = [];
  const details: string[] = [];

  cap.requirements.forEach((req, reqIndex) => {
    const reqId = requirementId(cap.slug, reqIndex);
    const pillsHtml = req.pills.map((p) => `<span class="spec-pill ${p.cls}">${p.label}</span>`).join(' ');

    rows.push('          <tr>');
    rows.push(`            <td><a href="#${reqId}">${escapeHtml(req.name)}</a></td>`);
    rows.push(`            <td class="pills">${pillsHtml}</td>`);
    rows.push(`            <td class="count">${req.scenarios.length}</td>`);
    rows.push('          </tr>');

    details.push(`      <div id="${reqId}" class="spec-requirement">`);
    details.push(`        <h4>Requirement: ${escapeHtml(req.name)}</h4>`);
    if (req.descriptionText.length > 0) {
      details.push(`        <p>${escapeHtml(req.descriptionText)}</p>`);
    }
    if (req.scenarios.length > 0) {
      details.push('        <details class="spec-collapse">');
      details.push(`          <summary>情境（${req.scenarios.length}）</summary>`);
      req.scenarios.forEach((scn, scnIndex) => {
        const scnId = scenarioId(reqId, scnIndex);
        details.push(`          <div id="${scnId}" class="spec-scenario">`);
        details.push(`            <div class="name">Scenario: ${escapeHtml(scn.name)}</div>`);
        if (scn.rawFallback !== null) {
          details.push(`            <pre class="spec-raw">${escapeHtml(scn.rawFallback)}</pre>`);
        } else {
          details.push('            <dl>');
          for (const row of scn.rows) {
            details.push(`              <dt>${row.label}</dt><dd>${escapeHtml(row.text)}</dd>`);
          }
          details.push('            </dl>');
        }
        details.push('          </div>');
      });
      details.push('        </details>');
    }
    details.push('      </div>');
  });

  return [
    `    <section id="specs-${sanitizeId(cap.slug, 'capability')}" class="spec-card">`,
    `      <h3>Specs · ${escapeHtml(cap.slug)}</h3>`,
    '      <div class="spec-scroll-x">',
    '        <table class="spec-req-table">',
    `          <caption>${cap.requirements.length} 個需求 · ${scenarioCount} 個場景</caption>`,
    '          <thead><tr><th>Requirement</th><th>規範語氣</th><th>場景</th></tr></thead>',
    '          <tbody>',
    ...rows,
    '          </tbody>',
    '        </table>',
    '      </div>',
    ...details,
    '    </section>',
  ].join('\n');
}

function renderTasksSection(tasksMd: string | null): string {
  if (tasksMd === null) {
    return [
      '    <section id="tasks" class="spec-card">',
      '      <h3>Tasks</h3>',
      '      <div class="spec-missing">tasks.md 未產出</div>',
      '    </section>',
    ].join('\n');
  }

  const groups = parseTaskGroups(tasksMd);
  if (groups.length === 0) {
    return [
      '    <section id="tasks" class="spec-card">',
      '      <h3>Tasks</h3>',
      '      <div class="spec-missing">tasks.md 內沒有解析出任何群組</div>',
      '    </section>',
    ].join('\n');
  }

  const completedGroups = groups.filter((g) => g.items.length > 0 && g.items.every((i) => i.done)).length;
  const overallPct = Math.round((completedGroups / groups.length) * 100);

  const body: string[] = [
    '      <div class="spec-progress-wrap">',
    `        <div class="spec-progress"><span style="width: ${overallPct}%"></span></div>`,
    `        <span class="spec-progress-label">${completedGroups} / ${groups.length} 群組完成（${overallPct}%）</span>`,
    '      </div>',
  ];

  for (const group of groups) {
    body.push(...renderTaskGroup(group));
  }

  return ['    <section id="tasks" class="spec-card">', '      <h3>Tasks</h3>', ...body, '    </section>'].join('\n');
}

function renderTaskGroup(group: TaskGroup): string[] {
  const done = group.items.filter((i) => i.done).length;
  const total = group.items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const rows = group.items.map((item) => {
    const stateCls = item.done ? 'done' : 'todo';
    const check = item.done ? '☑' : '☐';
    return [
      `              <tr class="${stateCls}">`,
      `                <td class="check">${check}</td>`,
      `                <td class="no">${escapeHtml(item.id)}</td>`,
      `                <td>${escapeHtml(item.text)}</td>`,
      '              </tr>',
    ].join('\n');
  });

  return [
    '      <details class="spec-collapse spec-task-group">',
    '        <summary>',
    `          <span class="spec-task-group-name">${escapeHtml(group.name)}</span>`,
    `          <span class="spec-progress"><span style="width: ${pct}%"></span></span>`,
    `          <span class="spec-progress-label">${done} / ${total} 任務</span>`,
    '        </summary>',
    '        <div class="spec-scroll-x">',
    '          <table class="spec-task-table">',
    '            <thead><tr><th>完成</th><th>編號</th><th>內容</th></tr></thead>',
    '            <tbody>',
    ...rows,
    '            </tbody>',
    '          </table>',
    '        </div>',
    '      </details>',
  ];
}

function renderGateEvidenceBadge(file: GatesFileEntry): string {
  if (isSynthesisShape(file.data)) {
    if (classifySynthesisTrust(file.data) !== 'ok') {
      return '<span class="spec-gate missing"><span class="dot"></span> 未實際執行</span>';
    }
    const passedCount = file.data.passed ?? file.data.results.filter((r) => r.passed).length;
    const state = passedCount === file.data.total ? 'pass' : 'fail';
    // Every gate-JSON-derived value is escaped with no exceptions, even
    // though `isSynthesisShape` already constrains these to numbers — the
    // escaping is defense-in-depth, not a substitute for the type check
    // (spec Requirement: 產出單檔自足且跳脫無例外).
    return `<span class="spec-gate ${state}"><span class="dot"></span> ${escapeHtml(String(passedCount))} / ${escapeHtml(String(file.data.total))} passed</span>`;
  }
  if (isResolvedGateShape(file.data)) {
    const state = file.data.passed ? 'pass' : 'fail';
    const label = file.data.passed ? 'PASS' : 'FAIL';
    return `<span class="spec-gate ${state}"><span class="dot"></span> ${label}</span>`;
  }
  return '';
}

function renderGateEvidenceSection(
  gatesFiles: GatesFileEntry[],
  emptySynthesisFiles: string[],
  inconsistentSynthesisFiles: string[]
): string {
  if (gatesFiles.length === 0) {
    return [
      '    <section id="gate-evidence" class="spec-card">',
      '      <h3>Gate 證據</h3>',
      '      <div class="spec-missing">.gates/ 未產出</div>',
      '    </section>',
    ].join('\n');
  }

  const body: string[] = [];
  for (const file of gatesFiles) {
    const badge = renderGateEvidenceBadge(file);
    body.push('      <details class="spec-collapse">');
    body.push(`        <summary>${escapeHtml(file.filename)}${badge ? ' ' + badge : ''}</summary>`);
    if (file.unreadable) {
      // (4) .gates race: listed by readdirSync but gone (or unreadable) by
      // the time readFileSync ran. Distinct from every other case below —
      // there is no raw content to show at all, so the <pre> block itself
      // is skipped rather than rendered empty.
      body.push('        <p class="spec-missing">無法讀取（列出目錄後檔案可能已被刪除或替換）</p>');
    } else {
      if (inconsistentSynthesisFiles.includes(file.filename)) {
        // P1b: total:0-with-non-empty-results (or any total/results.length
        // mismatch) is a forged/inconsistent file — distinct message from the
        // legitimate "hasn't run yet" case, and NEVER sourced for a green
        // gate (see computeGateStatuses).
        body.push(
          '        <p class="spec-missing">證據不一致（total 與 results 長度矛盾，整檔視為不可信，不採用其中的任何綠燈）</p>'
        );
      } else if (emptySynthesisFiles.includes(file.filename)) {
        body.push(
          '        <p class="spec-missing">檔案存在但未實際執行（total: 0）</p>'
        );
      }
      body.push(`        <pre class="spec-raw">${escapeHtml(file.raw)}</pre>`);
    }
    body.push('      </details>');
  }

  return ['    <section id="gate-evidence" class="spec-card">', '      <h3>Gate 證據</h3>', ...body, '    </section>'].join(
    '\n'
  );
}
