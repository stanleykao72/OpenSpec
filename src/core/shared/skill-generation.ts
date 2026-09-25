/**
 * Skill Generation Utilities
 *
 * Shared utilities for generating skill and command files.
 */

import {
  getExploreSkillTemplate,
  getNewChangeSkillTemplate,
  getContinueChangeSkillTemplate,
  getApplyChangeSkillTemplate,
  getUpdateChangeSkillTemplate,
  getFfChangeSkillTemplate,
  getSyncSpecsSkillTemplate,
  getArchiveChangeSkillTemplate,
  getBulkArchiveChangeSkillTemplate,
  getVerifyChangeSkillTemplate,
  getOnboardSkillTemplate,
  getOpsxProposeSkillTemplate,
  getOpsxExploreCommandTemplate,
  getOpsxNewCommandTemplate,
  getOpsxContinueCommandTemplate,
  getOpsxApplyCommandTemplate,
  getOpsxUpdateCommandTemplate,
  getOpsxFfCommandTemplate,
  getOpsxSyncCommandTemplate,
  getOpsxArchiveCommandTemplate,
  getOpsxBulkArchiveCommandTemplate,
  getOpsxVerifyCommandTemplate,
  getOpsxOnboardCommandTemplate,
  getOpsxProposeCommandTemplate,
  type SkillTemplate,
} from '../templates/skill-templates.js';
import type { CommandContent } from '../command-generation/index.js';
import { OPENSPEC_CLI_ALLOWED_TOOLS } from './allowed-tools.js';
import { stripSections } from './template-sections.js';

/**
 * Skill template with directory name and workflow ID mapping.
 */
export interface SkillTemplateEntry {
  template: SkillTemplate;
  dirName: string;
  workflowId: string;
}

/**
 * Command template with ID mapping.
 */
export interface CommandTemplateEntry {
  template: ReturnType<typeof getOpsxExploreCommandTemplate>;
  id: string;
}

/**
 * Gets skill templates with their directory names, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose workflowId is in this array
 */
export function getSkillTemplates(workflowFilter?: readonly string[]): SkillTemplateEntry[] {
  const all: SkillTemplateEntry[] = [
    { template: getExploreSkillTemplate(), dirName: 'openspec-explore', workflowId: 'explore' },
    { template: getNewChangeSkillTemplate(), dirName: 'openspec-new-change', workflowId: 'new' },
    { template: getContinueChangeSkillTemplate(), dirName: 'openspec-continue-change', workflowId: 'continue' },
    { template: getApplyChangeSkillTemplate(), dirName: 'openspec-apply-change', workflowId: 'apply' },
    { template: getUpdateChangeSkillTemplate(), dirName: 'openspec-update-change', workflowId: 'update' },
    { template: getFfChangeSkillTemplate(), dirName: 'openspec-ff-change', workflowId: 'ff' },
    { template: getSyncSpecsSkillTemplate(), dirName: 'openspec-sync-specs', workflowId: 'sync' },
    { template: getArchiveChangeSkillTemplate(), dirName: 'openspec-archive-change', workflowId: 'archive' },
    { template: getBulkArchiveChangeSkillTemplate(), dirName: 'openspec-bulk-archive-change', workflowId: 'bulk-archive' },
    { template: getVerifyChangeSkillTemplate(), dirName: 'openspec-verify-change', workflowId: 'verify' },
    { template: getOnboardSkillTemplate(), dirName: 'openspec-onboard', workflowId: 'onboard' },
    { template: getOpsxProposeSkillTemplate(), dirName: 'openspec-propose', workflowId: 'propose' },
  ];

  if (!workflowFilter) return all;

  const filterSet = new Set(workflowFilter);
  return all.filter(entry => filterSet.has(entry.workflowId));
}

/**
 * Gets command templates with their IDs, optionally filtered by workflow IDs.
 *
 * @param workflowFilter - If provided, only return templates whose id is in this array
 */
