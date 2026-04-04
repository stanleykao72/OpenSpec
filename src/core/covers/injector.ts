/**
 * Covers Injector
 *
 * Injects Covers annotations into design and tasks templates.
 * Developers can freely edit the auto-generated annotations.
 */

import type { CapabilityRef, RequirementRef } from './extractor.js';

/**
 * Inject Covers annotations into a design template.
 *
 * Adds a Covers line after the "## Decisions" heading with all capabilities,
 * plus example Decision subsections showing per-decision Covers.
 */
export function injectDesignCovers(template: string, capabilities: CapabilityRef[]): string {
  // Find the ## Decisions section and inject after it
  const decisionsMarker = '## Decisions';
  const idx = template.indexOf(decisionsMarker);
  if (idx === -1) {
    // No Decisions section found, append at end
    return template + '\n\n## Decisions\n\n' + buildDecisionSections(capabilities);
  }

  // Find the end of the Decisions line
  const lineEnd = template.indexOf('\n', idx);
  const before = template.slice(0, lineEnd + 1);
  const after = template.slice(lineEnd + 1);

  return before + '\n' + buildDecisionSections(capabilities) + '\n' + after;
}

function buildDecisionSections(capabilities: CapabilityRef[]): string {
  const allCovers = capabilities.map((c) => `\`${c.name}\``).join(', ');

  const sections: string[] = [];
  sections.push(`### Decision 1: <!-- title -->`);
  sections.push(`**Covers**: ${allCovers}`);
  sections.push('');
  sections.push('<!-- Rationale and alternatives considered -->');

  return sections.join('\n');
}

/**
 * Inject Covers annotations into a tasks template.
 *
 * Generates task group headers with Covers annotations from requirements.
 * Groups requirements by capability.
 */
export function injectTasksCovers(_template: string, requirements: RequirementRef[]): string {
  // Group requirements by capability
  const grouped = new Map<string, RequirementRef[]>();
  for (const req of requirements) {
    const existing = grouped.get(req.capability) ?? [];
    existing.push(req);
    grouped.set(req.capability, existing);
  }

  const sections: string[] = [];
  let groupIndex = 1;

  for (const [capability, reqs] of grouped) {
    const coverLines = reqs
      .map((r) => `\`${r.capability}\` > \`Requirement: ${r.requirement}\``)
      .join(', ');

    sections.push(`## ${groupIndex}. ${capability}`);
    sections.push(`**Covers**: ${coverLines}`);
    sections.push('');
    sections.push(`- [ ] ${groupIndex}.1 <!-- Task description -->`);
    sections.push(`- [ ] ${groupIndex}.2 <!-- Task description -->`);
    sections.push('');

    groupIndex++;
  }

  return sections.join('\n');
}
