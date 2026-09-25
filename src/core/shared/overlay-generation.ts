/**
 * Plugin overlays, applied the same way at every generation entry point.
 *
 * `init`, `update` (its main loop and the legacy-upgrade path) and the
 * commands-only "is this tool up to date?" check all render skills and
 * commands through this module, so what detection compares against is exactly
 * what `update` writes: superseded base sections dropped, the rest of the base
 * without section markers, then every active overlay appended.
 */

import { createHash } from 'node:crypto';

import type { CommandContent } from '../command-generation/index.js';
import { getLoadedPlugins } from '../plugin/context.js';
import { getPluginOverlayEntries, type PluginOverlayEntry } from '../plugin/loader.js';
import type { LoadedPlugin } from '../plugin/types.js';
import {
  composeTransformers,
  generateSkillContent,
  getCommandContents,
  getCommandTemplates,
  getSkillTemplates,
} from './skill-generation.js';
import { hasSectionMarkers, stripSections } from './template-sections.js';
import type { SkillTemplate } from '../templates/skill-templates.js';

/**
 * Overlays active for one project, per workflow ID.
 */
export interface WorkflowOverlays {
  /** Overlay contents to append, in plugin whitelist order. */
  contentsFor(workflowId: string): readonly string[];
  /** Base sections the overlays replace (union across plugins). */
  supersedesFor(workflowId: string): readonly string[];
  /**
   * Short hash of every workflow's overlay contents and supersedes; empty when
   * there are none. Stamped into generated skills so a changed overlay makes a
   * skill-bearing tool stale even when the OpenSpec version did not move.
   */
  fingerprint: string;
}

/** No active plugins: the base templates render as-is (markers removed). */
export const NO_OVERLAYS: WorkflowOverlays = {
  contentsFor: () => [],
  supersedesFor: () => [],
  fingerprint: '',
};

/** Label naming a template in section errors; the same at every call site. */
export function sectionLabel(workflowId: string, surface: 'skill' | 'command'): string {
  return `${workflowId} ${surface}`;
}

function describeEntry(entry: PluginOverlayEntry, workflowId: string): string {
  return `plugin '${entry.pluginName}' overlay for '${workflowId}' (${entry.path})`;
}

/**
 * Validates `supersedes` names against the workflow's skill and command base
 * templates; throws naming the unknown ones.
 */
function assertSectionsExist(workflowId: string, names: readonly string[], owner: string): void {
  if (names.length === 0) return;
  const skills = getSkillTemplates([workflowId]);
  const commands = getCommandTemplates([workflowId]);
  try {
    if (skills.length === 0 && commands.length === 0) {
      throw new Error(`workflow "${workflowId}" has no base template; cannot supersede ${names.join(', ')}`);
    }
    for (const { template } of skills) {
      stripSections(template.instructions, names, sectionLabel(workflowId, 'skill'));
    }
    for (const { template } of commands) {
      stripSections(template.content, names, sectionLabel(workflowId, 'command'));
    }
  } catch (err) {
    throw new Error(`${owner}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Collects every workflow's overlays once and validates them. Fails closed,
 * naming the plugin, workflow and file, when:
 * - `supersedes` names a section the workflow's base templates do not define
 *   (checked even when the append file is missing);
 * - an overlay declares `supersedes` but its append file is missing or empty,
 *   which would drop base sections with nothing in their place;
 * - overlay content carries section markers, which would leak into output.
 *
 * An empty or missing overlay that supersedes nothing is skipped with a
 * warning. Conflicts between plugins are warned about, naming the plugins:
 * two plugins superseding the same section, and a plugin appending to a
 * workflow whose sections another plugin removed.
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
  for (const workflowId of [...workflowIds].sort()) {
    const active: PluginOverlayEntry[] = [];

    for (const entry of getPluginOverlayEntries(plugins, workflowId)) {
      const owner = describeEntry(entry, workflowId);
      assertSectionsExist(workflowId, entry.supersedes, owner);

      const empty = entry.content === null || entry.content.trim() === '';
      if (empty) {
        if (entry.supersedes.length > 0) {
          throw new Error(
            `${owner} supersedes ${entry.supersedes.join(', ')} but its append file is missing or empty; ` +
              'dropping those base sections would leave nothing in their place.'
          );
        }
        if (entry.content !== null) {
          console.warn(`[plugin:${entry.pluginName}] Overlay file is empty, skipping: ${entry.path}`);
        }
        continue;
      }
      if (hasSectionMarkers(entry.content!)) {
        throw new Error(
          `${owner} contains <!-- opsx:section --> markers; overlays cannot define sections ` +
            '(mention the syntax in inline code or a code fence instead).'
        );
      }
      active.push(entry);
    }
    if (active.length === 0) continue;

    const removedBy = new Map<string, string[]>();
    for (const entry of active) {
      for (const name of entry.supersedes) {
        removedBy.set(name, [...(removedBy.get(name) ?? []), entry.pluginName]);
      }
    }
    for (const [section, owners] of removedBy) {
      if (owners.length > 1) {
        console.warn(
          `Overlay conflict: section '${section}' of workflow '${workflowId}' is superseded by several plugins: ${owners.join(', ')}. ` +
            'Each appends its own replacement.'
        );
      }
    }
    if (removedBy.size > 0) {
      const removals = [...removedBy].map(([section, owners]) => `${section} (by ${owners.join(', ')})`).join(', ');
      for (const entry of active.filter((candidate) => candidate.supersedes.length === 0)) {
        console.warn(
          `Overlay conflict: plugin '${entry.pluginName}' appends to workflow '${workflowId}', whose base section(s) ${removals} were removed; ` +
            'its overlay must not rely on them.'
        );
      }
    }

    byWorkflow.set(workflowId, {
      contents: active.map((entry) => entry.content!),
      supersedes: [...removedBy.keys()],
    });
  }

  if (byWorkflow.size === 0) return NO_OVERLAYS;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([...byWorkflow].map(([id, overlay]) => [id, overlay.contents, overlay.supersedes])))
    .digest('hex')
    .slice(0, 16);

  return {
    contentsFor: (workflowId) => byWorkflow.get(workflowId)?.contents ?? [],
    supersedesFor: (workflowId) => byWorkflow.get(workflowId)?.supersedes ?? [],
    fingerprint,
  };
}

/**
 * Loads the project's whitelisted plugins and resolves their overlays.
 *
 * A project with no `openspec/config.yaml` (a fresh `init`) or no `plugins:`
 * list has no overlays; that is not an error. Everything else fails closed:
 * a whitelisted plugin that cannot be loaded or validated, and any invalid
 * overlay, throws, so generation stops before writing.
 */
export function loadProjectOverlays(projectRoot: string): WorkflowOverlays {
  return resolveWorkflowOverlays(getLoadedPlugins(projectRoot, { strict: true }));
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
    {
      supersedes: overlays.supersedesFor(workflowId),
      label: sectionLabel(workflowId, 'skill'),
      overlayFingerprint: overlays.fingerprint,
    }
  );
}
