import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  generateSkillContent,
  getCommandContents,
  getCommandTemplates,
  getSkillTemplates,
} from '../../../src/core/shared/skill-generation.js';
import { listSections } from '../../../src/core/shared/template-sections.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Hashes of the apply/verify outputs rendered at the commit *before* section
 * markers were added (276072c), with no overlay. Rendering the marked templates
 * without supersedes must reproduce them byte for byte: this is what proves the
 * markers never leak and that the default strip restores the exact pre-marker
 * text (blank lines included). The skill-content side is also pinned in
 * skill-templates-parity.test.ts, whose apply/verify entries did not move.
 */
const PRE_MARKER_HASHES = {
  skill: {
    'openspec-apply-change': 'e8c674b26a2feaf7b9eeefc81eef01b37b0cb02f1e3678c985da3950f32864b6',
    'openspec-verify-change': '72bb3931c7f47552afeeffaa0857250ca80cebdee4d9bebb22c8d2f780869b4e',
  },
  command: {
    apply: 'd4114163746552c512f587fee57489ca15eae2df7758929b3ecf118350784cdc',
    verify: '10a6fb9925b5324e3e2cfb49a97a500710b90944175c59f7355177a0a060d8a1',
  },
} as const;

const EXPECTED_SECTIONS: Record<string, string[]> = {
  apply: ['apply-inline-loop', 'apply-output-templates'],
  verify: ['verify-default-procedure', 'verify-output-format'],
};

describe('base template section markers', () => {
  // Guards against the identity check below passing vacuously: the raw
  // templates really do carry the markers.
  it('marks the overlay-replaceable sections in both skill and command sources', () => {
    for (const { template, workflowId } of getSkillTemplates(['apply', 'verify'])) {
      expect(listSections(template.instructions), `skill ${workflowId}`).toEqual(EXPECTED_SECTIONS[workflowId]);
    }
    for (const { template, id } of getCommandTemplates(['apply', 'verify'])) {
      expect(listSections(template.content), `command ${id}`).toEqual(EXPECTED_SECTIONS[id]);
    }
  });

  it('renders apply/verify byte-identical to the pre-marker output when nothing is superseded', () => {
    for (const { template, dirName } of getSkillTemplates(['apply', 'verify'])) {
      expect(
        sha256(generateSkillContent(template, 'PARITY-BASELINE')),
        dirName
      ).toBe(PRE_MARKER_HASHES.skill[dirName as keyof typeof PRE_MARKER_HASHES.skill]);
    }
    for (const content of getCommandContents(['apply', 'verify'])) {
      expect(sha256(content.body), content.id).toBe(
        PRE_MARKER_HASHES.command[content.id as keyof typeof PRE_MARKER_HASHES.command]
      );
    }
  });

  it('never leaks a marker into any generated skill or command', () => {
    for (const { template, dirName } of getSkillTemplates()) {
      expect(generateSkillContent(template, 'PARITY-BASELINE'), dirName).not.toContain('opsx:section');
    }
    for (const content of getCommandContents()) {
      expect(content.body, content.id).not.toContain('opsx:section');
    }
  });

  it('strips the named sections when supersedes is passed to the shared generators', () => {
    const [apply] = getSkillTemplates(['apply']);
    const stripped = generateSkillContent(apply.template, 'X', undefined, {
      supersedes: ['apply-inline-loop', 'apply-output-templates'],
    });
    expect(stripped).not.toContain('Output During Implementation');
    expect(stripped).toContain('**Guardrails**');

    const [verifyCmd] = getCommandContents(['verify'], (id) =>
      id === 'verify' ? ['verify-default-procedure', 'verify-output-format'] : []
    );
    expect(verifyCmd.body).not.toContain('**Output Format**');
    expect(verifyCmd.body).toContain('4. **Verification execution');
  });
});
