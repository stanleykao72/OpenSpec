import * as fs from 'node:fs';
import * as path from 'node:path';

import { readProjectConfig } from './project-config.js';
import { FileSystemUtils } from '../utils/file-system.js';

export type PlanningHomeKind = 'repo';

export interface PlanningHome {
  kind: PlanningHomeKind;
  root: string;
  changesDir: string;
  defaultSchema: string;
}

export interface ResolvePlanningHomeOptions {
  startPath?: string;
  allowImplicitRepoRoot?: boolean;
}

const REPO_DEFAULT_SCHEMA = 'spec-driven';

function pathExistsAsDirectory(candidatePath: string): boolean {
  try {
    return fs.statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function getSearchStartDirectory(startPath: string): string {
  const resolved = path.resolve(startPath);

  try {
    const stats = fs.statSync(resolved);
    const searchStart = stats.isDirectory() ? resolved : path.dirname(resolved);
    return FileSystemUtils.canonicalizeExistingPath(searchStart);
  } catch {
    return resolved;
  }
}

function findNearestAncestor(startPath: string, predicate: (dirPath: string) => boolean): string | null {
  let currentDir = getSearchStartDirectory(startPath);

  while (true) {
    if (predicate(currentDir)) {
      return FileSystemUtils.canonicalizeExistingPath(currentDir);
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

export function findRepoPlanningRootSync(startPath = process.cwd()): string | null {
  return findNearestAncestor(startPath, (dirPath) =>
    pathExistsAsDirectory(path.join(dirPath, 'openspec'))
  );
}

function repoPlanningHome(repoRoot: string): PlanningHome {
  // Honor openspec/config.yaml the same way the legacy getChangesDir() path
  // does. Before this, planning-home consumers (new/status/instructions)
  // hardcoded openspec/changes while run/validate/archive read the config
  // changesDir — a change created by `new` was invisible to `run`
  // (split-brain, introduced by the v1.4.1 planning-home merge).
  let changesDir = path.join(repoRoot, 'openspec', 'changes');
  let defaultSchema = REPO_DEFAULT_SCHEMA;
  try {
    const config = readProjectConfig(repoRoot);
    if (config?.changesDir) {
      changesDir = path.join(repoRoot, config.changesDir);
    }
    if (config?.schema) {
      defaultSchema = config.schema;
    }
  } catch {
    // Unreadable config → defaults, matching getChangesDir() behavior
  }
  return {
    kind: 'repo',
    root: repoRoot,
    changesDir,
    defaultSchema,
  };
}

export function resolveCurrentPlanningHomeSync(
  options: ResolvePlanningHomeOptions = {}
): PlanningHome {
  const startPath = options.startPath ?? process.cwd();
  const searchStart = getSearchStartDirectory(startPath);
  const repoRoot = findRepoPlanningRootSync(searchStart);

  if (repoRoot) {
    return repoPlanningHome(repoRoot);
  }

  if (options.allowImplicitRepoRoot === false) {
    throw new Error('No OpenSpec planning home found from the current directory.');
  }

  return repoPlanningHome(FileSystemUtils.canonicalizeExistingPath(searchStart));
}

export function getChangeDir(planningHome: PlanningHome, changeName: string): string {
  return FileSystemUtils.joinPath(planningHome.changesDir, changeName);
}

export function formatChangeLocation(planningHome: PlanningHome, changeName: string): string {
  // Repo homes always nest changesDir under the root.
  return path.relative(planningHome.root, getChangeDir(planningHome, changeName));
}
