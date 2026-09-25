/**
 * Tool Detection Utilities
 *
 * Shared utilities for detecting tool configurations and version status.
 */

import path from 'path';
import * as fs from 'fs';
import { AI_TOOLS, OPENSPEC_SKILL_NAMES } from '../config.js';
import { CommandAdapterRegistry, generateCommands } from '../command-generation/index.js';
import {
  loadProjectOverlays,
  getOverlaidCommandContents,
  type WorkflowOverlays,
} from './overlay-generation.js';
import { getGlobalConfig } from '../global-config.js';
import { getProfileWorkflows, ALL_WORKFLOWS } from '../profiles.js';
import {
  isSharedSkillTargetActive,
  hasLegacySkills,
  readSharedSkillTarget,
  reconcileSharedSkillTargets,
} from '../shared-skill-target.js';
import {
  shouldGenerateCommandsForTool,
  shouldGenerateSkillsForTool,
  resolveCommandSurfaceCapability,
} from '../command-surface.js';
import {
  getSkillCapableTools,
  hasGlobalSkillTarget,
  resolveToolSkillsDir,
  toolSupportsSkills,
} from './skill-paths.js';

/**
 * Names of skill directories created by openspec init.
 */
export const SKILL_NAMES = OPENSPEC_SKILL_NAMES;

export type SkillName = (typeof SKILL_NAMES)[number];

/**
 * IDs of command templates created by openspec init.
 */
