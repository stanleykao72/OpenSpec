/**
 * Per-test-file environment isolation.
 *
 * The suite must not depend on — or write into — the developer's own machine.
 * Without this file, workers inherit the invoking shell's environment: e.g.
 * FORCE_COLOR makes chalk emit ANSI escapes that break plain-text assertions,
 * a real HOME exposes (and lets in-process `update` runs rewrite) tool dirs such
 * as `~/.minimax/skills`, and a real Oh My Zsh install ($ZSH) reports
 * completions as already installed.
 *
 * What this file neutralizes, exactly:
 *
 * - Redirected into a fresh temp dir (removed after the file's tests):
 *   HOME, USERPROFILE, APPDATA (<home>/AppData/Roaming),
 *   LOCALAPPDATA (<home>/AppData/Local).
 *   NOTE: USERPROFILE is now set on POSIX too, and skill-path resolution reads
 *   it before HOME (src/core/shared/skill-paths.ts:29). A test that redirects
 *   HOME for home-resolved paths must set USERPROFILE as well.
 * - Deleted:
 *   - color: FORCE_COLOR, NO_COLOR
 *   - shell: ZSH, ZSH_CUSTOM, ZDOTDIR, PROFILE
 *   - tool/global state: CODEX_HOME, XDG_CONFIG_HOME, XDG_DATA_HOME,
 *     XDG_CACHE_HOME, XDG_STATE_HOME
 *   - git: GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_CONFIG_GLOBAL,
 *     GIT_CONFIG_SYSTEM
 *   - OpenSpec behavior switches: OPENSPEC_NO_UPDATE_CHECK,
 *     OPENSPEC_NO_AUTO_CONFIG, OPENSPEC_NO_COMPLETIONS, OPENSPEC_CONCURRENCY,
 *     OPENSPEC_NO_ANIMATION, OPENSPEC_ENABLE_CLI_AGENT_OPENERS
 *   (OPENSPEC_TELEMETRY / DO_NOT_TRACK are pinned by vitest.config.ts `env`.)
 *
 * Setup files run in the worker before the test file is imported, so chalk and
 * every module that reads these variables at load time see the isolated values,
 * and `{ ...process.env }` snapshots taken by tests capture them too. Tests
 * that need specific values still set them explicitly.
 *
 * Requires `pool: 'forks'` (vitest.config.ts): os.homedir() honours $HOME only
 * in a process whose environment we own. Under a thread pool the native call
 * ignores the assignment — the self-check below fails fast instead of letting
 * the real home leak.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll } from 'vitest';

const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-test-home-'));

const DELETED_VARS = [
  'FORCE_COLOR',
  'NO_COLOR',
  'ZSH',
  'ZSH_CUSTOM',
  'ZDOTDIR',
  'PROFILE',
  'CODEX_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'OPENSPEC_NO_UPDATE_CHECK',
  'OPENSPEC_NO_AUTO_CONFIG',
  'OPENSPEC_NO_COMPLETIONS',
  'OPENSPEC_CONCURRENCY',
  'OPENSPEC_NO_ANIMATION',
  'OPENSPEC_ENABLE_CLI_AGENT_OPENERS',
];

for (const name of DELETED_VARS) {
  delete process.env[name];
}

process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
process.env.APPDATA = path.join(isolatedHome, 'AppData', 'Roaming');
process.env.LOCALAPPDATA = path.join(isolatedHome, 'AppData', 'Local');

if (os.homedir() !== isolatedHome) {
  throw new Error(
    `test/setup-env.ts: os.homedir() is ${os.homedir()}, not the isolated ${isolatedHome}. ` +
      "Home isolation needs vitest pool 'forks'; refusing to run against the real home."
  );
}

afterAll(() => {
  try {
    fs.rmSync(isolatedHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Best effort: a leftover temp dir must not fail the test file.
  }
});
