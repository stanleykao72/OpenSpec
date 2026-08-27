import { asStatus } from '../commands/shared-output.js';
import { Command, Option } from 'commander';
import { createRequire } from 'module';
import ora from 'ora';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, promises as fs } from 'fs';
import { AI_TOOLS, TOOL_ID_ALIASES } from '../core/config.js';
import { UpdateCommand } from '../core/update.js';
import {
  getAvailableCliUpdate,
  displayCliUpdateNote,
  shouldOfferUpgrade,
  getInstallDir,
  offerCliUpgrade,
  rerunUpdateWithUpgradedCli,
  displayUpgradeCommand,
  isSourceCheckout,
} from '../core/version-check.js';
import { ListCommand } from '../core/list.js';
import { ArchiveCommand, type ArchiveOptions } from '../core/archive.js';
import { ViewCommand } from '../core/view.js';
import { resolveRootForCommand, toRootOutput } from '../core/root-selection.js';
import { registerSpecCommand } from '../commands/spec.js';
import { ChangeCommand } from '../commands/change.js';
import { ValidateCommand } from '../commands/validate.js';
import { ShowCommand } from '../commands/show.js';
import { CompletionCommand } from '../commands/completion.js';
import { FeedbackCommand } from '../commands/feedback.js';
import { registerConfigCommand } from '../commands/config.js';
import { registerSchemaCommand } from '../commands/schema.js';
import { registerPluginCommand } from '../commands/plugin.js';
import { readProjectConfig } from '../core/project-config.js';
import { loadPlugins } from '../core/plugin/loader.js';
import { validateAllPluginConfigs } from '../core/plugin/config-validator.js';
import { GateCommand } from '../commands/gate.js';
import { HtmlCommand } from '../commands/html.js';
import { RunCommand } from '../commands/run.js';
import { registerStoreCommand } from '../commands/store.js';
import { registerDoctorCommand } from '../commands/doctor.js';
import { registerContextCommand } from '../commands/context.js';
import { registerWorksetCommand } from '../commands/workset.js';
import {
  statusCommand,
  BATCH_STATUS_FAILURE_PAYLOAD,
  instructionsCommand,
  applyInstructionsCommand,
  archiveInstructionsCommand,
  templatesCommand,
  schemasCommand,
  newChangeCommand,
  DEFAULT_SCHEMA,
  type StatusOptions,
  type InstructionsOptions,
  type TemplatesOptions,
  type SchemasOptions,
  type NewChangeOptions,
} from '../commands/workflow/index.js';
import { maybeShowTelemetryNotice, trackCommand, shutdown } from '../telemetry/index.js';
import { maybeShowCompletionTip } from '../core/completion-tip.js';
import { COMMON_FLAGS } from '../core/completions/shared-flags.js';
import { isInteractive } from '../utils/interactive.js';

const STORE_OPTION_DESCRIPTION = COMMON_FLAGS.store.description;

// Deliberate rejection path: --store-path stays registered (hidden) so the
// resolver can explain that registering the path is the supported route,
// instead of Commander emitting a generic unknown-option error (or, for
// `show`, silently ignoring it via allowUnknownOption).
function hiddenStorePathOption(): Option {
  return new Option(
    '--store-path <path>',
    'Not supported; register the path with "openspec store register <path>" and use --store <id>'
  ).hideHelp();
}

