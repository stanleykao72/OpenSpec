import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderChangeHtml,
  determineStation,
  collectGateIdsForStation,
  computeGateStatuses,
  type GatesFileEntry,
} from '../../../src/core/render/html.js';
import type { SchemaYaml } from '../../../src/core/artifact-graph/types.js';

// vitest/ESM cannot `vi.spyOn` a named export of a module namespace object
// directly ("Cannot redefine property: readFileSync") — `node:fs` has to be
// mocked at the module level instead. `readFileFailurePath` is a mutable,
// test-controlled switch (hoisted so the `vi.mock` factory below can close
// over it, since vitest hoists both `vi.mock` and `vi.hoisted` calls above
// every import regardless of their textual position in the file): every
// OTHER `fs` function is passed through untouched via `...actual`, and
// `readFileSync` itself only misbehaves for the one exact path a test opts
// into via `armReadFileFailure`/`disarmReadFileFailure` — used by the (4)
// ".gates race" test to simulate a file vanishing between `readdirSync` and
// the subsequent `readFileSync`.
const readFileFailurePath = vi.hoisted(() => ({ current: null as string | null }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      const [filePath] = args;
      if (
        readFileFailurePath.current !== null &&
        typeof filePath === 'string' &&
        path.resolve(filePath) === readFileFailurePath.current
      ) {
        const err = new Error('ENOENT: no such file or directory, open ' + filePath) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return actual.readFileSync(...args);
    }) as typeof actual.readFileSync,
    // The renderer reads artifact/gate files via openSync(O_NOFOLLOW) + a
    // file descriptor (TOCTOU-free read path), so the "file vanished
    // mid-race" simulation must also fire at the open — the fd-based
    // readFileSync call afterwards never sees a string path to match on.
    openSync: ((...args: Parameters<typeof actual.openSync>) => {
      const [filePath] = args;
      if (
        readFileFailurePath.current !== null &&
        typeof filePath === 'string' &&
        path.resolve(filePath) === readFileFailurePath.current
      ) {
        const err = new Error('ENOENT: no such file or directory, open ' + filePath) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return actual.openSync(...args);
    }) as typeof actual.openSync,
  };
});

function armReadFileFailure(absolutePath: string): void {
  readFileFailurePath.current = path.resolve(absolutePath);
}

