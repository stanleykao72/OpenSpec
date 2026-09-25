import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

import { UpdateCommand } from '../../src/core/update.js';
import { clearPluginCache } from '../../src/core/plugin/context.js';
import type { GlobalConfig } from '../../src/core/global-config.js';

// Isolate from the machine's real global config (same pattern as update.test.ts).
vi.mock('../../src/core/global-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/global-config.js')>();
  return {
    ...actual,
    getGlobalConfig: (): GlobalConfig => ({ featureFlags: {}, profile: 'core', delivery: 'both' }),
    saveGlobalConfig: vi.fn(),
  };
});

const APPLY_OVERLAY = `## Apply Via Fixture Fan-out

Run the fixture orchestration instead of any inline loop.`;

const VERIFY_OVERLAY = `## Verify Via Fixture Fan-out

Dispatch the fixture verifiers.

**Output Format**

Emit the fixture scorecard.`;

interface OverlayDecl {
  append: string;
  supersedes?: string[];
}

describe('update with overlay supersedes', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  async function writeFixturePlugin(overlays: Record<string, OverlayDecl>): Promise<void> {
    const pluginDir = path.join(testDir, 'openspec', 'plugins', 'fixture-lifecycle');
    await fs.mkdir(path.join(pluginDir, 'overlays'), { recursive: true });
    const overlayYaml = Object.entries(overlays)
      .map(([workflow, decl]) => {
        const lines = [`  ${workflow}:`, `    append: ${decl.append}`];
        if (decl.supersedes) {
          lines.push('    supersedes:', ...decl.supersedes.map((name) => `      - ${name}`));
        }
        return lines.join('\n');
      })
      .join('\n');
    await fs.writeFile(
      path.join(pluginDir, 'plugin.yaml'),
      `name: fixture-lifecycle\nversion: 1.0.0\nskill_overlays:\n${overlayYaml}\n`
    );
    await fs.writeFile(path.join(pluginDir, 'overlays', 'apply.md'), APPLY_OVERLAY);
    await fs.writeFile(path.join(pluginDir, 'overlays', 'verify.md'), VERIFY_OVERLAY);
    await fs.writeFile(
      path.join(testDir, 'openspec', 'config.yaml'),
      'schema: spec-driven\nplugins:\n  - fixture-lifecycle\n'
    );
  }

  const read = (...segments: string[]) => fs.readFile(path.join(testDir, ...segments), 'utf-8');
  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-supersedes-'));
    process.env.HOME = path.join(testDir, 'home');
    process.env.USERPROFILE = path.join(testDir, 'home');
    process.env.CODEX_HOME = path.join(testDir, 'codex-home');
    await fs.mkdir(path.join(testDir, 'openspec'), { recursive: true });
    // Mark Claude Code as a configured tool.
    const exploreDir = path.join(testDir, '.claude', 'skills', 'openspec-explore');
    await fs.mkdir(exploreDir, { recursive: true });
    await fs.writeFile(path.join(exploreDir, 'SKILL.md'), '---\nname: openspec-explore\n---\nold\n');
    clearPluginCache();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    clearPluginCache();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('drops the superseded apply loop and output templates from skill and command', async () => {
    await writeFixturePlugin({
      apply: { append: 'overlays/apply.md', supersedes: ['apply-inline-loop', 'apply-output-templates'] },
    });

    await new UpdateCommand().execute(testDir);

    const skill = await read('.claude', 'skills', 'openspec-apply-change', 'SKILL.md');
    const command = await read('.claude', 'commands', 'opsx', 'apply.md');

    for (const [label, out] of [['skill', skill], ['command', command]] as const) {
      // Superseded: the inline loop, its pause list, step 7, and the output blocks.
      expect(out, label).not.toContain('Output During Implementation');
      expect(out, label).not.toContain('Output On Completion');
      expect(out, label).not.toContain('If no such overlay is present, loop until done or blocked');
      expect(out, label).not.toContain('**Pause if:**');
      expect(out, label).not.toContain('7. **On completion or pause, show status**');
      // Kept: setup steps, the precedence pointer, guardrails, and the overlay itself.
      expect(out, label).toContain('5. **Show current progress**');
      expect(out, label).toContain('6. **Implement tasks** — plugin overlay takes precedence');
      expect(out, label).toContain('**Guardrails**');
      expect(out, label).toContain('## Apply Via Fixture Fan-out');
      expect(out.indexOf('**Guardrails**'), label).toBeLessThan(out.indexOf('## Apply Via Fixture Fan-out'));
      expect(out, label).not.toContain('opsx:section');
      expect(out, label).not.toMatch(/\n\n\n/);
    }
  });

  it('leaves verify with exactly one Output Format section, the overlay one', async () => {
    await writeFixturePlugin({
      verify: {
        append: 'overlays/verify.md',
        supersedes: ['verify-default-procedure', 'verify-output-format'],
      },
    });

    await new UpdateCommand().execute(testDir);

    const skill = await read('.claude', 'skills', 'openspec-verify-change', 'SKILL.md');
    const command = await read('.claude', 'commands', 'opsx', 'verify.md');

    for (const [label, out] of [['skill', skill], ['command', command]] as const) {
      expect(count(out, '**Output Format**'), label).toBe(1);
      expect(out.indexOf('**Output Format**'), label).toBeGreaterThan(
        out.indexOf('## Verify Via Fixture Fan-out')
      );
      expect(out, label).not.toContain('**Verification Heuristics**');
      expect(out, label).not.toContain('**Graceful Degradation**');
      expect(out, label).not.toContain('**Verify Completeness**');
      expect(out, label).not.toContain('**Generate Verification Report**');
      expect(out, label).toContain('4. **Verification execution — plugin overlay takes precedence**');
      expect(out, label).not.toContain('opsx:section');
      expect(out, label).not.toMatch(/\n\n\n/);
    }
  });

  it('keeps the whole base, markers removed, when an overlay declares no supersedes', async () => {
    await writeFixturePlugin({ apply: { append: 'overlays/apply.md' } });

    await new UpdateCommand().execute(testDir);

    const skill = await read('.claude', 'skills', 'openspec-apply-change', 'SKILL.md');
    expect(skill).toContain('Output During Implementation');
    expect(skill).toContain('**Pause if:**');
    expect(skill).toContain('## Apply Via Fixture Fan-out');
    expect(skill).not.toContain('opsx:section');
  });

  it('fails before writing anything when supersedes names an unknown section', async () => {
    await writeFixturePlugin({
      apply: { append: 'overlays/apply.md', supersedes: ['apply-inline-loop', 'no-such-section'] },
    });

    await expect(new UpdateCommand().execute(testDir)).rejects.toThrow(/no-such-section/);

    await expect(
      fs.stat(path.join(testDir, '.claude', 'skills', 'openspec-apply-change', 'SKILL.md'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
