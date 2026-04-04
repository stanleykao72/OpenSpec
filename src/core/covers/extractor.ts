/**
 * Covers Extractor
 *
 * Extracts capability names from proposal.md and requirement names from spec files.
 * Used by the instructions command to auto-inject Covers annotations.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

export interface CapabilityRef {
  name: string;
}

export interface RequirementRef {
  capability: string;
  requirement: string;
}

/**
 * Extract capability names from a proposal.md content.
 *
 * Looks for the Capabilities section and extracts kebab-case names from:
 * - Backtick-quoted names: `user-auth`
 * - List items under "New Capabilities" or "Modified Capabilities"
 */
export function extractCapabilities(proposalContent: string): CapabilityRef[] {
  const capabilities: CapabilityRef[] = [];
  const seen = new Set<string>();

  const lines = proposalContent.split('\n');
  let inCapabilities = false;

  for (const line of lines) {
    // Detect Capabilities section
    if (/^#+\s+Capabilities/i.test(line) || /^#+\s+.*Capabilities/i.test(line)) {
      inCapabilities = true;
      continue;
    }

    // Exit when hitting another top-level section
    if (inCapabilities && /^##\s+/.test(line) && !/capabilities/i.test(line)) {
      inCapabilities = false;
      continue;
    }

    if (inCapabilities) {
      // Match backtick-quoted kebab-case names
      const backtickMatches = line.matchAll(/`([a-z][a-z0-9-]*)`/g);
      for (const match of backtickMatches) {
        const name = match[1];
        if (!seen.has(name)) {
          seen.add(name);
          capabilities.push({ name });
        }
      }
    }
  }

  return capabilities;
}

/**
 * Extract requirement names from spec files in a specs directory.
 *
 * Scans specs/{name}/spec.md files and extracts ### Requirement: headers.
 * The capability name is derived from the directory name.
 */
export function extractRequirements(specsDir: string): RequirementRef[] {
  const requirements: RequirementRef[] = [];

  if (!existsSync(specsDir)) {
    return requirements;
  }

  const entries = readdirSync(specsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const specPath = path.join(specsDir, entry.name, 'spec.md');
    if (!existsSync(specPath)) continue;

    const content = readFileSync(specPath, 'utf-8');
    const capName = entry.name;

    // Extract ### Requirement: headers
    const reqMatches = content.matchAll(/^###\s+Requirement:\s+(.+)$/gm);
    for (const match of reqMatches) {
      requirements.push({
        capability: capName,
        requirement: match[1].trim(),
      });
    }
  }

  return requirements;
}