function failWithError(
  error: unknown,
  json?: { enabled: boolean | undefined; payload?: Record<string, unknown>; fallbackCode?: string }
): void {
  // The agent contract: every --json failure leaves exactly one JSON
  // document on stdout (the command's null-shape plus a status array).
  if (json?.enabled) {
    console.log(
      JSON.stringify(
        { ...(json.payload ?? {}), status: [asStatus(error, json.fallbackCode ?? 'command_error')] },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }
  ora().fail(`Error: ${(error as Error).message}`);
  // Resolution and store errors carry a pasteable fix - never drop it.
  const fix = (error as { diagnostic?: { fix?: string } }).diagnostic?.fix;
  if (fix) {
    console.error(`Fix: ${fix}`);
  }
  process.exitCode = process.exitCode ?? 1;
}

const program = new Command();
const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

/**
 * Get the full command path for nested commands.
 * For example: 'change show' -> 'change:show'
 */
export function getCommandPath(command: Command): string {
  const names: string[] = [];
  let current: Command | null = command;

  while (current) {
    const name = current.name();
    // Skip the root 'openspec' command
    if (name && name !== 'openspec') {
      names.unshift(name);
    }
    current = current.parent;
  }

  return names.join(':') || 'openspec';
}

/**
 * True when the executing command asked for JSON output — used to suppress the
 * first-run telemetry notice so stdout stays a single valid JSON document.
 *
 * `--json` reaches commands three ways, so a single parsed option is not enough:
 * - declared on the leaf (`openspec status --json`) → `opts().json`
 * - declared on a parent group and read via globals (`openspec workset --json list`)
 *   → `optsWithGlobals().json`
 * - a residual arg on a permissive group that never declares the option
 *   (`openspec store --json`, which detects it from `command.args`) → `args`
 *
 * Suppressing is always safe: the disclosure is only deferred to the next
 * non-JSON run, never lost, whereas printing it on a JSON run corrupts stdout.
 */
export function isJsonRun(command: Command): boolean {
  return (
    command.optsWithGlobals().json === true ||
    command.args.includes('--json')
  );
}

/**
 * True for the commands that exist to serve shell completions: the user-facing
 * `openspec completion ...` group and the hidden `__complete` resolver that
 * generated completion scripts call on every Tab press. Tipping either about
 * completions is noise, and `__complete` would burn the one-shot tip invisibly.
 */
export function isCompletionRun(commandPath: string): boolean {
  return commandPath.split(':')[0] === 'completion' || commandPath === '__complete';
}

/**
 * True when the first-run completions tip must be deferred rather than shown.
 *
 * Deferring keeps the tip unconsumed, so it still reaches the user on a later
 * run that can actually carry it. All three cases are runs nobody would read a
 * hint from: JSON output, the completion machinery itself, and a stderr that is
 * not a terminal — pipes and the agent-driven runs that dominate this CLI's
 * usage would otherwise burn the user's one-shot tip into a log nobody opens.
 */
export function shouldDeferCompletionTip(command: Command, stderrIsTty: boolean): boolean {
  return isJsonRun(command) || isCompletionRun(getCommandPath(command)) || !stderrIsTty;
}

program
  .name('openspec')
  .description('AI-native system for spec-driven development')
  .version(version);

// Global options
program.option('--no-color', 'Disable color output');

// Apply global flags and telemetry before any command runs
// Note: preAction receives (thisCommand, actionCommand) where:
// - thisCommand: the command where hook was added (root program)
// - actionCommand: the command actually being executed (subcommand)
program.hook('preAction', async (thisCommand, actionCommand) => {
  const opts = thisCommand.opts();
  if (opts.color === false) {
    process.env.NO_COLOR = '1';
  }

  // Show first-run telemetry notice (if not seen). It's written to stderr, so it
  // never pollutes stdout — but --json runs still defer it (see isJsonRun) so the
  // very first invocation stays free of any incidental output on either stream.
  await maybeShowTelemetryNotice({ silent: isJsonRun(actionCommand) });

  // Track command execution (use actionCommand to get the actual subcommand)
  const commandPath = getCommandPath(actionCommand);

  await trackCommand(commandPath, version);
});

// Shutdown telemetry after command completes
program.hook('postAction', async (_thisCommand, actionCommand) => {
  // Show the first-run shell-completions tip (on stderr, so piped stdout stays
  // clean). postAction, not preAction: the tip trails the command's own output
  // instead of pushing an error message or `init`'s setup summary down the
  // screen. Deferred — not consumed — whenever nobody would read it: JSON runs,
  // `openspec completion ...`, and a stderr that is not a terminal (agents and
  // pipes would otherwise silently burn the user's one-shot tip).
  try {
    await maybeShowCompletionTip({
      silent: shouldDeferCompletionTip(actionCommand, Boolean(process.stderr.isTTY)),
    });
  } finally {
    // The flush runs even if the hint throws: parse() is synchronous, so a
    // rejection here has no catch anywhere above it.
    await shutdown();
  }
});

const availableToolIds = AI_TOOLS
  .filter((tool) => tool.skillsDir || tool.globalSkillsDir)
  .map((tool) => tool.value);
const toolAliasNote = Object.entries(TOOL_ID_ALIASES)
  .map(([retired, current]) => `${retired} (now ${current})`)
  .join(', ');
const toolsOptionDescription = `Configure AI tools non-interactively. Use "all", "none", or a comma-separated list of: ${availableToolIds.join(', ')}. Also accepted: ${toolAliasNote}`;

program
  .command('init [path]')
  .description('Initialize OpenSpec in your project')
  .option('--tools <tools>', toolsOptionDescription)
  .option('--language <language>', 'Write new OpenSpec artifacts in this language')
  .option('--force', 'Auto-cleanup legacy files without prompting')
  .option('--profile <profile>', 'Override global config profile (core or custom)')
  .option('--no-animation', 'Show a static welcome screen instead of the animated one')
  .option('--copilot-cloud', 'Set up GitHub Copilot cloud coding-agent files without prompting')
  .option('--no-copilot-cloud', 'Skip GitHub Copilot cloud coding-agent files without prompting')
  .action(async (targetPath = '.', options?: { tools?: string; language?: string; force?: boolean; profile?: string; animation?: boolean; copilotCloud?: boolean }) => {
    try {
      // Validate that the path is a valid directory
      const resolvedPath = path.resolve(targetPath);

      try {
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          throw new Error(`Path "${targetPath}" is not a directory`);
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // Directory doesn't exist, but we can create it
          console.log(`Directory "${targetPath}" doesn't exist, it will be created.`);
        } else if (error.message && error.message.includes('not a directory')) {
          throw error;
        } else {
          throw new Error(`Cannot access path "${targetPath}": ${error.message}`);
        }
      }

      const { InitCommand } = await import('../core/init.js');
      const initCommand = new InitCommand({
        tools: options?.tools,
        language: options?.language,
        force: options?.force,
        profile: options?.profile,
        animation: options?.animation,
        copilotCloud: options?.copilotCloud,
      });
      await initCommand.execute(targetPath);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Hidden alias: 'experimental' -> 'init' for backwards compatibility
program
  .command('experimental', { hidden: true })
  .description('Alias for init (deprecated)')
  .option('--tool <tool-id>', 'Target AI tool (maps to --tools)')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (options?: { tool?: string; noInteractive?: boolean }) => {
    try {
      console.log('Note: "openspec experimental" is deprecated. Use "openspec init" instead.');
      const { InitCommand } = await import('../core/init.js');
      const initCommand = new InitCommand({
        tools: options?.tool,
        interactive: options?.noInteractive === true ? false : undefined,
      });
      await initCommand.execute('.');
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

program
  .command('update [path]')
  .description('Update OpenSpec instruction files')
  .option('--force', 'Force update even when tools are up to date')
  .action(async (targetPath = '.', options?: { force?: boolean }) => {
    try {
      const installDir = getInstallDir();
      // Running from a clone: the version is whatever the branch says, so any
      // upgrade advice would be noise. Decided before the request, so a
      // contributor never waits on an answer that gets thrown away.
      const latestVersion = isSourceCheckout(installDir) ? null : await getAvailableCliUpdate();
      const announce = latestVersion !== null;
      // Offer to upgrade first: this process generates files from its own
      // templates, so upgrading afterwards would leave the old ones on disk.
      // Both streams must be a terminal — with stdout redirected the question
      // lands in the file and the user waits at a blank screen forever.
      const canOffer =
        announce &&
        shouldOfferUpgrade({
          installDir,
          projectPath: targetPath,
          interactive: isInteractive(),
          stdoutIsTty: Boolean(process.stdout.isTTY),
        });

      let declined = false;
      if (latestVersion && canOffer) {
        displayCliUpdateNote(latestVersion, targetPath, { withCommand: false });
        const outcome = await offerCliUpgrade(latestVersion);

        // Set the code and return rather than process.exit: exiting here would
        // skip commander's postAction hook, killing the telemetry flush
        // mid-request.
        if (outcome === 'cancelled') {
          // Ctrl-C means stop the command, not fall through to more prompts.
          process.exitCode = 130;
          return;
        }
        if (outcome === 'upgraded') {
          process.exitCode = await rerunUpdateWithUpgradedCli(targetPath, {
            force: options?.force,
          });
          return;
        }
        // Declined, failed, or upgraded-but-unreachable: fall through to the
        // update, then leave the command on screen underneath it.
        declined = true;
      }

      const updateCommand = new UpdateCommand({ force: options?.force });
      await updateCommand.execute(targetPath);

      if (declined) {
        // The headline was printed before the prompt; only the manual route is
        // still owed, and it belongs where the user is looking now.
        displayUpgradeCommand(targetPath);
      } else if (latestVersion) {
        displayCliUpdateNote(latestVersion, targetPath);
      }
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List items (changes by default). Use --specs to list specs.')
  .option('--specs', 'List specs instead of changes')
  .option('--changes', 'List changes explicitly (default)')
  .option('--sort <order>', 'Sort order: "recent" (default) or "name"', 'recent')
  .option('--json', 'Output as JSON (for programmatic use)')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options?: { specs?: boolean; changes?: boolean; sort?: string; json?: boolean; store?: string; storePath?: string }) => {
    try {
      const root = await resolveRootForCommand(options ?? {}, {
        json: options?.json,
        failurePayload: options?.specs ? { specs: [], root: null } : { changes: [], root: null },
        // Preserve the cwd fallback for pre-config.yaml projects. The resolver
        // still lets a registered/default store take precedence over it.
        allowImplicitRoot: existsSync(path.join(process.cwd(), 'openspec', 'project.md')),
      });
      if (!root) {
        return;
      }
      const listCommand = new ListCommand();
      const mode: 'changes' | 'specs' = options?.specs ? 'specs' : 'changes';
      const sort = options?.sort === 'name' ? 'name' : 'recent';
      await listCommand.execute(root.path, mode, {
        sort,
        json: options?.json,
        ...(options?.json ? { root: toRootOutput(root) } : {}),
      });
    } catch (error) {
      failWithError(error, {
        enabled: options?.json,
        payload: options?.specs ? { specs: [], root: null } : { changes: [], root: null },
        fallbackCode: 'list_error',
      });
      process.exit(1);
    }
  });

program
  .command('view')
  .description('Display an interactive dashboard of specs and changes')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options?: { store?: string; storePath?: string }) => {
    try {
      // Implicit cwd fallback stays enabled so `view` keeps accepting the same
      // directories as `list`/`status` — notably pre-config.yaml `openspec/`
      // dirs. ViewCommand still reports a missing openspec/ directory itself.
      const root = await resolveRootForCommand(options ?? {});
      if (!root) {
        return;
      }
      const viewCommand = new ViewCommand();
      await viewCommand.execute(root.path);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Change command with subcommands
const changeCmd = program
  .command('change')
  .description('Manage OpenSpec change proposals');

// Deprecation notice for noun-based commands
changeCmd.hook('preAction', () => {
  console.error('Warning: The "openspec change ..." commands are deprecated. Prefer verb-first commands (e.g., "openspec list", "openspec validate --changes").');
});

changeCmd
  .command('show [change-name]')
  .description('Show a change proposal in JSON or markdown format')
  .option('--json', 'Output as JSON')
  .option('--deltas-only', 'Show only deltas (JSON only)')
  .option('--requirements-only', 'Alias for --deltas-only (deprecated)')
  .option('--diff', 'Show per-requirement diffs for delta specs')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (changeName?: string, options?: { json?: boolean; requirementsOnly?: boolean; deltasOnly?: boolean; diff?: boolean; noInteractive?: boolean }) => {
    try {
      const changeCommand = new ChangeCommand();
      await changeCommand.show(changeName, options);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  });

changeCmd
  .command('list')
  .description('List all active changes (DEPRECATED: use "openspec list" instead)')
  .option('--json', 'Output as JSON')
  .option('--long', 'Show id and title with counts')
  .action(async (options?: { json?: boolean; long?: boolean }) => {
    try {
      console.error('Warning: "openspec change list" is deprecated. Use "openspec list".');
      const changeCommand = new ChangeCommand();
      await changeCommand.list(options);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  });

changeCmd
  .command('validate [change-name]')
  .description('Validate a change proposal')
  .option('--strict', 'Enable strict validation mode')
  .option('--json', 'Output validation report as JSON')
  .option('--no-interactive', 'Disable interactive prompts')
  .action(async (changeName?: string, options?: { strict?: boolean; json?: boolean; noInteractive?: boolean }) => {
    try {
      const changeCommand = new ChangeCommand();
      // validate() already sets process.exitCode, and Node honours it at
      // natural exit. Calling process.exit() here would skip commander's
      // postAction hook — the same trap called out for `update` below — which
      // kills the telemetry flush and the first-run completions tip on what is
      // a routine outcome, not an error: a change that fails validation.
      await changeCommand.validate(changeName, options);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command('archive [change-name]')
  .description('Archive a completed change and update main specs')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('--skip-specs', 'Skip spec update operations (useful for infrastructure, tooling, or doc-only changes)')
  .option('--no-validate', 'Skip validation (not recommended, requires confirmation)')
  .option('--json', 'Output as JSON (non-interactive)')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (changeName?: string, options?: ArchiveOptions) => {
    try {
      const archiveCommand = new ArchiveCommand();

      // Load plugins if configured
      const projectRoot = path.resolve('.');
      const config = readProjectConfig(projectRoot);
      let plugins;
      if (config?.plugins && config.plugins.length > 0) {
        try {
          const loaded = loadPlugins(projectRoot, config.plugins);
          const validated = validateAllPluginConfigs(loaded, config.plugin_config as Record<string, unknown> | undefined);
          if (validated.errors.length > 0) {
            for (const err of validated.errors) {
              console.warn(`Plugin config: ${err}`);
            }
          }
          plugins = validated.plugins;
        } catch (err) {
          console.warn(`Plugin loading failed: ${(err as Error).message}`);
        }
      }

      await archiveCommand.execute(changeName, { ...options, plugins, schema: config?.schema });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

registerSpecCommand(program);
registerConfigCommand(program);
registerSchemaCommand(program);
registerPluginCommand(program);
registerStoreCommand(program);
registerDoctorCommand(program);
registerContextCommand(program);
registerWorksetCommand(program);

// Top-level validate command
program
  .command('validate [item-name]')
  .description('Validate changes and specs')
  .option('--all', 'Validate all changes and specs')
  .option('--changes', 'Validate all changes')
  .option('--specs', 'Validate all specs')
  .option('--archived', 'Validate that archived changes have all tasks completed (for pre-commit linting)')
  .option('--type <type>', 'Specify item type when ambiguous: change|spec')
  .option('--strict', 'Enable strict validation mode')
  .option('--json', 'Output validation results as JSON')
  .option('--concurrency <n>', 'Max concurrent validations (defaults to env OPENSPEC_CONCURRENCY or 6)')
  .option('--no-interactive', 'Disable interactive prompts')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (itemName?: string, options?: { all?: boolean; changes?: boolean; specs?: boolean; archived?: boolean; type?: string; strict?: boolean; json?: boolean; noInteractive?: boolean; concurrency?: string; store?: string; storePath?: string }) => {
    try {
      const validateCommand = new ValidateCommand();
      await validateCommand.execute(itemName, options);
    } catch (error) {
      failWithError(error, { enabled: options?.json, fallbackCode: 'validate_error' });
      process.exit(1);
    }
  });

// Top-level show command
program
  .command('show [item-name]')
  .description('Show a change or spec')
  .option('--json', 'Output as JSON')
  .option('--type <type>', 'Specify item type when ambiguous: change|spec')
  .option('--no-interactive', 'Disable interactive prompts')
  // change-only flags
  .option('--deltas-only', 'Show only deltas (JSON only, change)')
  .option('--requirements-only', 'Alias for --deltas-only (deprecated, change)')
  .option('--diff', 'Show per-requirement diffs for delta specs (change)')
  // spec-only flags
  .option('--requirements', 'JSON only: Show only requirements (exclude scenarios)')
  .option('--no-scenarios', 'JSON only: Exclude scenario content')
  .option('-r, --requirement <id>', 'JSON only: Show specific requirement by ID (1-based)')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  // Explicit registration required: allowUnknownOption would otherwise
  // silently swallow --store-path instead of rejecting it deliberately.
  .addOption(hiddenStorePathOption())
  // allow unknown options to pass-through to underlying command implementation
  .allowUnknownOption(true)
  .action(async (itemName?: string, options?: { json?: boolean; type?: string; noInteractive?: boolean; [k: string]: any }) => {
    try {
      const showCommand = new ShowCommand();
      await showCommand.execute(itemName, options ?? {});
    } catch (error) {
      failWithError(error, { enabled: options?.json, fallbackCode: 'show_error' });
      process.exit(1);
    }
  });

// Feedback command
program
  .command('feedback <message>')
  .description('Submit feedback about OpenSpec')
  .option('--body <text>', 'Detailed description for the feedback')
  .action(async (message: string, options?: { body?: string }) => {
    try {
      const feedbackCommand = new FeedbackCommand();
      await feedbackCommand.execute(message, options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Completion command with subcommands
const completionCmd = program
  .command('completion')
  .description('Manage shell completions for OpenSpec CLI');

completionCmd
  .command('generate [shell]')
  .description('Generate completion script for a shell (outputs to stdout)')
  .action(async (shell?: string) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.generate({ shell });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

completionCmd
  .command('install [shell]')
  .description('Install completion script for a shell')
  .option('--verbose', 'Show detailed installation output')
  .action(async (shell?: string, options?: { verbose?: boolean }) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.install({ shell, verbose: options?.verbose });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

completionCmd
  .command('uninstall [shell]')
  .description('Uninstall completion script for a shell')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (shell?: string, options?: { yes?: boolean }) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.uninstall({ shell, yes: options?.yes });
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Hidden command for machine-readable completion data
program
  .command('__complete <type>', { hidden: true })
  .description('Output completion data in machine-readable format (internal use)')
  .action(async (type: string) => {
    try {
      const completionCommand = new CompletionCommand();
      await completionCommand.complete({ type });
    } catch (error) {
      // Silently fail for graceful shell completion experience
      process.exitCode = 1;
    }
  });

// ═══════════════════════════════════════════════════════════
// Workflow Commands (formerly experimental)
// ═══════════════════════════════════════════════════════════

// Status command
program
  .command('status')
  .description('Display artifact completion status for a change')
  .option('--change <id>', 'Change name to show status for')
  .option('--all', 'Show status for all active changes')
  .option('--schema <name>', 'Schema override (auto-detected from config.yaml)')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options: StatusOptions) => {
    try {
      await statusCommand(options);
    } catch (error) {
      failWithError(error, {
        enabled: options.json,
        // The batch null-shape; the single-change failure shape is
        // pre-existing contract and stays payload-free.
        payload: options.all ? BATCH_STATUS_FAILURE_PAYLOAD : undefined,
        fallbackCode: 'change_error',
      });
      process.exit(1);
    }
  });

// Instructions command
program
  .command('instructions [artifact]')
  .description('Output enriched instructions for artifacts, apply, or archive')
  .option('--change <id>', 'Change name')
  .option('--schema <name>', 'Schema override (auto-detected from config.yaml)')
  .option('--json', 'Output as JSON')
  .option('--subagents', 'Use subagent orchestration mode (mutually exclusive with --teams and --sequential)')
  .option('--teams', 'Use team orchestration mode (mutually exclusive with --subagents and --sequential)')
  .option('--sequential', 'Use sequential orchestration mode (mutually exclusive with --teams and --subagents)')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (artifactId: string | undefined, options: InstructionsOptions & { subagents?: boolean; teams?: boolean; sequential?: boolean }) => {

    try {
      // Validate mutually exclusive flags
      const modeFlags = [options.subagents, options.teams, options.sequential].filter(Boolean).length;
      if (modeFlags > 1) {
        throw new Error('--subagents, --teams, and --sequential are mutually exclusive. Use only one.');
      }

      // Workflow instruction surfaces are reserved command branches, not artifacts.
      if (artifactId === 'apply') {
        const orchestrationMode = options.subagents ? 'subagents' as const
          : options.teams ? 'teams' as const
          : options.sequential ? 'sequential' as const
          : undefined;
        await applyInstructionsCommand({ ...options, orchestrationMode });
      } else if (artifactId === 'archive') {
        await archiveInstructionsCommand(options);
      } else {
        await instructionsCommand(artifactId, options);
      }
    } catch (error) {
      failWithError(error, { enabled: options.json, fallbackCode: 'change_error' });
      process.exit(1);
    }
  });

// Templates command
program
  .command('templates')
  .description('Show resolved template paths for all artifacts in a schema')
  .option('--schema <name>', `Schema to use (default: ${DEFAULT_SCHEMA})`)
  .option('--json', 'Output as JSON mapping artifact IDs to template paths')
  .action(async (options: TemplatesOptions) => {
    try {
      await templatesCommand(options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Schemas command
program
  .command('schemas')
  .description('List available workflow schemas with descriptions')
  .option('--json', 'Output as JSON (for agent use)')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  .action(async (options: SchemasOptions) => {
    try {
      await schemasCommand(options);
    } catch (error) {
      failWithError(error, {
        enabled: options.json,
        payload: { schemas: [], root: null },
        fallbackCode: 'schemas_error',
      });
      process.exit(1);
    }
  });

// New command group with change subcommand
const newCmd = program.command('new').description('Create new items');

newCmd
  .command('change <name>')
  .description('Create a new change directory')
  .option('--description <text>', 'Description to add to README.md')
  .option('--goal <text>', 'Optional goal metadata to store with the change')
  .option('--schema <name>', `Workflow schema to use (default: ${DEFAULT_SCHEMA})`)
  .option('--class <class>', 'Change class for gate profile routing: feature, single-cap, infra, hotfix (default: feature)')
  .option('--json', 'Output as JSON')
  .option('--store <id>', STORE_OPTION_DESCRIPTION)
  .addOption(hiddenStorePathOption())
  // Removed options kept registered (hidden) so users get a deliberate
  // explanation instead of a generic unknown-option error.
  .addOption(new Option('--initiative <id>', 'No longer supported').hideHelp())
  .addOption(new Option('--areas <names>', 'No longer supported').hideHelp())
  .action(async (name: string, options: NewChangeOptions) => {
    try {
      await newChangeCommand(name, options);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Gate command group
const gateCmd = program.command('gate').description('Quality gate operations');

gateCmd
  .command('check')
  .description('Run quality gate checks for a change')
  .option('--change <name>', 'Change name')
  .option('--phase <phase>', 'Gate phase: pre or post')
  .option('--json', 'Output as JSON')
  .action(async (options: { change?: string; phase?: string; json?: boolean }) => {
    try {
      const gateCommand = new GateCommand();
      await gateCommand.execute(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

gateCmd
  .command('resolve')
  .description('Resolve a pending gate with PASS or FAIL result')
  .option('--change <name>', 'Change name')
  .option('--id <gate-id>', 'Gate ID to resolve')
  .option('--result <result>', 'PASS or FAIL')
  .option('--details <json>', 'Optional JSON details')
  .action(async (options: { change?: string; id?: string; result?: string; details?: string }) => {
    try {
      const gateCommand = new GateCommand();
      await gateCommand.resolveGate(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// HTML viewer command
program
  .command('html <change-name>')
  .description('Render a change\'s artifacts to a self-contained spec-viewer.html')
  .option('--open', 'Open the generated file with the platform default opener')
  .option('--out <path>', 'Write the HTML to this path instead of the change directory')
  .option(
    '--artifact-body',
    'Emit a wrapper-free HTML fragment for publishing as an Artifact (mutually exclusive with --open)'
  )
  .action(async (changeName: string, options?: { open?: boolean; out?: string; artifactBody?: boolean }) => {
    try {
      const htmlCommand = new HtmlCommand();
      const outPath = await htmlCommand.execute(changeName, options ?? {});
      console.log(outPath);
    } catch (error) {
      failWithError(error);
      process.exit(1);
    }
  });

// Run command group
const runCmd = program.command('run').description('Pipeline runner for phase execution');

runCmd
  .command('start')
  .description('Start a pipeline phase: execute pre-hooks and pre-gates')
  .option('--change <name>', 'Change name')
  .option('--phase <phase>', 'Phase: propose, apply, verify, or archive')
  .option('--session <id>', 'Session ID (auto-generated if not provided)')
  .option('--json', 'Output as JSON')
  .action(async (options: { change?: string; phase?: string; session?: string; json?: boolean }) => {
    try {
      const runCommand = new RunCommand();
      await runCommand.startAction(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

runCmd
  .command('complete')
  .description('Complete a pipeline phase: execute post-gates and post-hooks')
  .option('--change <name>', 'Change name')
  .option('--phase <phase>', 'Phase: propose, apply, verify, or archive')
  .option('--gate-profile <profile>', 'Override gate profile: feature, single-cap, infra, hotfix')
  .option('--json', 'Output as JSON')
  .action(async (options: { change?: string; phase?: string; gateProfile?: string; json?: boolean }) => {
    try {
      const runCommand = new RunCommand();
      await runCommand.completeAction(options);
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// Waiver command group
const waiverCmd = program.command('waiver').description('Manage gate waivers');

waiverCmd
  .command('list')
  .description('List all active waivers across changes')
  .option('--json', 'Output as JSON')
  .option('--all', 'Include expired waivers')
  .action(async (options: { json?: boolean; all?: boolean }) => {
    try {
      const { listWaivers } = await import('../core/waiver.js');
      const { getChangesDir } = await import('../utils/change-utils.js');
      const changesDir = getChangesDir(process.cwd());
      const waivers = listWaivers(changesDir);
      const filtered = options.all ? waivers : waivers.filter((w) => !w.expired);

      if (options.json) {
        console.log(JSON.stringify(filtered, null, 2));
      } else {
        if (filtered.length === 0) {
          console.log('No active waivers found.');
        } else {
          console.log('Active waivers:\n');
          for (const entry of filtered) {
            const status = entry.expired ? ' [EXPIRED]' : '';
            console.log(`  ${entry.changeName}${status}`);
            console.log(`    Reason:   ${entry.waiver.reason}`);
            console.log(`    Approver: ${entry.waiver.approver}`);
            console.log(`    Expiry:   ${entry.waiver.expiry}`);
            console.log(`    Ticket:   ${entry.waiver.ticket}`);
            console.log();
          }
        }
      }
    } catch (error) {
      console.log();
      ora().fail(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

export { program };

export function runCli(argv = process.argv): void {
  program.parse(argv);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
