/**
 * `openspec html <change-name> [--open] [--out PATH]`
 *
 * Renders a change's artifacts into a single self-contained
 * `spec-viewer.html` file. See
 * `openspec/changes/add-openspec-html-command/specs/html-viewer-command/spec.md`
 * Requirement "指令介面與輸出落點" for the full contract this command
 * implements (change-name validation via directory listing, default output
 * location, `--out` override, `--open`, non-zero exit + near-match
 * suggestions when the change isn't found).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

import { getChangesDir, validateChangeName } from '../utils/change-utils.js';
import { getAvailableChanges } from './workflow/shared.js';
import { nearestMatches } from '../utils/match.js';
import { resolveSchemaForChange, readChangeMetadata } from '../utils/change-metadata.js';
import { resolveSchema } from '../core/artifact-graph/index.js';
import type { SchemaYaml } from '../core/artifact-graph/types.js';
import { renderChangeHtml } from '../core/render/html.js';

export class HtmlCommandError extends Error {}

/** Same default used elsewhere in the CLI (`workflow/shared.ts`'s
 * `DEFAULT_SCHEMA`) — duplicated as a literal here rather than imported to
 * avoid a cross-module coupling for a single string constant. */
const DEFAULT_SCHEMA_NAME = 'spec-driven';

/**
 * Archive directory names follow `YYYY-MM-DD-slug` (e.g.
 * `2026-01-15-add-auth`) — structurally incompatible with the standard
 * kebab-case change-name allowlist (`validateChangeName`, which requires
 * starting with a lowercase letter, so a leading digit is always
 * rejected). This is a second, independent allowlist scoped specifically
 * to that shape: still no path separators, no `..`, no shell
 * metacharacters — just a different structural shape than an active
 * change name.
 */
const ARCHIVE_NAME_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$/;

export interface HtmlCommandOptions {
  open?: boolean;
  out?: string;
  /** Emit a wrapper-free fragment for Artifact publishing instead of a full
   * standalone document (spec Requirement: artifact 發佈模式輸出無外殼片段). */
  artifactBody?: boolean;
}

export type SpawnFn = (command: string, args: string[]) => ChildProcess;

function warnOpenFailure(filePath: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`openspec: could not open '${filePath}' automatically (${message}).`);
}

/**
 * Default `--open` launcher: platform-appropriate "open this file with the
 * OS default handler" command. Never throws, and never crashes the process
 * on an async launch failure either — a failed launch is not a command
 * failure (the file was already written successfully by the time this
 * runs).
 */
export function openPath(filePath: string, spawnFn: SpawnFn = defaultSpawn): void {
  const platform = process.platform;
  try {
    let child: ChildProcess;
    if (platform === 'darwin') {
      child = spawnFn('open', [filePath]);
    } else if (platform === 'win32') {
      // `cmd /c start` requires reconstructing a single command-line string
      // that cmd.exe itself re-parses for shell metacharacters (`&`, `|`,
      // `^`, `%...%`) — a real class of Windows command-injection issues
      // even when each argv element is passed separately (no `shell: true`).
      // Route through `powershell.exe` (a plain executable, not subject to
      // that cmd.exe/.bat re-parsing) and bind the path via `$args[0]`
      // rather than string-interpolating it into the `-Command` script text,
      // so the path's content is never re-parsed as script/shell syntax.
      // Belt-and-suspenders: the default output path is always
      // `<allowlisted-change-name>/spec-viewer.html` (rejectDangerousInput
      // below enforces the kebab-case allowlist), so it can never contain
      // shell metacharacters in the first place; this only matters for an
      // explicit `--out` path.
      child = spawnFn('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Start-Process -FilePath $args[0]',
        filePath,
      ]);
    } else {
      child = spawnFn('xdg-open', [filePath]);
    }
    // spawn() does NOT throw synchronously when the launcher binary is
    // missing/unusable — it emits an async 'error' event on the returned
    // child instead. An unhandled 'error' event crashes the whole Node
    // process, which would turn "couldn't launch a browser" into "the CLI
    // itself died" despite the HTML file having already been written
    // successfully. `child?.on?.` tolerates test doubles that don't
    // implement the full ChildProcess/EventEmitter surface.
    child?.on?.('error', (err: unknown) => warnOpenFailure(filePath, err));
  } catch (err) {
    // Best-effort; the rendered file already exists on disk regardless.
    warnOpenFailure(filePath, err);
  }
}

