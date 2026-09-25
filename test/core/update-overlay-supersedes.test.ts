import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

import { UpdateCommand } from '../../src/core/update.js';
import { InitCommand } from '../../src/core/init.js';
import { clearPluginCache, getLoadedPlugins } from '../../src/core/plugin/context.js';
import { FileSystemUtils } from '../../src/utils/file-system.js';
import { loadProjectOverlays } from '../../src/core/shared/overlay-generation.js';
import { areCommandFilesUpToDate, getToolVersionStatus } from '../../src/core/shared/tool-detection.js';
import type { GlobalConfig } from '../../src/core/global-config.js';
import { createRequire } from 'node:module';

const { version: OPENSPEC_VERSION } = createRequire(import.meta.url)('../../package.json') as { version: string };

const mockState: { config: GlobalConfig } = {
  config: { featureFlags: {}, profile: 'core', delivery: 'both' },
};

// Isolate from the machine's real global config (same pattern as update.test.ts).
vi.mock('../../src/core/global-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/global-config.js')>();
  return {
    ...actual,
    getGlobalConfig: (): GlobalConfig => ({ ...mockState.config }),
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

describe('overlay supersedes across generation entry points', () => {
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
    mockState.config = { featureFlags: {}, profile: 'core', delivery: 'both' };
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
      // The pointer at the superseded loop goes with it; nothing refers to it.
      expect(out, label).not.toContain('instead of this inline loop');
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
      // Sentences that point at the superseded default procedure go with it.
      expect(out, label).not.toContain('skip the default procedure in steps 5+');
      expect(out, label).not.toContain('continue with the default three-dimension verification');
      // The archive-readiness guardrails are not supersedable.
      expect(out, label).toContain('1. **CRITICAL** (Must fix before archive):');
      expect(out, label).toContain('"X critical issue(s) found. Fix before archiving."');
      expect(out.indexOf('Fix before archiving'), label).toBeLessThan(
        out.indexOf('## Verify Via Fixture Fan-out')
      );
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

  const SUPERSEDING_APPLY: Record<string, OverlayDecl> = {
    apply: { append: 'overlays/apply.md', supersedes: ['apply-inline-loop', 'apply-output-templates'] },
  };

  function expectSupersededApply(out: string, label: string): void {
    expect(out, label).not.toContain('Output During Implementation');
    expect(out, label).not.toContain('**Pause if:**');
    expect(out, label).toContain('## Apply Via Fixture Fan-out');
    expect(out, label).not.toContain('opsx:section');
  }

  it('init in a project whose config enables the plugin applies overlays and supersedes', async () => {
    await writeFixturePlugin(SUPERSEDING_APPLY);

    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    expectSupersededApply(await read('.claude', 'skills', 'openspec-apply-change', 'SKILL.md'), 'skill');
    expectSupersededApply(await read('.claude', 'commands', 'opsx', 'apply.md'), 'command');
  });

  it('init fails before writing skills when supersedes names an unknown section', async () => {
    await writeFixturePlugin({ apply: { append: 'overlays/apply.md', supersedes: ['no-such-section'] } });

    await expect(new InitCommand({ tools: 'claude', force: true }).execute(testDir)).rejects.toThrow(
      /no-such-section/
    );
    await expect(
      fs.stat(path.join(testDir, '.claude', 'skills', 'openspec-apply-change', 'SKILL.md'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('the legacy-upgrade path applies overlays and supersedes to the tools it sets up', async () => {
    await writeFixturePlugin(SUPERSEDING_APPLY);
    // A legacy slash-command install and no skills: update --force upgrades it.
    // The forced main loop then rewrites every configured tool, which would
    // hide a missing overlay pass in the upgrade path, so attribute writes to
    // the upgrade itself: record exactly the writes made while it runs.
    await fs.rm(path.join(testDir, '.claude', 'skills'), { recursive: true, force: true });
    const legacyDir = path.join(testDir, '.claude', 'commands', 'openspec');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'proposal.md'), 'old command content');
    const writeSpy = vi.spyOn(FileSystemUtils, 'writeFile');
    type Upgrade = (...args: unknown[]) => Promise<unknown>;
    const proto = UpdateCommand.prototype as unknown as { upgradeLegacyTools: Upgrade };
    const originalUpgrade = proto.upgradeLegacyTools;
    let upgradeWrites: unknown[][] | null = null;
    const upgradeSpy = vi.spyOn(proto, 'upgradeLegacyTools').mockImplementation(async function (
      this: unknown,
      ...args: unknown[]
    ) {
      const before = writeSpy.mock.calls.length;
      const result = await originalUpgrade.apply(this, args);
      upgradeWrites = writeSpy.mock.calls.slice(before);
      return result;
    });

    await new UpdateCommand({ force: true }).execute(testDir);

    expect(upgradeSpy).toHaveBeenCalledTimes(1);
    const isApply = (file: unknown) => /openspec-apply-change[\\/]SKILL\.md$|opsx[\\/]apply\.md$/.test(String(file));
    const byUpgrade = (upgradeWrites ?? []).filter(([file]) => isApply(file));
    // The upgrade itself wrote the apply skill and command...
    expect(byUpgrade.map(([file]) => path.basename(String(file))).sort()).toEqual(['SKILL.md', 'apply.md']);
    for (const [file, content] of byUpgrade) {
      expectSupersededApply(String(content), `upgrade ${String(file)}`);
    }
    // ...and so did the forced main loop afterwards.
    const all = writeSpy.mock.calls.filter(([file]) => isApply(file));
    expect(all.length).toBeGreaterThan(byUpgrade.length);
    for (const [file, content] of all) {
      expectSupersededApply(String(content), String(file));
    }
  });

  it('command files written by update count as up to date in a project with a supersedes overlay', async () => {
    await writeFixturePlugin(SUPERSEDING_APPLY);

    await new UpdateCommand().execute(testDir);

    expect(areCommandFilesUpToDate(testDir, 'claude')).toBe(true);
  });

  it('a commands-only install does not report needsUpdate right after update', async () => {
    mockState.config = { featureFlags: {}, profile: 'core', delivery: 'commands' };
    await writeFixturePlugin(SUPERSEDING_APPLY);
    // Commands-only: configure Claude through a command file instead of a skill.
    await fs.rm(path.join(testDir, '.claude', 'skills'), { recursive: true, force: true });
    const commandDir = path.join(testDir, '.claude', 'commands', 'opsx');
    await fs.mkdir(commandDir, { recursive: true });
    await fs.writeFile(path.join(commandDir, 'explore.md'), 'old');

    await new UpdateCommand().execute(testDir);

    expectSupersededApply(await read('.claude', 'commands', 'opsx', 'apply.md'), 'command');
    const status = getToolVersionStatus(testDir, 'claude', '9.9.9');
    expect(status.configured).toBe(true);
    expect(status.needsUpdate).toBe(false);
  });

  it('up-to-date detection reports stale (without throwing) when supersedes is invalid', async () => {
    await new UpdateCommand().execute(testDir);
    await writeFixturePlugin({ apply: { append: 'overlays/apply.md', supersedes: ['no-such-section'] } });
    clearPluginCache();

    expect(areCommandFilesUpToDate(testDir, 'claude')).toBe(false);
  });

  it('a fresh init (no openspec/config.yaml yet) resolves to no overlays and writes the full base', async () => {
    // No config means no plugin whitelist, so there is nothing to load; this is
    // the one entry point that legitimately runs without plugins.
    expect(loadProjectOverlays(testDir).supersedesFor('apply')).toEqual([]);
    expect(loadProjectOverlays(testDir).contentsFor('apply')).toEqual([]);

    await new InitCommand({ tools: 'claude', force: true }).execute(testDir);

    const skill = await read('.claude', 'skills', 'openspec-apply-change', 'SKILL.md');
    expect(skill).toContain('Output During Implementation');
    expect(skill).toContain('**Pause if:**');
    expect(skill).not.toContain('opsx:section');
  });

  // A whitelisted plugin that cannot be loaded must stop generation: before,
  // getLoadedPlugins warned and returned [] for the whole whitelist, so update
  // and init rewrote every overlaid skill as bare base text and exited 0.
  const SCHEMA_INVALID_MANIFESTS: Record<string, string> = {
    'scalar supersedes': 'supersedes: apply-inline-loop',
    'empty-string supersedes entry': 'supersedes:\n      - ""',
    'misspelled supersedes key': 'supersede:\n      - apply-inline-loop',
  };

  async function writeRawManifest(overlayExtra: string): Promise<void> {
    await writeFixturePlugin({ apply: { append: 'overlays/apply.md' } });
    await fs.writeFile(
      path.join(testDir, 'openspec', 'plugins', 'fixture-lifecycle', 'plugin.yaml'),
      `name: fixture-lifecycle\nversion: 1.0.0\nskill_overlays:\n  apply:\n    append: overlays/apply.md\n    ${overlayExtra}\n`
    );
  }

  for (const [label, extra] of Object.entries(SCHEMA_INVALID_MANIFESTS)) {
    it(`update fails and keeps the overlaid skill when the manifest has a ${label}`, async () => {
      await writeFixturePlugin(SUPERSEDING_APPLY);
      await new UpdateCommand().execute(testDir);
      const skillPath = path.join(testDir, '.claude', 'skills', 'openspec-apply-change', 'SKILL.md');
      const overlaid = await fs.readFile(skillPath, 'utf-8');
      expectSupersededApply(overlaid, 'before');

      await writeRawManifest(extra);
      clearPluginCache();

      await expect(new UpdateCommand({ force: true }).execute(testDir)).rejects.toThrow(/fixture-lifecycle/);
      expect(await fs.readFile(skillPath, 'utf-8')).toBe(overlaid);
    });

    it(`init fails before writing skills when the manifest has a ${label}`, async () => {
      await writeRawManifest(extra);

      await expect(new InitCommand({ tools: 'claude', force: true }).execute(testDir)).rejects.toThrow(
        /fixture-lifecycle/
      );
      await expect(
        fs.stat(path.join(testDir, '.claude', 'skills', 'openspec-apply-change', 'SKILL.md'))
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }

  it('update and init fail when a whitelisted plugin is not installed', async () => {
    await fs.writeFile(path.join(testDir, 'openspec', 'config.yaml'), 'schema: spec-driven\nplugins:\n  - missing-plugin\n');

    expect(() => loadProjectOverlays(testDir)).toThrow(/missing-plugin/);
    await expect(new UpdateCommand().execute(testDir)).rejects.toThrow(/missing-plugin/);
    await expect(new InitCommand({ tools: 'claude', force: true }).execute(testDir)).rejects.toThrow(/missing-plugin/);
  });

  it('update fails when plugin config validation would drop a whitelisted plugin', async () => {
    await writeFixturePlugin(SUPERSEDING_APPLY);
    const manifestPath = path.join(testDir, 'openspec', 'plugins', 'fixture-lifecycle', 'plugin.yaml');
    await fs.appendFile(manifestPath, 'config:\n  vault:\n    name:\n      type: string\n      required: true\n');

    await expect(new UpdateCommand().execute(testDir)).rejects.toThrow(/fixture-lifecycle/);
  });

  // config.yaml-level corruption must not empty the whitelist either: under the
  // lenient parser each case read as "no plugins", so update rewrote overlaid
  // skills back to base text (040ae1a even treats vanished overlays as stale).
  const CORRUPT_CONFIGS: Record<string, string> = {
    'unparseable YAML': 'schema: spec-driven\nplugins: [fixture-lifecycle\n',
    'plugins given as a scalar': 'schema: spec-driven\nplugins: fixture-lifecycle\n',
    'a non-string plugins entry': 'schema: spec-driven\nplugins:\n  - 123\n  - fixture-lifecycle\n',
    'an empty plugins entry': 'schema: spec-driven\nplugins:\n  - ""\n  - fixture-lifecycle\n',
    'a non-object document': '- just\n- a list\n',
  };

  for (const [label, config] of Object.entries(CORRUPT_CONFIGS)) {
    it(`update fails and keeps overlaid skills when config.yaml has ${label}`, async () => {
      await writeFixturePlugin(SUPERSEDING_APPLY);
      await new UpdateCommand().execute(testDir);
      const skillPath = path.join(testDir, '.claude', 'skills', 'openspec-apply-change', 'SKILL.md');
      const overlaid = await fs.readFile(skillPath, 'utf-8');

      await fs.writeFile(path.join(testDir, 'openspec', 'config.yaml'), config);
      clearPluginCache();

      await expect(new UpdateCommand().execute(testDir)).rejects.toThrow(/config/i);
      await expect(new UpdateCommand({ force: true }).execute(testDir)).rejects.toThrow(/config/i);
      expect(await fs.readFile(skillPath, 'utf-8')).toBe(overlaid);
    });

    it(`init fails before writing skills when config.yaml has ${label}`, async () => {
      await writeFixturePlugin(SUPERSEDING_APPLY);
      await fs.writeFile(path.join(testDir, 'openspec', 'config.yaml'), config);

      await expect(new InitCommand({ tools: 'claude', force: true }).execute(testDir)).rejects.toThrow(/config/i);
      await expect(
        fs.stat(path.join(testDir, '.claude', 'skills', 'openspec-apply-change', 'SKILL.md'))
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }

  it('update fails and keeps overlaid skills when config.yaml cannot be read', async () => {
    await writeFixturePlugin(SUPERSEDING_APPLY);
    await new UpdateCommand().execute(testDir);
    const skillPath = path.join(testDir, '.claude', 'skills', 'openspec-apply-change', 'SKILL.md');
    const overlaid = await fs.readFile(skillPath, 'utf-8');
    const configPath = path.join(testDir, 'openspec', 'config.yaml');
    await fs.chmod(configPath, 0o000);
    clearPluginCache();

    try {
      await expect(new UpdateCommand().execute(testDir)).rejects.toThrow(/config/i);
    } finally {
      await fs.chmod(configPath, 0o644);
    }
    expect(await fs.readFile(skillPath, 'utf-8')).toBe(overlaid);
  });

  it('read-only callers keep the lenient whitelist: valid entries load, bad ones are warned about', async () => {
    await writeFixturePlugin(SUPERSEDING_APPLY);
    await fs.writeFile(
      path.join(testDir, 'openspec', 'config.yaml'),
      'schema: spec-driven\nplugins:\n  - 123\n  - fixture-lifecycle\n'
    );

    expect(getLoadedPlugins(testDir).map((plugin) => plugin.manifest.name)).toEqual(['fixture-lifecycle']);
    expect(() => getLoadedPlugins(testDir, { strict: true })).toThrow(/plugins/);
  });

  it('a config without a plugins key is not an error', async () => {
    await fs.writeFile(path.join(testDir, 'openspec', 'config.yaml'), 'schema: spec-driven\n');

    expect(getLoadedPlugins(testDir, { strict: true })).toEqual([]);
  });

  it('other commands keep the lenient loader: a broken plugin is warned about and skipped', async () => {
    await fs.writeFile(path.join(testDir, 'openspec', 'config.yaml'), 'schema: spec-driven\nplugins:\n  - missing-plugin\n');

    expect(getLoadedPlugins(testDir)).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('missing-plugin'));
    // A lenient call that cached [] must not let a later strict call pass.
    expect(() => getLoadedPlugins(testDir, { strict: true })).toThrow(/missing-plugin/);
  });

  it('an invalid overlay fails update before any migration moves files', async () => {
    await writeFixturePlugin({ apply: { append: 'overlays/apply.md', supersedes: ['no-such-section'] } });
    const legacySkill = path.join(testDir, '.kimi', 'skills', 'openspec-explore', 'SKILL.md');
    await fs.mkdir(path.dirname(legacySkill), { recursive: true });
    await fs.writeFile(legacySkill, '---\nname: openspec-explore\nmetadata:\n  author: openspec\n---\n\nOld\n');

    await expect(new UpdateCommand().execute(testDir)).rejects.toThrow(/no-such-section/);

    expect(await fs.readFile(legacySkill, 'utf-8')).toContain('Old');
    await expect(fs.stat(path.join(testDir, '.kimi-code'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('update rejects overlay content carrying section markers, before writing', async () => {
    await writeFixturePlugin({ apply: { append: 'overlays/apply.md' } });
    await fs.writeFile(
      path.join(testDir, 'openspec', 'plugins', 'fixture-lifecycle', 'overlays', 'apply.md'),
      '## Mine\n<!-- opsx:section mine -->\nx\n<!-- /opsx:section mine -->\n'
    );

    await expect(new UpdateCommand().execute(testDir)).rejects.toThrow(/opsx:section/);
    await expect(
      fs.stat(path.join(testDir, '.claude', 'skills', 'openspec-apply-change', 'SKILL.md'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  // Skill-bearing tools were judged by generatedBy alone, so a changed overlay
  // (content or supersedes) left update without --force reporting "up to date".
  describe('skill-bearing up-to-date detection follows overlay changes', () => {
    const overlayFile = () => path.join(testDir, 'openspec', 'plugins', 'fixture-lifecycle', 'overlays', 'apply.md');
    const status = () => getToolVersionStatus(testDir, 'claude', OPENSPEC_VERSION);

    it('is current right after update', async () => {
      await writeFixturePlugin(SUPERSEDING_APPLY);
      await new UpdateCommand().execute(testDir);

      expect(status().needsUpdate).toBe(false);
    });

    it('goes stale when overlay content changes, and update without --force re-renders', async () => {
      await writeFixturePlugin(SUPERSEDING_APPLY);
      await new UpdateCommand().execute(testDir);
      await fs.writeFile(overlayFile(), '## Apply Via Revised Fan-out\n');
      clearPluginCache();

      expect(status().needsUpdate).toBe(true);

      await new UpdateCommand().execute(testDir);
      expect(await read('.claude', 'skills', 'openspec-apply-change', 'SKILL.md')).toContain('Revised Fan-out');
      expect(status().needsUpdate).toBe(false);
    });

    it('goes stale when supersedes changes', async () => {
      await writeFixturePlugin(SUPERSEDING_APPLY);
      await new UpdateCommand().execute(testDir);
      await writeFixturePlugin({ apply: { append: 'overlays/apply.md', supersedes: ['apply-inline-loop'] } });
      clearPluginCache();

      expect(status().needsUpdate).toBe(true);
    });

    it('goes stale when the plugin is removed from the whitelist', async () => {
      await writeFixturePlugin(SUPERSEDING_APPLY);
      await new UpdateCommand().execute(testDir);
      await fs.writeFile(path.join(testDir, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
      clearPluginCache();

      expect(status().needsUpdate).toBe(true);
    });

    it('reports stale instead of throwing when the overlays cannot be resolved', async () => {
      await writeFixturePlugin(SUPERSEDING_APPLY);
      await new UpdateCommand().execute(testDir);
      await writeFixturePlugin({ apply: { append: 'overlays/apply.md', supersedes: ['no-such-section'] } });
      clearPluginCache();

      expect(status().needsUpdate).toBe(true);
    });

    it('skips the fingerprint check for global skill targets shared across projects', async () => {
      // ~/.minimax/skills is shared by every project; comparing it with one
      // project's overlays would make projects with different plugins keep
      // re-rendering it for each other. Global targets fall back to the version.
      await writeFixturePlugin(SUPERSEDING_APPLY);
      const skill = path.join(process.env.HOME!, '.minimax', 'skills', 'openspec-explore', 'SKILL.md');
      await fs.mkdir(path.dirname(skill), { recursive: true });
      await fs.writeFile(
        skill,
        `---\nname: openspec-explore\nmetadata:\n  author: openspec\n  version: "1.0"\n  generatedBy: "${OPENSPEC_VERSION}"\n  overlays: "0123456789abcdef"\n---\n\nbody\n`
      );

      const minimax = getToolVersionStatus(testDir, 'minimax-code', OPENSPEC_VERSION);
      expect(minimax.configured).toBe(true);
      expect(minimax.overlaysChanged).toBe(false);
      expect(minimax.needsUpdate).toBe(false);
    });

    it('stamps no overlay fingerprint in a plugin-less project', async () => {
      await new UpdateCommand().execute(testDir);

      expect(await read('.claude', 'skills', 'openspec-apply-change', 'SKILL.md')).not.toContain('overlays:');
      expect(status().needsUpdate).toBe(false);
    });
  });
});
