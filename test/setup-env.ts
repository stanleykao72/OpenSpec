/**
 * Per-test-file environment isolation.
 *
 * The suite must not depend on — or write into — the developer's own machine.
 * Without this file, workers inherit the invoking shell's environment and:
 *
 * - FORCE_COLOR (exported by many terminals and agent harnesses) makes chalk
 *   emit ANSI escapes in-process and in every spawned CLI child, so plain-text
 *   assertions such as `toContain('1 specs, 1 requirements')` fail.
 * - HOME points at the real home, so tools resolved from it (e.g. MiniMax's
 *   `~/.minimax/skills`) are detected as installed, skew profile migration and
 *   tool detection, and get *rewritten* by in-process `update` runs.
 * - ZSH / ZSH_CUSTOM take precedence over HOME in the zsh installer, so a real
 *   Oh My Zsh install reports completions as already installed.
 * - CODEX_HOME / XDG_* redirect global state outside HOME the same way.
 *
 * Setup files run in the worker before the test file is imported, so chalk and
 * every module that reads these variables at load time see the isolated values,
 * and `{ ...process.env }` snapshots taken by tests capture them too. Tests
 * that need specific values still set them explicitly.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll } from 'vitest';

const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-test-home-'));

delete process.env.FORCE_COLOR;
delete process.env.ZSH;
delete process.env.ZSH_CUSTOM;
delete process.env.ZDOTDIR;
delete process.env.CODEX_HOME;
delete process.env.XDG_CONFIG_HOME;
delete process.env.XDG_DATA_HOME;
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;

afterAll(() => {
  fs.rmSync(isolatedHome, { recursive: true, force: true });
});
