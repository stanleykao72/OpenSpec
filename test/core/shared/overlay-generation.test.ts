import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';

import { parsePluginManifest } from '../../../src/core/plugin/loader.js';
import type { LoadedPlugin } from '../../../src/core/plugin/types.js';
import {
  NO_OVERLAYS,
  resolveWorkflowOverlays,
} from '../../../src/core/shared/overlay-generation.js';

describe('resolveWorkflowOverlays', () => {
  let tempDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-overlay-gen-'));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function plugin(
    name: string,
    overlays: Record<string, { append: string; supersedes?: string[] }>,
    files: Record<string, string> = {}
  ): LoadedPlugin {
    const dir = path.join(tempDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'plugin.yaml'),
      stringifyYaml({ name, version: '1.0.0', skill_overlays: overlays })
    );
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return { manifest: parsePluginManifest(dir), dir, source: 'project', config: {} };
  }

  const warnings = () => warnSpy.mock.calls.map((call) => String(call[0])).join('\n');

  it('returns NO_OVERLAYS-equivalent results when no plugin declares overlays', () => {
    const overlays = resolveWorkflowOverlays([]);
    expect(overlays.contentsFor('apply')).toEqual([]);
    expect(overlays.supersedesFor('apply')).toEqual([]);
    expect(overlays.fingerprint).toBe(NO_OVERLAYS.fingerprint);
  });

  it('rejects supersedes whose append file is empty or whitespace-only', () => {
    const p = plugin(
      'empty-sup',
      { apply: { append: 'o.md', supersedes: ['apply-inline-loop'] } },
      { 'o.md': '  \n\t\n' }
    );

    expect(() => resolveWorkflowOverlays([p])).toThrow(/empty-sup.*apply.*missing or empty/s);
  });

  it('rejects supersedes whose append file is missing', () => {
    const p = plugin('missing-sup', { apply: { append: 'gone.md', supersedes: ['apply-inline-loop'] } });

    expect(() => resolveWorkflowOverlays([p])).toThrow(/missing-sup.*missing or empty/s);
  });

  it('validates supersedes names even when the append file is missing', () => {
    const p = plugin('missing-unknown', { apply: { append: 'gone.md', supersedes: ['no-such-section'] } });

    expect(() => resolveWorkflowOverlays([p])).toThrow(/no-such-section/);
  });

  it('skips an empty overlay that supersedes nothing, with a warning', () => {
    const p = plugin('empty-plain', { apply: { append: 'o.md' } }, { 'o.md': '\n' });

    const overlays = resolveWorkflowOverlays([p]);

    expect(overlays.contentsFor('apply')).toEqual([]);
    expect(warnings()).toMatch(/empty-plain.*empty/s);
  });

  it('rejects overlay content that carries section markers', () => {
    const p = plugin(
      'marker-overlay',
      { apply: { append: 'o.md' } },
      { 'o.md': '## Mine\n<!-- opsx:section mine -->\nx\n<!-- /opsx:section mine -->\n' }
    );

    expect(() => resolveWorkflowOverlays([p])).toThrow(/marker-overlay.*opsx:section/s);
  });

  it('allows overlay text that only mentions the marker syntax in code', () => {
    const p = plugin(
      'doc-overlay',
      { apply: { append: 'o.md' } },
      { 'o.md': 'Use `<!-- opsx:section NAME -->`.\n\n```\n<!-- opsx:section example -->\n```\n' }
    );

    expect(resolveWorkflowOverlays([p]).contentsFor('apply')).toHaveLength(1);
  });

  it('warns, naming both plugins, when two plugins supersede the same section', () => {
    const a = plugin('sup-a', { apply: { append: 'o.md', supersedes: ['apply-inline-loop'] } }, { 'o.md': 'A' });
    const b = plugin(
      'sup-b',
      { apply: { append: 'o.md', supersedes: ['apply-inline-loop', 'apply-output-templates'] } },
      { 'o.md': 'B' }
    );

    const overlays = resolveWorkflowOverlays([a, b]);

    expect(overlays.supersedesFor('apply')).toEqual(['apply-inline-loop', 'apply-output-templates']);
    expect(warnings()).toMatch(/apply-inline-loop.*sup-a.*sup-b/s);
  });

  it('warns, naming both plugins, when a plugin appends to a workflow another plugin superseded', () => {
    const a = plugin('remover', { apply: { append: 'o.md', supersedes: ['apply-inline-loop'] } }, { 'o.md': 'A' });
    const b = plugin('appender', { apply: { append: 'o.md' } }, { 'o.md': 'B' });

    resolveWorkflowOverlays([a, b]);

    expect(warnings()).toMatch(/appender.*apply.*apply-inline-loop.*remover/s);
  });

  it('does not warn for a single superseding plugin', () => {
    const a = plugin('solo', { apply: { append: 'o.md', supersedes: ['apply-inline-loop'] } }, { 'o.md': 'A' });

    resolveWorkflowOverlays([a]);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('fingerprints overlay content and supersedes', () => {
    const one = resolveWorkflowOverlays([
      plugin('fp1', { apply: { append: 'o.md', supersedes: ['apply-inline-loop'] } }, { 'o.md': 'A' }),
    ]);
    const sameAgain = resolveWorkflowOverlays([
      plugin('fp2', { apply: { append: 'o.md', supersedes: ['apply-inline-loop'] } }, { 'o.md': 'A' }),
    ]);
    const otherContent = resolveWorkflowOverlays([
      plugin('fp3', { apply: { append: 'o.md', supersedes: ['apply-inline-loop'] } }, { 'o.md': 'B' }),
    ]);
    const otherSupersedes = resolveWorkflowOverlays([
      plugin('fp4', { apply: { append: 'o.md' } }, { 'o.md': 'A' }),
    ]);

    expect(one.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(sameAgain.fingerprint).toBe(one.fingerprint);
    expect(otherContent.fingerprint).not.toBe(one.fingerprint);
    expect(otherSupersedes.fingerprint).not.toBe(one.fingerprint);
  });
});
