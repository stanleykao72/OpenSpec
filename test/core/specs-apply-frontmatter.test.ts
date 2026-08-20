import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  archiveDateStamp,
  archiveSourceEntry,
  appendArchiveSource,
  buildSpecSkeleton,
  buildUpdatedSpec,
  parseLeadingFrontmatter,
} from '../../src/core/specs-apply.js';

const DATE = '2026-08-19';
const CHANGE = 'add-widget-export';

describe('archiveDateStamp', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(archiveDateStamp(new Date('2026-08-19T13:45:00Z'))).toBe('2026-08-19');
  });
});

describe('parseLeadingFrontmatter', () => {
  it('splits a leading block from the body', () => {
    const fm = parseLeadingFrontmatter('---\ntype: capability\n---\n# Title\n');
    expect(fm.present).toBe(true);
    expect(fm.lines).toEqual(['type: capability']);
    expect(fm.body).toBe('# Title\n');
  });

  it('reports absent when the document does not start with a block', () => {
    const doc = '# Title\n\n## Purpose\n';
    const fm = parseLeadingFrontmatter(doc);
    expect(fm.present).toBe(false);
    expect(fm.body).toBe(doc);
  });

  it('treats an unterminated block as ordinary content rather than guessing', () => {
    const doc = '---\ntype: capability\n# Title\n';
    const fm = parseLeadingFrontmatter(doc);
    expect(fm.present).toBe(false);
    expect(fm.body).toBe(doc);
  });
});

describe('buildSpecSkeleton', () => {
  it('emits the frontmatter the archive workflow documents', () => {
    const out = buildSpecSkeleton('widget-export', CHANGE, undefined, { archivedOn: DATE });
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('type: capability');
    expect(out).toContain('id: widget-export');
    expect(out).toContain('sources:');
    expect(out).toContain(`  - ${archiveSourceEntry(CHANGE, DATE)}`);
  });

  it('keeps the Purpose visibly unfinished', () => {
    const out = buildSpecSkeleton('widget-export', CHANGE, undefined, { archivedOn: DATE });
    // The old placeholder read like a filled-in field and survived into merged
    // specs. It must stay obviously a to-do.
    expect(out).toContain('TBD(archive):');
  });

  it('still produces a parseable main spec shape', () => {
    const out = buildSpecSkeleton('widget-export', CHANGE, undefined, { archivedOn: DATE });
    expect(out).toContain('# widget-export Specification');
    expect(out).toContain('## Purpose');
    expect(out).toContain('## Requirements');
  });

  it('carries module and scope over from the delta spec when it declares them', () => {
    const delta = '---\ntype: capability\nmodule: billing\nscope: module\n---\n## ADDED Requirements\n';
    const out = buildSpecSkeleton('widget-export', CHANGE, undefined, { archivedOn: DATE, deltaContent: delta });
    expect(out).toContain('module: billing');
    expect(out).toContain('scope: module');
  });

  it('omits module and scope rather than inventing them', () => {
    const out = buildSpecSkeleton('widget-export', CHANGE, undefined, {
      archivedOn: DATE,
      deltaContent: '## ADDED Requirements\n',
    });
    expect(out).not.toContain('module:');
    expect(out).not.toContain('scope:');
  });
});