export const COMMAND_IDS = [
  'explore',
  'new',
  'continue',
  'apply',
  'update',
  'ff',
  'sync',
  'archive',
  'bulk-archive',
  'verify',
  'onboard',
  'propose',
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

/**
 * Status of skill configuration for a tool.
 */
export interface ToolSkillStatus {
  /** Whether the tool has any skills configured */
  configured: boolean;
  /** Whether all skills are configured */
  fullyConfigured: boolean;
  /** Number of skills currently configured */
  skillCount: number;
}

/**
 * Version information for a tool's skills.
 */
export interface ToolVersionStatus {
  /** The tool ID */
  toolId: string;
  /** The tool's display name */
  toolName: string;
  /** Whether the tool has any skills or commands configured */
  configured: boolean;
  /**
   * The generatedBy version recorded in the tool's skill files. For a tool that
   * has commands but no skills, the current version when the command files match
   * what would be generated now. Null when neither says the files are current.
   */
  generatedByVersion: string | null;
  /**
   * Whether the tool's skills were rendered with different plugin overlays
   * than the project now has (overlay content or supersedes changed, a plugin
   * added or removed, or overlays that no longer resolve).
   */
  overlaysChanged: boolean;
  /** Whether the tool needs updating (version mismatch, missing, or overlays changed) */
  needsUpdate: boolean;
}

/**
 * Options shared by the up-to-date checks.
 */
export interface ToolStatusOptions {
  workflows?: readonly string[];
  /**
   * The project's resolved overlays, when the caller already has them (update
   * passes the ones it will render with). Resolved once per call otherwise.
   */
  overlays?: WorkflowOverlays;
}

/**
 * The project's overlays for an up-to-date check, or null when they cannot be
 * resolved (unloadable plugin, invalid overlay): then nothing is current and
 * `update` reports the error.
 */
function overlaysForDetection(projectRoot: string, options?: ToolStatusOptions): WorkflowOverlays | null {
  if (options?.overlays) return options.overlays;
  try {
    return loadProjectOverlays(projectRoot);
  } catch {
    return null;
  }
}

/**
 * Gets the list of tools with skillsDir configured.
 */
export function getToolsWithSkillsDir(): string[] {
  return getSkillCapableTools().map((tool) => tool.value);
}

/**
 * Checks which skill files exist for a tool.
 */
export function getToolSkillStatus(projectRoot: string, toolId: string): ToolSkillStatus {
  const tool = AI_TOOLS.find((t) => t.value === toolId);
  if (!tool || !toolSupportsSkills(tool)) {
    return { configured: false, fullyConfigured: false, skillCount: 0 };
  }
  if (tool.skillsDir && !isSharedSkillTargetActive(projectRoot, toolId)) {
    return { configured: false, fullyConfigured: false, skillCount: 0 };
  }

  const skillsDirs = [
    resolveToolSkillsDir(projectRoot, tool),
    ...(tool.legacySkillsDirs ?? []).map((root) =>
      path.join(projectRoot, root, 'skills')
    ),
  ];
  let skillCount = 0;

  for (const skillName of SKILL_NAMES) {
    if (skillsDirs.some((skillsDir) =>
      fs.existsSync(path.join(skillsDir, skillName, 'SKILL.md'))
    )) {
      skillCount++;
    }
  }

  return {
    configured: skillCount > 0,
    fullyConfigured: skillCount === SKILL_NAMES.length,
    skillCount,
  };
}

/**
 * Checks whether a tool has at least one generated OpenSpec command file.
 */
export function toolHasAnyConfiguredCommand(projectPath: string, toolId: string): boolean {
  const adapter = CommandAdapterRegistry.get(toolId);
  if (!adapter) return false;

  for (const commandId of COMMAND_IDS) {
    const cmdPath = adapter.getFilePath(commandId);
    const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectPath, cmdPath);
    if (fs.existsSync(fullPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Normalizes checkout artifacts that are not real content drift: a UTF-8 BOM and
 * CRLF line endings, which a Windows clone with `core.autocrlf` reintroduces on
 * every checkout of committed command files.
 */
function normalizeCommandContent(content: string): string {
  return content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

/**
 * Checks whether command files for a tool on disk match current generated command contents.
 *
 * Command files carry no version stamp, so content equality is the only available
 * "is this current?" signal for a commands-only install.
 */
export function areCommandFilesUpToDate(
  projectRoot: string,
  toolId: string,
  options?: ToolStatusOptions
): boolean {
  const adapter = CommandAdapterRegistry.get(toolId);
  if (!adapter) return false;

  let workflows: readonly string[];
  if (options?.workflows) {
    workflows = options.workflows;
  } else {
    try {
      const globalCfg = getGlobalConfig();
      const profile = globalCfg.profile ?? 'core';
      workflows = getProfileWorkflows(profile, globalCfg.workflows);
    } catch {
      workflows = ALL_WORKFLOWS;
    }
  }

  const knownWorkflows = workflows.filter((w): w is (typeof ALL_WORKFLOWS)[number] =>
    (ALL_WORKFLOWS as readonly string[]).includes(w)
  );

  // Compare against exactly what `update` writes, plugin overlays included;
  // otherwise every overlay-bearing project reads as stale on each run. An
  // overlay that cannot be resolved means the files are not current: report
  // stale and let `update` surface the error.
  const overlays = overlaysForDetection(projectRoot, options);
  if (!overlays) return false;
  const commandContents = getOverlaidCommandContents(knownWorkflows, overlays);
  const generatedCommands = generateCommands(commandContents, adapter);

  if (generatedCommands.length === 0) {
    return false;
  }

  for (const cmd of generatedCommands) {
    const cmdPath = path.isAbsolute(cmd.path) ? cmd.path : path.join(projectRoot, cmd.path);
    if (!fs.existsSync(cmdPath)) {
      return false;
    }
    try {
      const existingContent = fs.readFileSync(cmdPath, 'utf-8');
      if (normalizeCommandContent(existingContent) !== normalizeCommandContent(cmd.fileContent)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  // Also check no extra command files exist for deselected workflows
  const desiredWorkflowSet = new Set(knownWorkflows);
  for (const workflow of ALL_WORKFLOWS) {
    if (desiredWorkflowSet.has(workflow)) continue;
    const cmdPath = adapter.getFilePath(workflow);
    const fullPath = path.isAbsolute(cmdPath) ? cmdPath : path.join(projectRoot, cmdPath);
    if (fs.existsSync(fullPath)) {
      return false;
    }
  }

  return true;
}

/**
 * Gets the skill status for all tools with skillsDir configured.
 */
export function getToolStates(projectRoot: string): Map<string, ToolSkillStatus> {
  const states = new Map<string, ToolSkillStatus>();
  const tools = getSkillCapableTools();

  for (const tool of tools) {
    const skillStatus = getToolSkillStatus(projectRoot, tool.value);
    const markerConfigured =
      Boolean(tool.skillsDir) &&
      readSharedSkillTarget(projectRoot, tool.skillsDir!) === tool.value;
    states.set(
      tool.value,
      markerConfigured
        ? { ...skillStatus, configured: true }
        : skillStatus
    );
  }

  const configuredTools = tools.filter(
    (tool) => tool.skillsDir && states.get(tool.value)?.configured
  );
  const activeSharedTargets = new Set(
    reconcileSharedSkillTargets(projectRoot, configuredTools).map((tool) => tool.value)
  );
  for (const tool of configuredTools) {
    if (!activeSharedTargets.has(tool.value)) {
      states.set(tool.value, { configured: false, fullyConfigured: false, skillCount: 0 });
    }
  }

  return states;
}

/**
 * Extracts the generatedBy version from a skill file's YAML frontmatter.
 * Returns null if the field is not found or the file doesn't exist.
 */
/**
 * Reads the plugin-overlay fingerprint (`metadata.overlays`) from a skill
 * file's frontmatter; '' when absent (rendered without overlays).
 */
export function extractOverlayFingerprint(skillFilePath: string): string {
  try {
    const content = fs.readFileSync(skillFilePath, 'utf-8');
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content.replace(/\r\n/g, '\n'))?.[1] ?? '';
    return /^\s*overlays:\s*["']?([0-9a-f]+)["']?\s*$/m.exec(frontmatter)?.[1] ?? '';
  } catch {
    return '';
  }
}

export function extractGeneratedByVersion(skillFilePath: string): string | null {
  try {
    if (!fs.existsSync(skillFilePath)) {
      return null;
    }

    const content = fs.readFileSync(skillFilePath, 'utf-8');

    // Look for generatedBy in the YAML frontmatter
    // The file format is:
    // ---
    // ...
    // metadata:
    //   author: openspec
    //   version: "1.0"
    //   generatedBy: "0.23.0"
    // ---
    const generatedByMatch = content.match(/^\s*generatedBy:\s*["']?([^"'\n]+)["']?\s*$/m);

    if (generatedByMatch && generatedByMatch[1]) {
      return generatedByMatch[1].trim();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Gets version status for a tool by reading its skill files, falling back to a
 * command-content fingerprint for installs that have commands but no skills.
 */
export function getToolVersionStatus(
  projectRoot: string,
  toolId: string,
  currentVersion: string,
  options?: ToolStatusOptions
): ToolVersionStatus {
  const tool = AI_TOOLS.find((t) => t.value === toolId);
  if (!tool || !toolSupportsSkills(tool)) {
    return {
      toolId,
      toolName: toolId,
      configured: false,
      generatedByVersion: null,
      overlaysChanged: false,
      needsUpdate: false,
    };
  }

  const skillsDirs = [
    resolveToolSkillsDir(projectRoot, tool),
    ...(tool.legacySkillsDirs ?? []).map((root) =>
      path.join(projectRoot, root, 'skills')
    ),
  ];
  let generatedByVersion: string | null = null;
  let foundSkillFile: string | null = null;

  // 1. Find the first skill file that exists and read its version
  for (const skillName of SKILL_NAMES) {
    for (const skillsDir of skillsDirs) {
      const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        generatedByVersion = extractGeneratedByVersion(skillFile);
        foundSkillFile = skillFile;
        break;
      }
    }
    if (foundSkillFile) break;
  }

  const skillConfigured = getToolSkillStatus(projectRoot, toolId).configured;
  const commandConfigured = toolHasAnyConfiguredCommand(projectRoot, toolId);
  const markerConfigured =
    Boolean(tool.skillsDir) &&
    readSharedSkillTarget(projectRoot, tool.skillsDir!) === toolId;
  const configured = skillConfigured || commandConfigured || markerConfigured;

  // Resolved at most once per call, and only when something is checked
  // against it; update passes the overlays it renders with.
  let overlays: WorkflowOverlays | null | undefined;
  const projectOverlays = () => {
    if (overlays === undefined) overlays = overlaysForDetection(projectRoot, options);
    return overlays;
  };

  // 2. Commands-only installs have no skill file to read a version from, so fall
  //    back to comparing the generated command content. Deliberately skipped when
  //    skill files exist: an unreadable version there must still force a rewrite.
  if (!skillConfigured && commandConfigured) {
    const current = projectOverlays();
    if (current && areCommandFilesUpToDate(projectRoot, toolId, { ...options, overlays: current })) {
      generatedByVersion = currentVersion;
    }
  }

  // 3. A skill records the overlay fingerprint it was rendered with; the
  //    version alone cannot tell that a plugin's overlay changed since.
  //    Skipped for a global skill target (e.g. ~/.minimax/skills): it is shared
  //    by every project, so comparing it with this project's overlays would
  //    make projects with different plugins re-render it for each other on
  //    every update. Those fall back to the version check alone.
  let overlaysChanged = false;
  if (skillConfigured && foundSkillFile && !hasGlobalSkillTarget(tool)) {
    const current = projectOverlays();
    overlaysChanged = current === null || extractOverlayFingerprint(foundSkillFile) !== current.fingerprint;
  }
  if (!skillConfigured && !commandConfigured && markerConfigured) {
    const delivery = getGlobalConfig().delivery ?? 'both';
    if (
      !shouldGenerateSkillsForTool(toolId, delivery) &&
      !shouldGenerateCommandsForTool(toolId, delivery)
    ) {
      generatedByVersion = currentVersion;
    }
  }

  const needsUpdate = configured && (
    generatedByVersion === null || generatedByVersion !== currentVersion || overlaysChanged
  );

  return {
    toolId,
    toolName: tool.name,
    configured,
    generatedByVersion,
    overlaysChanged,
    needsUpdate,
  };
}

/**
 * Gets all configured tools in the project (configured via skills or commands).
 */
export function getConfiguredTools(projectRoot: string): string[] {
  const configured = AI_TOOLS
    .filter((t) => {
      if (!toolSupportsSkills(t)) return false;
      return (
        getToolSkillStatus(projectRoot, t.value).configured ||
        toolHasAnyConfiguredCommand(projectRoot, t.value) ||
        (
          resolveCommandSurfaceCapability(t.value) === 'adapter-backed' &&
          hasLegacySkills(projectRoot, t)
        ) ||
        (Boolean(t.skillsDir) &&
          readSharedSkillTarget(projectRoot, t.skillsDir!) === t.value)
      );
    });
  const activeProjectTools = new Set(
    reconcileSharedSkillTargets(
      projectRoot,
      configured.filter((tool) => tool.skillsDir)
    ).map((tool) => tool.value)
  );
  return configured
    .filter(
      (tool) =>
        tool.globalSkillsDir ||
        toolHasAnyConfiguredCommand(projectRoot, tool.value) ||
        (
          resolveCommandSurfaceCapability(tool.value) === 'adapter-backed' &&
          hasLegacySkills(projectRoot, tool)
        ) ||
        activeProjectTools.has(tool.value)
    )
    .map((tool) => tool.value);
}

/**
 * Gets version status for all configured tools.
 */
export function getAllToolVersionStatus(
  projectRoot: string,
  currentVersion: string
): ToolVersionStatus[] {
  const configuredTools = getConfiguredTools(projectRoot);
  return configuredTools.map((toolId) =>
    getToolVersionStatus(projectRoot, toolId, currentVersion)
  );
}
