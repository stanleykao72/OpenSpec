import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The fork's version must state the upstream base it is built on.
 *
 * `main` is the upstream mirror: the branch convention keeps it at zero fork
 * commits, so its `package.json` is upstream's own and needs no tag lookup or
 * merge-base to interpret. When a merge resolves the version hunk in favour of
 * the fork's older number - which is how `openspec --version` came to report
 * 1.5.0 from a v1.10.0 base - the two disagree and this fails.
 *
 * `check:pack-version` cannot stand in for this. It compares the packed CLI's
 * `--version` against `package.json`, and both halves agreed on the wrong
 * number for a week.
 */

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIRROR_BRANCH = 'main';

function versionIn(packageJson: string): string {
  const parsed: unknown = JSON.parse(packageJson);
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== 'string') throw new Error('package.json has no string version');
  return version;
}

/**
 * The mirror's manifest, or null when it cannot be read - no git on PATH, a
 * shallow clone, or a checkout that never fetched `main`. Null means unverified,
 * and the caller skips rather than passing: a guard that succeeds when it could
 * not look is the failure this check exists to prevent.
 */
function mirrorPackageJson(): string | null {
  try {
    return execFileSync('git', ['show', `${MIRROR_BRANCH}:package.json`], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

describe('fork version parity', () => {
  it(`states the version on ${MIRROR_BRANCH}, the upstream mirror`, (ctx) => {
    const mirror = mirrorPackageJson();
    if (mirror === null) {
      ctx.skip();
      return;
    }

    const local = versionIn(readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    const upstream = versionIn(mirror);

    expect(
      local,
      `package.json says ${local}, but ${MIRROR_BRANCH} (the upstream mirror) says ` +
        `${upstream}. A merge resolved the version hunk in favour of the stale value; ` +
        `the CLI now misreports the base it runs.`
    ).toBe(upstream);
  });
});