describe('appendArchiveSource', () => {
  const withSources = [
    '---',
    'type: capability',
    'id: widget-export',
    'sources:',
    '  - initial-widget-export (archived 2026-01-02)',
    '---',
    '# widget-export Specification',
    '',
  ].join('\n');

  it('appends the change to an existing sources list', () => {
    const out = appendArchiveSource(withSources, CHANGE, DATE);
    expect(out).toContain('  - initial-widget-export (archived 2026-01-02)');
    expect(out).toContain(`  - ${archiveSourceEntry(CHANGE, DATE)}`);
  });

  it('appends exactly one entry', () => {
    const out = appendArchiveSource(withSources, CHANGE, DATE);
    const occurrences = out.split(archiveSourceEntry(CHANGE, DATE)).length - 1;
    expect(occurrences).toBe(1);
  });

  it('is idempotent so re-archiving cannot duplicate the entry', () => {
    const once = appendArchiveSource(withSources, CHANGE, DATE);
    const twice = appendArchiveSource(once, CHANGE, DATE);
    expect(twice).toBe(once);
  });

  it('leaves a spec without frontmatter byte-identical', () => {
    const plain = '# widget-export Specification\n\n## Requirements\n';
    expect(appendArchiveSource(plain, CHANGE, DATE)).toBe(plain);
  });

  it('leaves frontmatter without a sources key byte-identical', () => {
    const noSources = '---\ntype: capability\nid: widget-export\n---\n# widget-export Specification\n';
    expect(appendArchiveSource(noSources, CHANGE, DATE)).toBe(noSources);
  });

  it('preserves the existing list indentation', () => {
    const fourSpace = withSources.replace('  - initial-widget-export', '    - initial-widget-export');
    const out = appendArchiveSource(fourSpace, CHANGE, DATE);
    expect(out).toContain(`    - ${archiveSourceEntry(CHANGE, DATE)}`);
  });

  it('does not disturb keys that follow the sources list', () => {
    const trailing = withSources.replace('---\n# widget-export', 'status: active\n---\n# widget-export');
    const out = appendArchiveSource(trailing, CHANGE, DATE);
    expect(out).toContain('status: active');
    expect(out.indexOf('status: active')).toBeGreaterThan(out.indexOf(archiveSourceEntry(CHANGE, DATE)));
  });
});

describe('buildUpdatedSpec (existing capability)', () => {
  let tempDir: string;

  beforeEach(async () => {
    // realpath: on macOS os.tmpdir() returns /var/... while the upstream path
    // guard canonicalizes to /private/var/..., so an un-resolved root is
    // rejected as "outside the allowed directory".
    tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-sources-')));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function run(targetContent: string) {
    const source = path.join(tempDir, 'delta.md');
    const target = path.join(tempDir, 'spec.md');
    await fs.writeFile(
      source,
      '## ADDED Requirements\n\n### Requirement: Export runs on demand\nThe system SHALL export on request.\n\n#### Scenario: User exports\n- **WHEN** the user clicks export\n- **THEN** a file is produced\n'
    );
    await fs.writeFile(target, targetContent);
    return buildUpdatedSpec(
      { id: 'widget-export', source, sourceRoot: tempDir, target, targetRoot: tempDir, exists: true },
      CHANGE,
      {
        silent: true,
        archivedOn: DATE,
      }
    );
  }

  it('records the change in the spec frontmatter sources list', async () => {
    const { rebuilt } = await run(
      '---\ntype: capability\nid: widget-export\nsources:\n  - initial (archived 2026-01-02)\n---\n# widget-export Specification\n\n## Purpose\nExports widgets.\n\n## Requirements\n'
    );
    expect(rebuilt).toContain(`  - ${archiveSourceEntry(CHANGE, DATE)}`);
    expect(rebuilt).toContain('  - initial (archived 2026-01-02)');
  });

  it('leaves a frontmatter-less spec without a sources block', async () => {
    const { rebuilt } = await run('# widget-export Specification\n\n## Purpose\nExports widgets.\n\n## Requirements\n');
    expect(rebuilt).not.toContain('sources:');
    expect(rebuilt.startsWith('# widget-export Specification')).toBe(true);
  });

  it('still merges the requirement itself', async () => {
    const { rebuilt, counts } = await run(
      '---\ntype: capability\nid: widget-export\nsources:\n  - initial (archived 2026-01-02)\n---\n# widget-export Specification\n\n## Purpose\nExports widgets.\n\n## Requirements\n'
    );
    expect(counts.added).toBe(1);
    expect(rebuilt).toContain('### Requirement: Export runs on demand');
  });
});
