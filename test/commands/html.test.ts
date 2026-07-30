import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Typed with an explicit rest parameter (rather than left to infer `[]` from
// a zero-arg implementation) so the `spawn: (...args) => spawnMock(...args)`
// forward below has a rest parameter to spread into, not just a bare tuple
// mismatch (TS2556: "A spread argument must either have a tuple type or be
// passed to a rest parameter").
const spawnMock = vi.fn((..._args: unknown[]) => ({ unref: vi.fn() }));
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { HtmlCommand, HtmlCommandError, openPath, resolveWithinContainer } from '../../src/commands/html.js';

describe('HtmlCommand', () => {
  let tempDir: string;
  let changesDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-test-html-cmd-'));
    changesDir = path.join(tempDir, 'openspec', 'changes');
    fs.mkdirSync(changesDir, { recursive: true });
    spawnMock.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeChange(name: string, files: Record<string, string>): string {
    const changeDir = path.join(changesDir, name);
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(changeDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf-8');
    }
    return changeDir;
  }

  describe('dangerous input rejection', () => {
    it('rejects ../../etc without touching the filesystem', async () => {
      const readdirSpy = vi.spyOn(fs.promises, 'readdir');
      const cmd = new HtmlCommand();

      await expect(cmd.execute('../../etc', {}, tempDir)).rejects.toThrow(HtmlCommandError);
      await expect(cmd.execute('../../etc', {}, tempDir)).rejects.toThrow(/Invalid change name/);
      expect(readdirSpy).not.toHaveBeenCalled();

      readdirSpy.mockRestore();
    });

    it('rejects a name containing a backslash', async () => {
      const cmd = new HtmlCommand();
      await expect(cmd.execute('foo\\bar', {}, tempDir)).rejects.toThrow(/Invalid change name/);
    });

    it('rejects a name containing an embedded ..', async () => {
      const cmd = new HtmlCommand();
      await expect(cmd.execute('foo..bar', {}, tempDir)).rejects.toThrow(/Invalid change name/);
    });

    it('rejects an empty name', async () => {
      const cmd = new HtmlCommand();
      await expect(cmd.execute('', {}, tempDir)).rejects.toThrow(/Invalid change name/);
    });

    // P2a: rejectDangerousInput now reuses the repo's kebab-case ALLOWLIST
    // (validateChangeName) instead of a denylist of specific "dangerous"
    // substrings — an allowlist structurally excludes shell metacharacters
    // a denylist could always miss one of.
    it('rejects a name containing shell metacharacters not covered by the old denylist', async () => {
      const cmd = new HtmlCommand();
      await expect(cmd.execute('foo;rm -rf /', {}, tempDir)).rejects.toThrow(/Invalid change name/);
      await expect(cmd.execute('foo$(whoami)', {}, tempDir)).rejects.toThrow(/Invalid change name/);
      await expect(cmd.execute('foo&calc.exe', {}, tempDir)).rejects.toThrow(/Invalid change name/);
      await expect(cmd.execute('foo|bar', {}, tempDir)).rejects.toThrow(/Invalid change name/);
    });

    it('rejects a non-kebab-case name (uppercase) even without path separators', async () => {
      const cmd = new HtmlCommand();
      await expect(cmd.execute('Add-Auth', {}, tempDir)).rejects.toThrow(/Invalid change name/);
    });
  });

  describe('unknown change', () => {
    it('lists near-match suggestions and throws', async () => {
      writeChange('add-widget-export', { 'proposal.md': '# Proposal\n\n## Why\n\nx\n' });
      const cmd = new HtmlCommand();

      await expect(cmd.execute('add-widget-exprot', {}, tempDir)).rejects.toThrow(HtmlCommandError);
      try {
        await cmd.execute('add-widget-exprot', {}, tempDir);
        expect.fail('expected execute to throw');
      } catch (err) {
        expect((err as Error).message).toContain('not found');
        expect((err as Error).message).toContain('add-widget-export');
      }
    });

    it('throws a "no changes exist" message when the changes dir is empty', async () => {
      const cmd = new HtmlCommand();
      await expect(cmd.execute('anything', {}, tempDir)).rejects.toThrow(/No changes exist/);
    });
  });

  describe('successful render', () => {
    // NB: `tempDir` is created under `os.tmpdir()`, which on macOS is itself
    // a symlink (`/var` → `/private/var`) — so the *returned* path (built
    // from the resolved change/output directory, per the P1c-followup fix
    // that makes `resolveWithinContainer`'s return value actually get used)
    // legitimately differs from a path built from the original
    // `changeDir`/`customOut` strings even with no attacker involved.
    // Assertions below compare against `fs.realpathSync(...)`-normalized
    // expectations rather than the raw strings for exactly that reason.
    it('writes spec-viewer.html to the change directory by default and returns that path', async () => {
      const changeDir = writeChange('my-change', {
        'proposal.md': '# Proposal: my-change\n\n## Why\n\nBecause.\n',
        'tasks.md': '## 1. Setup\n\n- [x] 1.1 Do it\n',
      });
      const cmd = new HtmlCommand();

      const outPath = await cmd.execute('my-change', {}, tempDir);

      expect(outPath).toBe(path.join(fs.realpathSync(changeDir), 'spec-viewer.html'));
      expect(fs.existsSync(outPath)).toBe(true);
      const content = fs.readFileSync(outPath, 'utf-8');
      expect(content).toContain('my-change');
      expect(content).toContain('Because.');
    });

    it('honors --out to write to a custom path, creating parent directories', async () => {
      writeChange('my-change', { 'proposal.md': '# Proposal\n\n## Why\n\nBecause.\n' });
      const cmd = new HtmlCommand();
      const customOut = path.join(tempDir, 'nested', 'dir', 'out.html');

      const outPath = await cmd.execute('my-change', { out: customOut }, tempDir);

      expect(outPath).toBe(path.join(fs.realpathSync(path.dirname(customOut)), 'out.html'));
      expect(fs.existsSync(customOut)).toBe(true);
    });

    it('invokes the platform opener when --open is set', async () => {
      writeChange('my-change', { 'proposal.md': '# Proposal\n\n## Why\n\nBecause.\n' });
      const cmd = new HtmlCommand();

      await cmd.execute('my-change', { open: true }, tempDir);

      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('does not invoke any opener when --open is not set', async () => {
      writeChange('my-change', { 'proposal.md': '# Proposal\n\n## Why\n\nBecause.\n' });
      const cmd = new HtmlCommand();

      await cmd.execute('my-change', {}, tempDir);

      expect(spawnMock).not.toHaveBeenCalled();
    });
  });

  // P1c: symlink TOCTOU guard. `getAvailableChanges` already filters
  // directory listings by `Dirent.isDirectory()` (false for a symlink
  // entry, on every platform Node supports — see `resolveWithinContainer`
  // unit tests below for the deterministic, filesystem-symlink-based proof
  // of the actual boundary logic). This block additionally proves the
  // end-to-end command never succeeds against a symlinked change entry,
  // whichever layer rejects it.
  describe('symlink escape rejection (end-to-end)', () => {
    it('never succeeds when the requested change name is a symlink pointing outside changesDir', async () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-test-outside-'));
      fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'do not leak me', 'utf-8');
      const linkPath = path.join(changesDir, 'evil-link');
      fs.symlinkSync(outsideDir, linkPath, 'dir');

      try {
        const cmd = new HtmlCommand();
        await expect(cmd.execute('evil-link', {}, tempDir)).rejects.toThrow(HtmlCommandError);
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });

  // (2) Output-file symlink guard: `spec-viewer.html` following symlinks by
  // default on write would let a pre-planted symlink redirect the write
  // to overwrite an arbitrary file elsewhere on disk. Applies identically
  // to the default location and an explicit --out.
  describe('output file symlink rejection (item 2)', () => {
    it('refuses to write through an existing symlink at the default output location', async () => {
      const changeDir = writeChange('my-change', { 'proposal.md': '# Proposal\n\n## Why\n\nBecause.\n' });
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-test-outside-target-'));
      const outsideTarget = path.join(outsideDir, 'victim.html');
      fs.writeFileSync(outsideTarget, 'original victim content', 'utf-8');
      const defaultOutPath = path.join(changeDir, 'spec-viewer.html');
      fs.symlinkSync(outsideTarget, defaultOutPath, 'file');

      try {
        const cmd = new HtmlCommand();
        await expect(cmd.execute('my-change', {}, tempDir)).rejects.toThrow(HtmlCommandError);
        await expect(cmd.execute('my-change', {}, tempDir)).rejects.toThrow(/symlink/);
        expect(fs.readFileSync(outsideTarget, 'utf-8')).toBe('original victim content');
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('refuses to write through an existing symlink at an explicit --out location', async () => {
      writeChange('my-change', { 'proposal.md': '# Proposal\n\n## Why\n\nBecause.\n' });
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-test-outside-target-'));
      const outsideTarget = path.join(outsideDir, 'victim.html');
      fs.writeFileSync(outsideTarget, 'original victim content', 'utf-8');
      const customOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-test-out-dir-'));
      const customOut = path.join(customOutDir, 'out.html');
      fs.symlinkSync(outsideTarget, customOut, 'file');

      try {
        const cmd = new HtmlCommand();
        await expect(cmd.execute('my-change', { out: customOut }, tempDir)).rejects.toThrow(HtmlCommandError);
        expect(fs.readFileSync(outsideTarget, 'utf-8')).toBe('original victim content');
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
        fs.rmSync(customOutDir, { recursive: true, force: true });
      }
    });

    it('still writes normally when the output path does not exist yet', async () => {
      writeChange('my-change', { 'proposal.md': '# Proposal\n\n## Why\n\nBecause.\n' });
      const cmd = new HtmlCommand();
      await expect(cmd.execute('my-change', {}, tempDir)).resolves.toBeTruthy();
    });

    it('overwrites normally when the output path already exists as a plain regular file (not a symlink)', async () => {
      const changeDir = writeChange('my-change', { 'proposal.md': '# Proposal\n\n## Why\n\nBecause.\n' });
      fs.writeFileSync(path.join(changeDir, 'spec-viewer.html'), 'stale previous render', 'utf-8');
      const cmd = new HtmlCommand();
      const outPath = await cmd.execute('my-change', {}, tempDir);
      expect(fs.readFileSync(outPath, 'utf-8')).not.toBe('stale previous render');
    });
  });

  // (6) Archive dead-code fix: `determineStation`'s `archive` branch was
  // unreachable because nothing ever produced a changeDir under
  // `archive/` — `rejectDangerousInput` rejected the very name shape
  // (`YYYY-MM-DD-slug`) archived changes actually have (leading digit),
  // and even past that, `resolveChangeName` only ever looked at the
  // active-changes listing.
  describe('archive reachability (item 6)', () => {
    function writeArchivedChange(name: string, files: Record<string, string>): string {
      const archiveChangeDir = path.join(changesDir, 'archive', name);
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(archiveChangeDir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf-8');
      }
      return archiveChangeDir;
    }

    it('accepts an archive-shaped name (YYYY-MM-DD-slug) at the dangerous-input gate instead of rejecting it outright', async () => {
      writeArchivedChange('2026-01-15-add-auth', {
        'proposal.md': '# Proposal\n\n## Why\n\nArchived.\n',
        'tasks.md': '## 1. Setup\n\n- [x] 1.1 Done\n',
      });
      const cmd = new HtmlCommand();
      await expect(cmd.execute('2026-01-15-add-auth', {}, tempDir)).resolves.toBeTruthy();
    });

    it('finds an archived change by exact directory-listing match and renders it with the archive station current', async () => {
      writeArchivedChange('2026-01-15-add-auth', {
        'proposal.md': '# Proposal: add-auth\n\n## Why\n\nArchived long ago.\n',
        'tasks.md': '## 1. Setup\n\n- [x] 1.1 Done\n',
      });
      const cmd = new HtmlCommand();

      const outPath = await cmd.execute('2026-01-15-add-auth', {}, tempDir);

      expect(fs.existsSync(outPath)).toBe(true);
      const html = fs.readFileSync(outPath, 'utf-8');
      expect(html).toContain('<li class="station current">archive</li>');
      expect(html).toContain('Archived long ago.');
    });

    it('does not resolve an archive-shaped name that has no matching archive directory, and does not leak archive names into suggestions', async () => {
      writeChange('add-widget-export', { 'proposal.md': '# Proposal\n\n## Why\n\nx\n' });
      writeArchivedChange('2026-01-15-add-auth', { 'proposal.md': '# Proposal\n\n## Why\n\nArchived.\n' });
      const cmd = new HtmlCommand();

      try {
        await cmd.execute('2026-02-02-nonexistent', {}, tempDir);
        expect.fail('expected execute to throw');
      } catch (err) {
        expect((err as Error).message).toContain('not found');
        // Suggestions are sourced from the active list only — the archive
        // entry that DOES exist must never appear as a suggestion here.
        expect((err as Error).message).not.toContain('2026-01-15-add-auth');
      }
    });

    it('never constructs-and-tries a path for a symlinked archive entry pointing outside changesDir', async () => {
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-test-outside-archive-'));
      fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'do not leak me', 'utf-8');
      const archiveDir = path.join(changesDir, 'archive');
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.symlinkSync(outsideDir, path.join(archiveDir, '2026-01-15-evil'), 'dir');

      try {
        const cmd = new HtmlCommand();
        await expect(cmd.execute('2026-01-15-evil', {}, tempDir)).rejects.toThrow(HtmlCommandError);
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });

  // (5) `.openspec.yaml` absence → filename-shape inference. Only when the
  // directory shape hits at least 2 of {proposal.md, design.md, tasks.md,
  // specs/} is a default schema silently applied (with an explicit note);
  // below that threshold no schema/gates are guessed at all.
  describe('.openspec.yaml absence — filename-shape schema inference (item 5)', () => {
    it('applies the default schema and notes it explicitly when >=2 of proposal/design/tasks/specs are present', async () => {
      writeChange('shaped-change', {
        'proposal.md': '# Proposal: shaped-change\n\n## Why\n\nLooks like a real change.\n',
        'tasks.md': '## 1. Setup\n\n- [x] 1.1 Done\n',
      });
      const cmd = new HtmlCommand();

      const outPath = await cmd.execute('shaped-change', {}, tempDir);
      const html = fs.readFileSync(outPath, 'utf-8');

      expect(html).toContain('schema 未宣告，依預設');
    });

    it('does not guess a schema (no gates, no note) when fewer than 2 of the shape markers are present', async () => {
      // Only proposal.md — a single stray markdown file, not enough to
      // look like a genuine spec-driven change directory.
      writeChange('barely-a-change', {
        'proposal.md': '# Proposal: barely-a-change\n\n## Why\n\nJust one file.\n',
      });
      const cmd = new HtmlCommand();

      const outPath = await cmd.execute('barely-a-change', {}, tempDir);
      const html = fs.readFileSync(outPath, 'utf-8');

      expect(html).not.toContain('schema 未宣告，依預設');
      expect(html).toContain('無已宣告的 gate');
    });

    it('does not show the auto-defaulted note when .openspec.yaml explicitly declares a schema', async () => {
      writeChange('declared-change', {
        '.openspec.yaml': 'schema: spec-driven\n',
        'proposal.md': '# Proposal: declared-change\n\n## Why\n\nDeclared.\n',
        'tasks.md': '## 1. Setup\n\n- [x] 1.1 Done\n',
      });
      const cmd = new HtmlCommand();

      const outPath = await cmd.execute('declared-change', {}, tempDir);
      const html = fs.readFileSync(outPath, 'utf-8');

      expect(html).not.toContain('schema 未宣告，依預設');
    });
  });

  describe('--artifact-body', () => {
    it('refuses --artifact-body with --open, before writing anything', async () => {
      const changeDir = writeChange('add-auth', { 'proposal.md': '# P\n' });
      const cmd = new HtmlCommand();

      await expect(
        cmd.execute('add-auth', { artifactBody: true, open: true }, tempDir)
      ).rejects.toThrow(HtmlCommandError);
      await expect(
        cmd.execute('add-auth', { artifactBody: true, open: true }, tempDir)
      ).rejects.toThrow(/cannot be combined with --open/);

      // Refused up front: no output file, and no opener launched.
      expect(fs.existsSync(path.join(changeDir, 'spec-viewer.html'))).toBe(false);
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('writes a wrapper-free fragment and never opens it', async () => {
      writeChange('add-auth', { 'proposal.md': '# P\n\n## Why\n\n| a | b |\n|---|---|\n| 1 | 2 |\n' });
      const cmd = new HtmlCommand();
      const outPath = await cmd.execute('add-auth', { artifactBody: true }, tempDir);

      const html = fs.readFileSync(outPath, 'utf-8');
      for (const tag of ['<!doctype', '<html', '<head', '<body']) {
        expect(html.toLowerCase()).not.toContain(tag);
      }
      expect(html.trimStart().startsWith('<div class="spec-viewer">')).toBe(true);
      expect(html).toContain('<table class="spec-md-table">');
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('still writes a full document when --artifact-body is absent', async () => {
      writeChange('add-auth', { 'proposal.md': '# 中文\n' });
      const cmd = new HtmlCommand();
      const outPath = await cmd.execute('add-auth', {}, tempDir);
      const html = fs.readFileSync(outPath, 'utf-8');
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<meta charset="utf-8">');
    });
  });
});

describe('resolveWithinContainer (P1c symlink TOCTOU boundary check)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-test-boundary-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not throw when the candidate is a real subdirectory of the container', () => {
    const container = path.join(tempDir, 'changes');
    const candidate = path.join(container, 'my-change');
    fs.mkdirSync(candidate, { recursive: true });

    expect(() => resolveWithinContainer(candidate, container, 'change directory')).not.toThrow();
  });

  it('rejects a candidate that resolves outside the container via a symlink', () => {
    const container = path.join(tempDir, 'changes');
    fs.mkdirSync(container, { recursive: true });
    const outside = path.join(tempDir, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    const evilLink = path.join(container, 'evil-link');
    fs.symlinkSync(outside, evilLink, 'dir');

    expect(() => resolveWithinContainer(evilLink, container, 'change directory')).toThrow(HtmlCommandError);
    expect(() => resolveWithinContainer(evilLink, container, 'change directory')).toThrow(/outside/);
  });

  it('does not accept a sibling directory whose name merely starts with the container name as a string (path-segment boundary, not string prefix)', () => {
    const container = path.join(tempDir, 'changes');
    const sibling = path.join(tempDir, 'changes-evil');
    fs.mkdirSync(container, { recursive: true });
    fs.mkdirSync(sibling, { recursive: true });

    expect(() => resolveWithinContainer(sibling, container, 'change directory')).toThrow(HtmlCommandError);
  });

  it('throws (not crashes with a raw fs error) when the candidate does not exist at all', () => {
    const container = path.join(tempDir, 'changes');
    fs.mkdirSync(container, { recursive: true });
    const missing = path.join(container, 'does-not-exist');

    expect(() => resolveWithinContainer(missing, container, 'change directory')).toThrow(HtmlCommandError);
  });
});

describe('openPath', () => {
  it('uses "open" on darwin', () => {
    const fake = vi.fn(() => ({ unref: vi.fn() }) as any);
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      openPath('/tmp/foo.html', fake as any);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
    expect(fake).toHaveBeenCalledWith('open', ['/tmp/foo.html']);
  });

  it('uses "xdg-open" on linux', () => {
    const fake = vi.fn(() => ({ unref: vi.fn() }) as any);
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      openPath('/tmp/foo.html', fake as any);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
    expect(fake).toHaveBeenCalledWith('xdg-open', ['/tmp/foo.html']);
  });

  it('never throws even if the spawn function throws', () => {
    const throwing = vi.fn(() => {
      throw new Error('nope');
    });
    expect(() => openPath('/tmp/foo.html', throwing as any)).not.toThrow();
  });

  // P2a: on win32, route through powershell.exe's Start-Process (bound via
  // $args[0], not string-interpolated) instead of the fragile `cmd /c
  // start` form.
  it('routes through powershell.exe Start-Process on win32, binding the path via a trailing arg rather than string interpolation', () => {
    const fake = vi.fn((..._args: unknown[]) => ({ unref: vi.fn(), on: vi.fn() }) as any);
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      openPath('C:\\some path\\foo.html', fake as any);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
    expect(fake).toHaveBeenCalledTimes(1);
    const [command, args] = fake.mock.calls[0] as [string, string[]];
    expect(command).toBe('powershell.exe');
    expect(args).not.toEqual(expect.arrayContaining(['cmd']));
    // The path must be its own distinct argv element, never concatenated
    // into the -Command script text (that's exactly the injection surface
    // being closed).
    expect(args[args.length - 1]).toBe('C:\\some path\\foo.html');
    expect(args.some((a: string) => a.includes('C:\\some path\\foo.html') && a !== 'C:\\some path\\foo.html')).toBe(
      false
    );
  });

  // P2b: spawn() reports a missing/unusable launcher asynchronously via an
  // 'error' event on the returned child, not synchronously — an unhandled
  // one crashes the whole process. openPath must listen for it and swallow
  // it (warn, don't throw/crash).
  describe('async spawn error handling (P2b)', () => {
    it('registers an error listener on the returned child and swallows a later async error without throwing', () => {
      const handlers: Record<string, (...args: unknown[]) => void> = {};
      const fakeChild = {
        unref: vi.fn(),
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          handlers[event] = cb;
        }),
      };
      const fake = vi.fn(() => fakeChild as any);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => openPath('/tmp/foo.html', fake as any)).not.toThrow();
      expect(fakeChild.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(handlers.error).toBeTypeOf('function');

      // Simulate the async 'error' event spawn() would emit for e.g. ENOENT.
      expect(() => handlers.error(new Error('spawn xdg-open ENOENT'))).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
      expect(String(warnSpy.mock.calls[0][0])).toContain('/tmp/foo.html');

      warnSpy.mockRestore();
    });

    it('does not throw when the returned child has no .on method at all (defensive optional chaining)', () => {
      const fake = vi.fn(() => ({ unref: vi.fn() }) as any);
      expect(() => openPath('/tmp/foo.html', fake as any)).not.toThrow();
    });
  });

});