function disarmReadFileFailure(): void {
  readFileFailurePath.current = null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/html-changes');

/** Builds an ad-hoc change directory in a fresh temp dir for tests that need
 * artifact shapes not covered by the static fixtures under FIXTURES_DIR. */
function withTempChangeDir(files: Record<string, string>, run: (changeDir: string) => void): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-html-render-'));
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

function schemaWithGates(): SchemaYaml {
  return {
    name: 'test-schema',
    version: 1,
    artifacts: [],
    propose: {
      gates: {
        pre: [
          { id: 'structural-alignment', check: 'x', severity: 'blocking' },
          { id: 'traceability', check: 'x', severity: 'blocking' },
        ],
        post: [
          { id: 'grill-me-quick', check: 'ai-review', severity: 'blocking' },
          { id: 'spec-lint', check: 'x', severity: 'blocking' },
          { id: 'precommit', check: 'command', severity: 'blocking' },
        ],
      },
    },
  } as unknown as SchemaYaml;
}

describe('renderChangeHtml — complete change fixture', () => {
  const changeDir = path.join(FIXTURES_DIR, 'complete-change');
  const html = renderChangeHtml({ changeDir, changeName: 'complete-change', schema: schemaWithGates() });

  it('emits a full standalone document: doctype + charset in head, each wrapper exactly once (CLI output is opened via file://, where a missing charset renders CJK as mojibake)', () => {
    const lower = html.toLowerCase();
    expect(lower.startsWith('<!doctype html>')).toBe(true);
    expect(html.match(/<html[\s>]/g)).toHaveLength(1);
    expect(html.match(/<head>/g)).toHaveLength(1);
    expect(html.match(/<body>/g)).toHaveLength(1);
    // charset MUST appear inside <head> and early (browsers only honor it
    // within the first 1024 bytes)
    const headIdx = html.indexOf('<head>');
    const charsetIdx = html.indexOf('<meta charset="utf-8">');
    expect(charsetIdx).toBeGreaterThan(headIdx);
    expect(charsetIdx).toBeLessThan(1024);
    expect(html.match(/<\/html>/g)).toHaveLength(1);
  });

  it('references zero external resources', () => {
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<img\b[^>]*\ssrc=/i);
  });

  it('renders the requirement summary table and detail with consistent ids', () => {
    expect(html).toContain('id="req-widget-export-1"');
    expect(html).toContain('href="#req-widget-export-1"');
    expect(html).toContain('data-target="req-widget-export-1"');
    expect(html).toContain('id="req-widget-export-1-s1"');
    expect(html).toContain('data-target="req-widget-export-1-s1"');
  });

  it('renders SHALL/MUST pills for requirement text', () => {
    expect(html).toContain('<span class="spec-pill shall">SHALL</span>');
  });

  it('renders WHEN/THEN dl rows for a standard scenario', () => {
    expect(html).toContain('<dt>WHEN</dt><dd>the user clicks Export</dd>');
    expect(html).toContain('<dt>THEN</dt><dd>a file is downloaded</dd>');
  });

  it('escapes MUST/MUST NOT scenario text safely', () => {
    expect(html).toContain('MUST show an offline error and MUST NOT queue the job');
  });

  it('honestly reflects gate statuses: pass, fail, pending, missing', () => {
    expect(html).toContain('<span class="spec-gate pass"><span class="dot"></span> structural-alignment</span>');
    expect(html).toContain('<span class="spec-gate fail"><span class="dot"></span> traceability</span>');
    expect(html).toContain('<span class="spec-gate pending"><span class="dot"></span> grill-me-quick</span>');
    expect(html).toContain('<span class="spec-gate missing"><span class="dot"></span> spec-lint（未產出）</span>');
    expect(html).toContain('<span class="spec-gate pass"><span class="dot"></span> precommit</span>');
  });

  it('renders the lifecycle route with apply as current (tasks partially checked, no post-apply evidence)', () => {
    expect(html).toContain('<li class="station current">apply</li>');
    expect(html).toContain('<li class="station done">explore</li>');
    expect(html).toContain('<li class="station done">propose</li>');
  });

  it('renders task groups with group-counted progress, not raw task totals', () => {
    // Group 1 (1.1, 1.2) fully done; group 2 (2.1 done, 2.2 not) incomplete.
    // → 1 / 2 groups complete (50%), even though 3 / 4 individual tasks are done.
    expect(html).toContain('1 / 2 群組完成（50%）');
  });

  it('converts a mermaid fence to <pre class="mermaid"> with escaped arrows', () => {
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain('U-&gt;&gt;S: Request export');
    expect(html).toContain('S--&gt;&gt;U: Job accepted');
  });
});

describe('renderChangeHtml — incomplete change fixture', () => {
  const changeDir = path.join(FIXTURES_DIR, 'incomplete-change');
  const html = renderChangeHtml({ changeDir, changeName: 'incomplete-change', schema: null });

  it('marks design, specs, and gate evidence as 未產出 without failing', () => {
    expect(html).toContain('design.md 未產出');
    expect(html).toContain('specs/ 未產出');
    expect(html).toContain('.gates/ 未產出');
  });

  it('still renders the proposal and tasks that do exist', () => {
    expect(html).toContain('Just getting started');
    expect(html).toContain('Write proposal');
  });

  it('does not render a green gate anywhere when no schema/evidence exists', () => {
    expect(html).not.toMatch(/spec-gate pass/);
  });
});

