/**
 * Plugin overlays, applied the same way at every generation entry point.
 *
 * `init`, `update` (its main loop and the legacy-upgrade path) and the
 * commands-only "is this tool up to date?" check all render skills and
 * commands through this module, so what detection compares against is exactly
 * what `update` writes: superseded base sections dropped, the rest of the base
 * without section markers, then every active overlay appended.
 */

import chalk from 'chalk';

import type { CommandContent } from '../command-generation/index.js';
import { getLoadedPlugins } from '../plugin/context.js';
import { getPluginOverlayEntries } from '../plugin/loader.js';
import type { LoadedPlugin } from '../plugin/types.js';
import {
  composeTransformers,
  generateSkillContent,
  getCommandContents,
  getCommandTemplates,
  getSkillTemplates,
} from './skill-generation.js';
import { stripSections } from './template-sections.js';
import type { SkillTemplate } from '../templates/skill-templates.js';

/**
 * Overlays active for one project, per workflow ID.
 */
export interface WorkflowOverlays {
  /** Overlay contents to append, in plugin whitelist order. */
  contentsFor(workflowId: string): readonly string[];
  /** Base sections the overlays replace (union across plugins). */
  supersedesFor(workflowId: string): readonly string[];
}

/** No active plugins: the base templates render as-is (markers removed). */
export const NO_OVERLAYS: WorkflowOverlays = {
  contentsFor: () => [],
  supersedesFor: () => [],
};

/**
 * Collects every workflow's overlays once and validates `supersedes` against
 * the base templates (skill and command) of that workflow.
 *
 * Fails closed: an unknown section name, or `supersedes` on a workflow with no
 * base template, throws with the offending names instead of being skipped.
 */
export function resolveWorkflowOverlays(plugins: readonly LoadedPlugin[]): WorkflowOverlays {
  const workflowIds = new Set<string>();
  for (const plugin of plugins) {
    for (const workflowId of Object.keys(plugin.manifest.skill_overlays ?? {})) {
      workflowIds.add(workflowId);
    }
  }
  if (workflowIds.size === 0) return NO_OVERLAYS;

  const byWorkflow = new Map<string, { contents: string[]; supersedes: string[] }>();
  for (const workflowId of workflowIds) {
    const entries = getPluginOverlayEntries([...plugins], workflowId);
    if (entries.length === 0) continue;
    const supersedes = [...new Set(entries.flatMap((entry) => entry.supersedes))];
    byWorkflow.set(workflowId, { contents: entries.map((entry) => entry.content), supersedes });

    if (supersedes.length === 0) continue;
    const skills = getSkillTemplates([workflowId]);
    const commands = getCommandTemplates([workflowId]);
    if (skills.length === 0 && commands.length === 0) {
      throw new Error(
        `Overlay for unknown workflow "${workflowId}" supersedes section(s): ${supersedes.join(', ')}.`
      );
    }
    for (const { template } of skills) {
      stripSections(template.instructions, supersedes, `${workflowId} skill`);
    }
    for (const { template } of commands) {
      stripSections(template.content, supersedes, `${workflowId} command`);
    }
  }

  return {
    contentsFor: (workflowId) => byWorkflow.get(workflowId)?.contents ?? [],
    supersedesFor: (workflowId) => byWorkflow.get(workflowId)?.supersedes ?? [],
  };
}

/**
 * Loads the project's enabled plugins and resolves their overlays.
 *
 * A project with no `openspec/config.yaml` (a fresh `init`) or no `plugins:`
 * list has no overlays; that is not an error. A plugin that fails to load is
 * warned about and skipped, matching how hooks and gates treat it. An invalid
 * `supersedes` is NOT softened: it throws, so generation stops before writing.
 */
export function loadProjectOverlays(projectRoot: string): WorkflowOverlays {
  let plugins: LoadedPlugin[] = [];
  try {
    plugins = getLoadedPlugins(projectRoot);
  } catch (err) {
    console.warn(
      chalk.yellow(
        `Plugin loading failed, continuing without overlays: ${err instanceof Error ? err.message : String(err)}`
      )
    );
  }
  return resolveWorkflowOverlays(plugins);
}

/**
 * Command contents for the given workflows with overlays applied.
 */
export function getOverlaidCommandContents(
  workflows: readonly string[] | undefined,
  overlays: WorkflowOverlays
): CommandContent[] {
  const contents = getCommandContents(workflows, (id) => overlays.supersedesFor(id));
  for (const content of contents) {
    const appended = overlays.contentsFor(content.id);
    if (appended.length > 0) {
      content.body = content.body + '\n\n' + appended.join('\n\n');
    }
  }
  return contents;
}

/**
 * SKILL.md content for one workflow with overlays applied. The overlay append
 * runs before the per-tool transformer, so tool-specific command references
 * are rewritten inside overlay text too.
 */
export function generateOverlaidSkillContent(
  template: SkillTemplate,
  workflowId: string,
  generatedByVersion: string,
  overlays: WorkflowOverlays,
  toolTransformer?: (instructions: string) => string
): string {
  const appended = overlays.contentsFor(workflowId);
  const overlayTransformer = appended.length > 0
    ? (instructions: string) => instructions + '\n\n' + appended.join('\n\n')
    : undefined;
  return generateSkillContent(
    template,
    generatedByVersion,
    composeTransformers(overlayTransformer, toolTransformer),
    { supersedes: overlays.supersedesFor(workflowId) }
  );
}
