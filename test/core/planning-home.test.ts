import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type PlanningHome,
  formatChangeLocation,
  getChangeDir,
  resolveCurrentPlanningHomeSync,
} from '../../src/core/planning-home.js';

describe('planning home paths', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves repo-local projects with foreign workspace.yaml as repo planning homes', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-planning-home-'));
    tempDirs.push(tempDir);
    const repoRoot = path.join(tempDir, 'foreign-tool-repo');
    const changesDir = path.join(repoRoot, 'openspec', 'changes');

    fs.mkdirSync(changesDir, { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, 'workspace.yaml'),
      `tool_workspace:
  projects:
    - name: example
      path: ./service
`,
      'utf-8'
    );

    const planningHome = resolveCurrentPlanningHomeSync({
      startPath: changesDir,
      allowImplicitRepoRoot: false,
    });

    expect(planningHome.kind).toBe('repo');
    expect(planningHome.root).toBe(fs.realpathSync.native(repoRoot));
  });

  it('honors config.yaml changesDir and schema for repo planning homes', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-planning-home-'));
    tempDirs.push(tempDir);
    const repoRoot = path.join(tempDir, 'configured-repo');
    fs.mkdirSync(path.join(repoRoot, 'openspec'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, 'openspec', 'config.yaml'),
      'schema: odoo-sdd\nchangesDir: "../vault/changes"\n',
      'utf-8'
    );
    fs.mkdirSync(path.join(tempDir, 'vault', 'changes'), { recursive: true });

    const planningHome = resolveCurrentPlanningHomeSync({
      startPath: repoRoot,
      allowImplicitRepoRoot: false,
    });

    expect(planningHome.kind).toBe('repo');
    // Must agree with the legacy getChangesDir() resolution — a change
    // created via planning-home must be visible to run/validate/archive.
    expect(planningHome.changesDir).toBe(
      path.join(fs.realpathSync.native(repoRoot), '../vault/changes')
    );
    expect(planningHome.defaultSchema).toBe('odoo-sdd');
  });

  it('falls back to openspec/changes when config.yaml is absent', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-planning-home-'));
    tempDirs.push(tempDir);
    const repoRoot = path.join(tempDir, 'bare-repo');
    fs.mkdirSync(path.join(repoRoot, 'openspec'), { recursive: true });

    const planningHome = resolveCurrentPlanningHomeSync({
      startPath: repoRoot,
      allowImplicitRepoRoot: false,
    });

    expect(planningHome.changesDir).toBe(
      path.join(fs.realpathSync.native(repoRoot), 'openspec', 'changes')
    );
    expect(planningHome.defaultSchema).toBe('spec-driven');
  });
});