describe('renderChangeHtml — adversarial fixture', () => {
  const changeDir = path.join(FIXTURES_DIR, 'adversarial-change');
  const html = renderChangeHtml({ changeDir, changeName: 'adversarial-change', schema: null });

  it('escapes a literal <script> tag from proposal.md to text only', () => {
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('escapes a literal <img onerror> from the spec scenario', () => {
    expect(html).toContain('&lt;img onerror=alert(1)&gt;');
    expect(html).not.toMatch(/<img[^>]*onerror/i);
  });

  it('escapes the adversarial gate JSON payload inside the raw evidence block', () => {
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('marks the empty-synthesis gate evidence as not actually executed, not green', () => {
    expect(html).toContain('檔案存在但未實際執行');
    expect(html).not.toMatch(/spec-gate pass/);
  });

  it('produces no new executable node: every remaining "<" is part of an entity or a known safe tag', () => {
    // Strip all entities, then every remaining "<" must open one of the
    // fixed set of tags this renderer ever emits.
    const KNOWN_TAGS = [
      'title', 'style', 'div', 'h1', 'h3', 'h4', 'nav', 'ol', 'li', 'button', 'main', 'section',
      'details', 'summary', 'span', 'p', 'ul', 'a', 'table', 'caption', 'thead', 'tr', 'th', 'tbody',
      'td', 'dl', 'dt', 'dd', 'pre', 'script',
      // standalone-document wrapper (CLI emits a full document with charset
      // — see the wrapper test in the complete-change describe block)
      'html', 'head', 'meta', 'body',
    ];
    const tagOpenRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)/g;
    let match: RegExpExecArray | null;
    const unexpected: string[] = [];
    while ((match = tagOpenRe.exec(html)) !== null) {
      if (!KNOWN_TAGS.includes(match[1].toLowerCase())) unexpected.push(match[1]);
    }
    expect(unexpected).toEqual([]);
  });
});

describe('renderChangeHtml — determinism', () => {
  it('produces byte-identical output across repeated renders of the same fixture', () => {
    const changeDir = path.join(FIXTURES_DIR, 'complete-change');
    const first = renderChangeHtml({ changeDir, changeName: 'complete-change', schema: schemaWithGates() });
    const second = renderChangeHtml({ changeDir, changeName: 'complete-change', schema: schemaWithGates() });
    expect(first).toBe(second);
  });

  it('never embeds a wall-clock timestamp or random value of its own', () => {
    const changeDir = path.join(FIXTURES_DIR, 'complete-change');
    const html = renderChangeHtml({ changeDir, changeName: 'complete-change', schema: schemaWithGates() });
    // The fixture's own gate JSON legitimately contains a timestamp string
    // (artifact content, reproduced verbatim); what must NOT appear is a
    // *freshly generated* one, which we can't directly assert against, but
    // we can assert the two fixed known timestamps from the fixtures are
    // the only ISO-8601 timestamps present (no additional ones were added).
    const isoTimestamps = html.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g) ?? [];
    expect(new Set(isoTimestamps)).toEqual(new Set(['2026-07-29T08:16:37.432Z', '2026-07-29T09:00:00.000Z']));
  });
});

describe('determineStation', () => {
  it('returns explore when there is no proposal at all', () => {
    expect(
      determineStation({ changeDir: '/x/openspec/changes/foo', hasProposal: false, tasksMd: null, gatesFilenames: [] })
    ).toBe('explore');
  });

  it('returns propose when only a proposal exists and tasks are unchecked or absent', () => {
    expect(
      determineStation({ changeDir: '/x/openspec/changes/foo', hasProposal: true, tasksMd: null, gatesFilenames: [] })
    ).toBe('propose');
    expect(
      determineStation({
        changeDir: '/x/openspec/changes/foo',
        hasProposal: true,
        tasksMd: '- [ ] 1.1 todo',
        gatesFilenames: [],
      })
    ).toBe('propose');
  });

  it('returns apply once at least one task is checked, without post-apply evidence', () => {
    expect(
      determineStation({
        changeDir: '/x/openspec/changes/foo',
        hasProposal: true,
        tasksMd: '- [x] 1.1 done\n- [ ] 1.2 todo',
        gatesFilenames: ['synthesis-propose.json'],
      })
    ).toBe('apply');
  });

  it('returns verify when post-apply evidence exists, even if all tasks are checked', () => {
    expect(
      determineStation({
        changeDir: '/x/openspec/changes/foo',
        hasProposal: true,
        tasksMd: '- [x] 1.1 done',
        gatesFilenames: ['synthesis-verify.json'],
      })
    ).toBe('verify');
  });

  it('returns archive when the change directory is under changes/archive', () => {
    expect(
      determineStation({
        changeDir: '/x/openspec/changes/archive/2026-01-01-foo',
        hasProposal: true,
        tasksMd: '- [x] 1.1 done',
        gatesFilenames: [],
      })
    ).toBe('archive');
  });
});

describe('collectGateIdsForStation', () => {
  it('reads propose.gates for explore/propose/apply stations', () => {
    const schema = schemaWithGates();
    expect(collectGateIdsForStation(schema, 'propose')).toEqual([
      'structural-alignment',
      'traceability',
      'grill-me-quick',
      'spec-lint',
      'precommit',
    ]);
    expect(collectGateIdsForStation(schema, 'apply')).toEqual(collectGateIdsForStation(schema, 'propose'));
  });

  it('reads verify.gates for verify/archive stations, not propose.gates', () => {
    const schema: SchemaYaml = {
      name: 'test',
      version: 1,
      artifacts: [],
      verify: { requires: ['tasks'], gates: { pre: [{ id: 'coverage-ok', check: 'x', severity: 'blocking' }] } },
    } as unknown as SchemaYaml;
    expect(collectGateIdsForStation(schema, 'verify')).toEqual(['coverage-ok']);
    expect(collectGateIdsForStation(schema, 'archive')).toEqual(['coverage-ok']);
  });

  it('never renders verify-only gates (e.g. e2e-passed) while still in propose/apply', () => {
    const schema: SchemaYaml = {
      name: 'test',
      version: 1,
      artifacts: [],
      propose: { gates: { pre: [{ id: 'structural-alignment', check: 'x', severity: 'blocking' }] } },
      verify: { requires: ['tasks'], gates: { pre: [{ id: 'e2e-passed', check: 'x', severity: 'blocking' }] } },
    } as unknown as SchemaYaml;
    expect(collectGateIdsForStation(schema, 'apply')).not.toContain('e2e-passed');
  });

  it('returns an empty list when schema is null', () => {
    expect(collectGateIdsForStation(null, 'propose')).toEqual([]);
  });
});

describe('computeGateStatuses', () => {
  it('marks a declared gate missing when no evidence file mentions it', () => {
    const { statuses } = computeGateStatuses(['never-run'], []);
    expect(statuses).toEqual([{ id: 'never-run', state: 'missing' }]);
  });

  it('marks all gates missing (not green) and flags the file when total is 0', () => {
    const gatesFiles: GatesFileEntry[] = [
      {
        filename: 'synthesis.json',
        raw: '{}',
        data: { total: 0, passed: 0, failed: 0, results: [] },
      },
    ];
    const { statuses, emptySynthesisFiles } = computeGateStatuses(['gate-a', 'gate-b'], gatesFiles);
    expect(statuses).toEqual([
      { id: 'gate-a', state: 'missing' },
      { id: 'gate-b', state: 'missing' },
    ]);
    expect(emptySynthesisFiles).toEqual(['synthesis.json']);
  });

  it('falls back to evidence-derived ids when the schema declares no gates', () => {
    const gatesFiles: GatesFileEntry[] = [
      { filename: 'x.json', raw: '{}', data: { total: 1, results: [{ id: 'from-evidence', passed: true }] } },
    ];
    const { statuses } = computeGateStatuses([], gatesFiles);
    expect(statuses).toEqual([{ id: 'from-evidence', state: 'pass' }]);
  });

  // P1b: a forged/inconsistent synthesis file (total:0 but results
  // non-empty, or any total/results.length mismatch) MUST NOT be able to
  // source a green gate — the whole file is untrustworthy, not just its
  // "total: 0" claim.
  it('treats total:0-with-non-empty-results as untrustworthy and never sources a green gate from it', () => {
    const gatesFiles: GatesFileEntry[] = [
      {
        filename: 'forged.json',
        raw: '{}',
        data: { total: 0, results: [{ id: 'gate-a', passed: true }] },
      },
    ];
    const { statuses, emptySynthesisFiles, inconsistentSynthesisFiles } = computeGateStatuses(
      ['gate-a'],
      gatesFiles
    );
    expect(statuses).toEqual([{ id: 'gate-a', state: 'missing' }]);
    expect(statuses).not.toContainEqual({ id: 'gate-a', state: 'pass' });
    expect(inconsistentSynthesisFiles).toEqual(['forged.json']);
    expect(emptySynthesisFiles).toEqual([]);
  });

  it('treats a total/results.length mismatch (total > 0, non-matching results length) as inconsistent', () => {
    const gatesFiles: GatesFileEntry[] = [
      {
        filename: 'mismatched.json',
        raw: '{}',
        data: { total: 3, results: [{ id: 'gate-a', passed: true }] },
      },
    ];
    const { inconsistentSynthesisFiles } = computeGateStatuses(['gate-a'], gatesFiles);
    expect(inconsistentSynthesisFiles).toEqual(['mismatched.json']);
  });

  // P2e: a null (or otherwise non-object) entry inside `results` must not
  // throw — the whole file degrades to "unrecognized shape" (raw evidence
  // only), consistent with the P1a isSynthesisShape hardening.
  it('does not throw when a results entry is null, and does not derive any status from that file', () => {
    const gatesFiles: GatesFileEntry[] = [
      { filename: 'malformed.json', raw: '{"total":1,"results":[null]}', data: { total: 1, results: [null] } },
    ];
    expect(() => computeGateStatuses(['some-gate'], gatesFiles)).not.toThrow();
    const { statuses, emptySynthesisFiles, inconsistentSynthesisFiles } = computeGateStatuses(
      ['some-gate'],
      gatesFiles
    );
    expect(statuses).toEqual([{ id: 'some-gate', state: 'missing' }]);
    expect(emptySynthesisFiles).toEqual([]);
    expect(inconsistentSynthesisFiles).toEqual([]);
  });

  it('does not throw and does not derive a status when a results entry is a non-object (string)', () => {
    const gatesFiles: GatesFileEntry[] = [
      { filename: 'malformed2.json', raw: '{}', data: { total: 1, results: ['not-an-object'] } },
    ];
    expect(() => computeGateStatuses(['some-gate'], gatesFiles)).not.toThrow();
    const { statuses } = computeGateStatuses(['some-gate'], gatesFiles);
    expect(statuses).toEqual([{ id: 'some-gate', state: 'missing' }]);
  });
});

describe('renderChangeHtml — gate JSON derived values are escaped (P1a)', () => {
  it('escapes the passed/total counts in the gate evidence badge even though they are validated numbers', () => {
    withTempChangeDir(
      {
        '.gates/synthesis-propose.json': JSON.stringify({
          total: 2,
          passed: 1,
          results: [
            { id: 'a', passed: true },
            { id: 'b', passed: false },
          ],
        }),
      },
      (changeDir) => {
        const html = renderChangeHtml({ changeDir, changeName: 'temp-change', schema: null });
        expect(html).toContain('1 / 2 passed');
        expect(html).toContain('<span class="spec-gate fail">');
      }
    );
  });
});

describe('renderChangeHtml — inconsistent synthesis evidence is never green (P1b)', () => {
  it('marks a total:0-with-non-empty-results gates file as 證據不一致, not a pass', () => {
    withTempChangeDir(
      {
        '.gates/synthesis-propose.json': JSON.stringify({
          total: 0,
          results: [{ id: 'structural-alignment', passed: true }],
        }),
      },
      (changeDir) => {
        const schema: SchemaYaml = {
          name: 'test',
          version: 1,
          artifacts: [],
          propose: { gates: { pre: [{ id: 'structural-alignment', check: 'x', severity: 'blocking' }] } },
        } as unknown as SchemaYaml;
        const html = renderChangeHtml({ changeDir, changeName: 'temp-change', schema });
        expect(html).not.toMatch(/spec-gate pass/);
        expect(html).toContain('證據不一致');
        expect(html).toContain(
          '<span class="spec-gate missing"><span class="dot"></span> structural-alignment（未產出）</span>'
        );
      }
    );
  });
});

describe('renderChangeHtml — non-delta spec.md falls back to raw content (P2c)', () => {
  it('renders the escaped raw content of a spec.md with no parseable Requirement blocks instead of dropping it', () => {
    withTempChangeDir(
      {
        'specs/freeform-cap/spec.md':
          '# Freeform notes\n\nThis spec.md is plain prose, not delta-format Requirement blocks.\n',
      },
      (changeDir) => {
        const html = renderChangeHtml({ changeDir, changeName: 'temp-change', schema: null });
        expect(html).toContain('This spec.md is plain prose, not delta-format Requirement blocks.');
        expect(html).toContain('未解析出標準 Requirement 區塊');
        expect(html).toContain('Specs · freeform-cap');
      }
    );
  });
});

describe('renderChangeHtml — capability directory missing spec.md (P2d)', () => {
  it('marks a specs/<cap>/ directory with no spec.md as 未產出 rather than silently omitting it', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-html-nospec-'));
    try {
      const changeDir = path.join(tempDir, 'temp-change');
      fs.mkdirSync(path.join(changeDir, 'specs', 'ghost-cap'), { recursive: true });
      // Deliberately no spec.md written inside ghost-cap/.

      const html = renderChangeHtml({ changeDir, changeName: 'temp-change', schema: null });

      expect(html).toContain('Specs · ghost-cap');
      expect(html).toContain('spec.md 未產出');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('renderChangeHtml — malformed gate results entry does not crash the whole render (P2e)', () => {
  it('degrades a single malformed .gates/*.json (results: [null]) to raw presentation without interrupting the render', () => {
    withTempChangeDir(
      {
        '.gates/synthesis-propose.json': JSON.stringify({ total: 1, results: [null] }),
      },
      (changeDir) => {
        expect(() => renderChangeHtml({ changeDir, changeName: 'temp-change', schema: null })).not.toThrow();
        const html = renderChangeHtml({ changeDir, changeName: 'temp-change', schema: null });
        expect(html).toContain('synthesis-propose.json');
        // Raw JSON is shown escaped rather than the render crashing.
        expect(html).toContain('&quot;results&quot;');
        expect(html).not.toMatch(/spec-gate pass/);
      }
    );
  });
});

// (3) Symlink-escape read protection: an artifact path (or a directory
// entry inside specs/ or .gates/) whose fully-resolved target sits outside
// the change directory MUST be treated as if it does not exist at all —
// never followed, never read, never leaked into the rendered output.
describe('renderChangeHtml — symlink escape read protection (item 3)', () => {
  function withOutsideSecret(run: (changeDir: string, outsideDir: string) => void): void {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-html-symlink-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-html-symlink-outside-'));
    try {
      const changeDir = path.join(tempDir, 'temp-change');
      fs.mkdirSync(changeDir, { recursive: true });
      run(changeDir, outsideDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  }

  it('treats a proposal.md symlinked outside the change directory as absent, never leaking its content', () => {
    withOutsideSecret((changeDir, outsideDir) => {
      const secretPath = path.join(outsideDir, 'secret.md');
      fs.writeFileSync(secretPath, '# Top Secret\n\nleaked-content-marker\n', 'utf-8');
      fs.symlinkSync(secretPath, path.join(changeDir, 'proposal.md'), 'file');

      const html = renderChangeHtml({ changeDir, changeName: 'temp-change', schema: null });

      expect(html).not.toContain('leaked-content-marker');
      expect(html).toContain('proposal.md 未產出');
    });
  });

  it('excludes a specs/<cap> directory that is itself a symlink escaping the change directory, from the capability listing entirely', () => {
    withOutsideSecret((changeDir, outsideDir) => {
      fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true });
      const outsideCapDir = path.join(outsideDir, 'leaked-cap');
      fs.mkdirSync(outsideCapDir, { recursive: true });
      fs.writeFileSync(path.join(outsideCapDir, 'spec.md'), '# leaked-content-marker\n', 'utf-8');
      fs.symlinkSync(outsideCapDir, path.join(changeDir, 'specs', 'evil-cap'), 'dir');

      const html = renderChangeHtml({ changeDir, changeName: 'temp-change', schema: null });

      expect(html).not.toContain('leaked-content-marker');
      expect(html).not.toContain('evil-cap');
    });
  });

  it('treats a specs/<cap>/spec.md symlinked outside the change directory as absent, while the (real) capability directory itself is still listed as 未產出', () => {
    withOutsideSecret((changeDir, outsideDir) => {
      fs.mkdirSync(path.join(changeDir, 'specs', 'real-cap'), { recursive: true });
      const secretSpecPath = path.join(outsideDir, 'secret-spec.md');
      fs.writeFileSync(secretSpecPath, '# leaked-content-marker\n', 'utf-8');
      fs.symlinkSync(secretSpecPath, path.join(changeDir, 'specs', 'real-cap', 'spec.md'), 'file');

      const html = renderChangeHtml({ changeDir, changeName: 'temp-change', schema: null });

      expect(html).not.toContain('leaked-content-marker');
      expect(html).toContain('Specs · real-cap');
      expect(html).toContain('spec.md 未產出');
    });
  });

  it('excludes a .gates/*.json file symlinked outside the change directory, never reading or leaking its content', () => {
    withOutsideSecret((changeDir, outsideDir) => {
      fs.mkdirSync(path.join(changeDir, '.gates'), { recursive: true });
      const secretGatePath = path.join(outsideDir, 'secret-gate.json');
      fs.writeFileSync(secretGatePath, JSON.stringify({ leaked: 'leaked-content-marker' }), 'utf-8');
      fs.symlinkSync(secretGatePath, path.join(changeDir, '.gates', 'evil.json'), 'file');

      const html = renderChangeHtml({ changeDir, changeName: 'temp-change', schema: null });

      expect(html).not.toContain('leaked-content-marker');
      expect(html).toContain('.gates/ 未產出');
    });
  });

  it('still renders a legitimate in-bounds gates file normally alongside an excluded out-of-bounds one', () => {
    withOutsideSecret((changeDir, outsideDir) => {
      fs.mkdirSync(path.join(changeDir, '.gates'), { recursive: true });
      fs.writeFileSync(
        path.join(changeDir, '.gates', 'synthesis-propose.json'),
        JSON.stringify({ total: 1, results: [{ id: 'legit-gate', passed: true }] }),
        'utf-8'
      );
      const secretGatePath = path.join(outsideDir, 'secret-gate.json');
      fs.writeFileSync(secretGatePath, JSON.stringify({ leaked: 'leaked-content-marker' }), 'utf-8');
      fs.symlinkSync(secretGatePath, path.join(changeDir, '.gates', 'evil.json'), 'file');

      const html = renderChangeHtml({ changeDir, changeName: 'temp-change', schema: null });

      expect(html).not.toContain('leaked-content-marker');
      expect(html).toContain('synthesis-propose.json');
      expect(html).toContain('1 / 1 passed');
    });
  });
});

// (4) .gates race: the directory listing (readdirSync) and the individual
// file read (readFileSync) are not atomic — a file can vanish (or be
// replaced) in the gap between them. That MUST degrade just the one
// affected file to an explicit "無法讀取" marker, never crash the whole
// render.
describe('renderChangeHtml — .gates file vanishing between readdir and read does not crash (item 4)', () => {
  it('marks a gates file unreadable rather than throwing when readFileSync fails after readdirSync already listed it', () => {
    withTempChangeDir(
      {
        '.gates/synthesis-propose.json': JSON.stringify({
          total: 1,
          results: [{ id: 'legit-gate', passed: true }],
        }),
      },
      (changeDir) => {
        const gatesFile = fs.realpathSync(path.join(changeDir, '.gates', 'synthesis-propose.json'));
        armReadFileFailure(gatesFile);

        try {
          expect(() => renderChangeHtml({ changeDir, changeName: 'temp-change', schema: null })).not.toThrow();
          const html = renderChangeHtml({ changeDir, changeName: 'temp-change', schema: null });
          expect(html).toContain('synthesis-propose.json');
          expect(html).toContain('無法讀取');
          expect(html).not.toMatch(/spec-gate pass/);
        } finally {
          disarmReadFileFailure();
        }
      }
    );
  });
});