export function getCommandTemplates(workflowFilter?: readonly string[]): CommandTemplateEntry[] {
  const all: CommandTemplateEntry[] = [
    { template: getOpsxExploreCommandTemplate(), id: 'explore' },
    { template: getOpsxNewCommandTemplate(), id: 'new' },
    { template: getOpsxContinueCommandTemplate(), id: 'continue' },
    { template: getOpsxApplyCommandTemplate(), id: 'apply' },
    { template: getOpsxUpdateCommandTemplate(), id: 'update' },
    { template: getOpsxFfCommandTemplate(), id: 'ff' },
    { template: getOpsxSyncCommandTemplate(), id: 'sync' },
    { template: getOpsxArchiveCommandTemplate(), id: 'archive' },
    { template: getOpsxBulkArchiveCommandTemplate(), id: 'bulk-archive' },
    { template: getOpsxVerifyCommandTemplate(), id: 'verify' },
    { template: getOpsxOnboardCommandTemplate(), id: 'onboard' },
    { template: getOpsxProposeCommandTemplate(), id: 'propose' },
  ];

  if (!workflowFilter) return all;

  const filterSet = new Set(workflowFilter);
  return all.filter(entry => filterSet.has(entry.id));
}

/**
 * Converts command templates to CommandContent array, optionally filtered by workflow IDs.
 *
 * Bodies are rendered through `stripSections`, so section markers never reach
 * a generated command. Sections named by `supersedesFor(id)` are dropped whole
 * (an unknown name throws).
 *
 * @param workflowFilter - If provided, only return contents whose id is in this array
 * @param supersedesFor - Base sections an overlay replaces, per workflow ID
 */
export function getCommandContents(
  workflowFilter?: readonly string[],
  supersedesFor?: (workflowId: string) => readonly string[]
): CommandContent[] {
  const commandTemplates = getCommandTemplates(workflowFilter);
  return commandTemplates.map(({ template, id }) => ({
    id,
    name: template.name,
    description: template.description,
    category: template.category,
    tags: template.tags,
    body: stripSections(template.content, supersedesFor?.(id) ?? [], `${id} command`),
  }));
}

/**
 * Generates skill file content with YAML frontmatter.
 *
 * @param template - The skill template
 * @param generatedByVersion - The OpenSpec version to embed in the file
 * @param transformInstructions - Optional callback to transform the instructions content
 */
/**
 * Composes multiple instruction transformers into a single function.
 * Applies transformers left-to-right, skipping undefined entries.
 */
export function composeTransformers(
  ...fns: Array<((s: string) => string) | undefined>
): ((s: string) => string) | undefined {
  const defined = fns.filter((fn): fn is (s: string) => string => fn !== undefined);
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];
  return (input: string) => defined.reduce((acc, fn) => fn(acc), input);
}

/**
 * Options for {@link generateSkillContent}.
 */
export interface SkillContentOptions {
  /** Base sections an overlay replaces; dropped before any transformer runs. */
  supersedes?: readonly string[];
  /** Names the template in section errors (default: `<template name> skill`). */
  label?: string;
  /**
   * Fingerprint of the project's plugin overlays. When non-empty it is
   * recorded as `metadata.overlays`, so up-to-date detection notices an
   * overlay change; plugin-less output is unchanged.
   */
  overlayFingerprint?: string;
}

export function generateSkillContent(
  template: SkillTemplate,
  generatedByVersion: string,
  transformInstructions?: (instructions: string) => string,
  options: SkillContentOptions = {}
): string {
  // Section markers are resolved first, so they never reach a generated skill
  // and an overlay transformer appends to the already-stripped base.
  const base = stripSections(
    template.instructions,
    options.supersedes ?? [],
    options.label ?? `${template.name} skill`
  );
  const instructions = transformInstructions ? transformInstructions(base) : base;
  const overlaysLine = options.overlayFingerprint
    ? `\n  overlays: "${options.overlayFingerprint}"`
    : '';

  return `---
name: ${template.name}
description: ${template.description}
allowed-tools: ${OPENSPEC_CLI_ALLOWED_TOOLS}
license: ${template.license || 'MIT'}
compatibility: ${template.compatibility || 'Requires openspec CLI.'}
metadata:
  author: ${template.metadata?.author || 'openspec'}
  version: "${template.metadata?.version || '1.0'}"
  generatedBy: "${generatedByVersion}"${overlaysLine}
---

${instructions}
`;
}