function defaultSpawn(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

/**
 * Resolves `candidatePath` through the filesystem (following any symlinks)
 * and asserts the result still sits inside the resolved `containerPath`, at
 * a path-segment boundary — a naive string-prefix check would let
 * `/changes-evil` pass a `/changes` container check. This is the actual
 * TOCTOU defense: callers MUST use the *returned* (already-resolved) path
 * for all subsequent filesystem access rather than the original
 * (potentially symlinked) one, so a symlink swap that happens after this
 * check has no effect on the operation that follows it.
 */
export function resolveWithinContainer(candidatePath: string, containerPath: string, label: string): string {
  let realCandidate: string;
  let realContainer: string;
  try {
    realCandidate = fs.realpathSync(candidatePath);
    realContainer = fs.realpathSync(containerPath);
  } catch (err) {
    throw new HtmlCommandError(`Failed to resolve ${label} '${candidatePath}': ${(err as Error).message}`);
  }
  const withinBoundary = realCandidate === realContainer || realCandidate.startsWith(realContainer + path.sep);
  if (!withinBoundary) {
    throw new HtmlCommandError(
      `Refusing to use ${label}: '${candidatePath}' resolves (via symlink) to '${realCandidate}', which is outside '${realContainer}'.`
    );
  }
  return realCandidate;
}

export class HtmlCommand {
  /**
   * @returns the absolute path the HTML file was written to.
   */
  async execute(
    changeNameArg: string,
    options: HtmlCommandOptions = {},
    projectRoot: string = process.cwd()
  ): Promise<string> {
    this.rejectDangerousInput(changeNameArg);

    // Mutually exclusive, and refused before anything is read or written: an
    // artifact fragment has no <meta charset> and no document wrapper, so
    // opening one in a browser shows a broken, mojibake page. Failing loudly
    // beats "best effort" here — a warning would just be ignored while the
    // user concludes the renderer is broken (spec Scenario: 互斥旗標).
    if (options.artifactBody && options.open) {
      throw new HtmlCommandError(
        '--artifact-body cannot be combined with --open: a wrapper-free fragment is not a viewable document. ' +
          'Publish it as an Artifact, or drop --artifact-body to get a standalone file.'
      );
    }

    const changesDir = getChangesDir(projectRoot);
    const { changeName, changeDir } = await this.resolveChangeLocation(changeNameArg, projectRoot, changesDir);
    // Symlink TOCTOU guard: `changeDir` was built from a directory-listing
    // match above (active or archived), but the directory entry itself
    // could still (now, or via a race after that listing check) be a
    // symlink pointing outside `changesDir`. Confirm via realpath BEFORE
    // any read happens; this throws (refusing to read anything) if the
    // resolved path escapes `changesDir`.
    //
    // The RETURNED value — not the original `changeDir` — is what every
    // subsequent read (schema resolution, every artifact read inside
    // renderChangeHtml) MUST use. Checking the boundary and then
    // continuing to operate on the original, unresolved path would make
    // this whole guard decorative: a symlink swapped in between the check
    // and the read would still be followed right past it.
    const resolvedChangeDir = resolveWithinContainer(changeDir, changesDir, 'change directory');

    const { schema, schemaAutoDefaulted } = this.resolveSchemaSafely(resolvedChangeDir, projectRoot);
    const html = renderChangeHtml({
      changeDir: resolvedChangeDir,
      changeName,
      schema,
      schemaAutoDefaulted,
      artifactBody: options.artifactBody === true,
    });

    const requestedOutPath = options.out ? path.resolve(options.out) : path.join(changeDir, 'spec-viewer.html');
    // Output location gets the same "use the resolved value" discipline as
    // the change directory above: `resolvedOutDir` (not the original,
    // possibly-symlinked directory) is what the file actually gets joined
    // with and written to. For the default (inside changeDir) location
    // this is exactly `resolvedChangeDir`, already boundary-checked above —
    // no need to re-derive or re-check it. An explicit `--out` is a
    // deliberate escape hatch chosen by the invoking user, so its
    // directory must simply resolve (mkdirSync must have produced/found a
    // real directory) rather than being boundary-checked against
    // `changesDir`.
    let resolvedOutDir: string;
    if (options.out) {
      const outDir = path.dirname(requestedOutPath);
      fs.mkdirSync(outDir, { recursive: true });
      resolvedOutDir = fs.realpathSync(outDir);
    } else {
      resolvedOutDir = resolvedChangeDir;
    }
    const outPath = path.join(resolvedOutDir, path.basename(requestedOutPath));

    // Output-file symlink guard: if something already sits at `outPath`
    // and is itself a symlink, refuse rather than silently following it to
    // overwrite whatever it points to (which could be anywhere on disk,
    // entirely outside `changesDir`). Applies identically to the default
    // location and an explicit `--out` — same rule either way.
    this.rejectSymlinkOutputTarget(outPath);

    this.writeFileNoFollow(outPath, html);

    if (options.open) {
      openPath(outPath);
    }

    return outPath;
  }

  /**
   * Refuses to write through an existing symlink at the destination path.
   * `fs.writeFileSync` follows symlinks by default — writing "to" a
   * symlinked `spec-viewer.html` would actually overwrite whatever file
   * the symlink points to, which could be outside `changesDir` entirely.
   * `lstatSync` (not `statSync`) is essential here: it reports on the
   * link itself rather than following it, which is exactly what needs to
   * be detected before the write, not after.
   */
  /**
   * Writes through a file descriptor opened with `O_NOFOLLOW`, so the
   * kernel itself refuses to follow a symlink at the final path
   * component — atomically, with no check-then-act window. This closes
   * the TOCTOU race left by `rejectSymlinkOutputTarget()` alone (a
   * symlink planted between the `lstatSync` check and the write would
   * otherwise be followed). The lstat pre-check is kept for its clearer
   * error message and as the only line of defense on platforms without
   * `O_NOFOLLOW` (Windows — where symlink creation needs elevated
   * rights to begin with). Residual, documented and accepted: symlinks
   * in *directory* components of the path (same threat model residual
   * as odoo-claude-code's write_apply_handoff writer).
   */
  private writeFileNoFollow(outPath: string, content: string): void {
    const O = fs.constants;
    const noFollow = typeof O.O_NOFOLLOW === 'number' ? O.O_NOFOLLOW : 0;
    let fd: number;
    try {
      fd = fs.openSync(outPath, O.O_WRONLY | O.O_CREAT | O.O_TRUNC | noFollow);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ELOOP' || code === 'EMLINK') {
        throw new HtmlCommandError(
          `Refusing to write to '${outPath}': the destination is a symlink. This command will not follow it to overwrite whatever it points to — remove it manually or choose a different --out path.`
        );
      }
      throw err;
    }
    try {
      fs.writeFileSync(fd, content, 'utf-8');
    } finally {
      fs.closeSync(fd);
    }
  }

  private rejectSymlinkOutputTarget(outPath: string): void {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(outPath);
    } catch {
      return; // doesn't exist yet — nothing to refuse
    }
    if (st.isSymbolicLink()) {
      throw new HtmlCommandError(
        `Refusing to write to '${outPath}': it already exists as a symlink. This command will not follow it to overwrite whatever it points to — remove it manually or choose a different --out path.`
      );
    }
  }

  /**
   * Rejects dangerous/malformed change-name input before any filesystem
   * access at all (spec scenario "危險輸入拒絕": `openspec html ../../etc`
   * must not touch the filesystem). Reuses the repo's existing kebab-case
   * ALLOWLIST validator (`validateChangeName`) rather than maintaining a
   * separate denylist here — a denylist of "dangerous" substrings is
   * inherently incomplete (e.g. it's easy to forget a new shell
   * metacharacter), whereas the allowlist already used for creating changes
   * (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`) structurally cannot contain path
   * separators, `..`, or shell metacharacters.
   */
  private rejectDangerousInput(changeNameArg: string): void {
    const result = validateChangeName(changeNameArg);
    if (result.valid) return;
    // Archive-shaped names (`YYYY-MM-DD-slug`) are structurally distinct
    // from active change names (they start with a digit, which the
    // kebab-case allowlist above always rejects) but are still a strict
    // allowlist in their own right — accept those too rather than blocking
    // every archived change at the front door before `resolveChangeLocation`
    // even gets a chance to look for them.
    if (ARCHIVE_NAME_PATTERN.test(changeNameArg)) return;
    throw new HtmlCommandError(
      `Invalid change name '${changeNameArg}': ${result.error} (must be a plain kebab-case directory name — no path separators, no '..').`
    );
  }

  /**
   * Change existence MUST go through directory-listing comparison, not
   * "build the path and try to read it" (spec Requirement "指令介面與輸出
   * 落點"). Unknown names get near-match suggestions, never a raw dump of
   * every change when there's a large workspace.
   *
   * Looks in two places, in order:
   * 1. Active changes (`getAvailableChanges`, excludes `archive/`).
   * 2. If not found there AND the name is shaped like an archive entry
   *    (`ARCHIVE_NAME_PATTERN`), the `archive/` subdirectory listing —
   *    enumerated and exact-matched, exactly like step 1, never
   *    constructed-and-tried blind. This is what actually makes
   *    `determineStation`'s `archive` branch reachable; before this, no
   *    code path ever produced a `changeDir` under `archive/` at all.
   *
   * Near-match suggestions on a miss are sourced from the active list
   * only, in both cases — an unmatched archive-shaped name does not start
   * dumping archive contents into the suggestion list either.
   */
  private async resolveChangeLocation(
    changeNameArg: string,
    projectRoot: string,
    changesDir: string
  ): Promise<{ changeName: string; changeDir: string }> {
    const available = await getAvailableChanges(projectRoot, changesDir);
    if (available.includes(changeNameArg)) {
      return { changeName: changeNameArg, changeDir: path.join(changesDir, changeNameArg) };
    }

    if (ARCHIVE_NAME_PATTERN.test(changeNameArg)) {
      const archiveDir = path.join(changesDir, 'archive');
      let archiveEntries: fs.Dirent[] = [];
      try {
        archiveEntries = fs.readdirSync(archiveDir, { withFileTypes: true });
      } catch {
        archiveEntries = [];
      }
      const archivedNames = archiveEntries.filter((e) => e.isDirectory()).map((e) => e.name);
      if (archivedNames.includes(changeNameArg)) {
        return { changeName: changeNameArg, changeDir: path.join(archiveDir, changeNameArg) };
      }
    }

    if (available.length === 0) {
      throw new HtmlCommandError(`Change '${changeNameArg}' not found. No changes exist.`);
    }

    const candidates = nearestMatches(changeNameArg, available, 5);
    const suggestion = candidates.length > 0 ? `\nDid you mean:\n  ${candidates.join('\n  ')}` : '';
    throw new HtmlCommandError(`Change '${changeNameArg}' not found.${suggestion}`);
  }

  /**
   * Schema resolution is best-effort: a malformed `.openspec.yaml` or an
   * unknown schema name must not fail the whole render — the renderer
   * degrades gracefully (no declared gates) rather than crashing.
   *
   * When `.openspec.yaml` itself is absent, the render mode is inferred
   * from the directory's filename shape (spec Requirement "artifacts 讀取
   * 與缺席處理"): only when at least two of {proposal.md, design.md,
   * tasks.md, specs/} are present does this look enough like a real
   * spec-driven change to silently apply the default schema for gate
   * declarations — and `schemaAutoDefaulted: true` tells the renderer to
   * say so explicitly rather than let that guess look like a genuine
   * declaration. Below that threshold, no schema is applied at all (no
   * gates rendered), rather than guessing on what may not even be a real
   * change directory.
   */
  private resolveSchemaSafely(
    changeDir: string,
    projectRoot: string
  ): { schema: SchemaYaml | null; schemaAutoDefaulted: boolean } {
    let metadataFileExists = true;
    try {
      metadataFileExists = readChangeMetadata(changeDir, projectRoot) !== null;
    } catch {
      // Exists but invalid/corrupt: still a declaration attempt, not an
      // absence — falls through to the normal resolution path below,
      // which has its own fallback-to-default on error.
      metadataFileExists = true;
    }

    if (!metadataFileExists) {
      const shapeHits = [
        fs.existsSync(path.join(changeDir, 'proposal.md')),
        fs.existsSync(path.join(changeDir, 'design.md')),
        fs.existsSync(path.join(changeDir, 'tasks.md')),
        fs.existsSync(path.join(changeDir, 'specs')),
      ].filter(Boolean).length;

      if (shapeHits < 2) {
        return { schema: null, schemaAutoDefaulted: false };
      }
      try {
        return { schema: resolveSchema(DEFAULT_SCHEMA_NAME, projectRoot), schemaAutoDefaulted: true };
      } catch {
        return { schema: null, schemaAutoDefaulted: false };
      }
    }

    let schemaName = DEFAULT_SCHEMA_NAME;
    try {
      schemaName = resolveSchemaForChange(changeDir, undefined, projectRoot);
    } catch {
      // fall back to default
    }
    try {
      return { schema: resolveSchema(schemaName, projectRoot), schemaAutoDefaulted: false };
    } catch {
      return { schema: null, schemaAutoDefaulted: false };
    }
  }
}
