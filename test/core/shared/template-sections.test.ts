import { describe, expect, it } from 'vitest';

import { listSections, stripSections } from '../../../src/core/shared/template-sections.js';

const open = (name: string) => `<!-- opsx:section ${name} -->`;
const close = (name: string) => `<!-- /opsx:section ${name} -->`;

/**
 * A body shaped like the apply template: a numbered step whose loop is a
 * section, followed by an adjacent output-templates section, then guardrails.
 */
const BODY = [
  'Intro.',
  '',
  '6. **Implement tasks**',
  '',
  '   Follow the overlay if present.',
  '',
  open('loop'),
  '   If no overlay, loop:',
  '   - do the task',
  '',
  '7. **Show status**',
  close('loop'),
  '',
  open('outputs'),
  '**Output**',
  '',
  '```',
  'done',
  '```',
  close('outputs'),
  '',
  '**Guardrails**',
  '- stay scoped',
].join('\n');

const BODY_WITHOUT_MARKERS = [
  'Intro.',
  '',
  '6. **Implement tasks**',
  '',
  '   Follow the overlay if present.',
  '',
  '   If no overlay, loop:',
  '   - do the task',
  '',
  '7. **Show status**',
  '',
  '**Output**',
  '',
  '```',
  'done',
  '```',
  '',
  '**Guardrails**',
  '- stay scoped',
].join('\n');

describe('stripSections', () => {
  it('returns a body without markers unchanged', () => {
    expect(stripSections(BODY_WITHOUT_MARKERS)).toBe(BODY_WITHOUT_MARKERS);
    expect(stripSections('no trailing newline')).toBe('no trailing newline');
    expect(stripSections('trailing newline\n')).toBe('trailing newline\n');
  });

  it('drops only the marker lines when nothing is superseded', () => {
    expect(stripSections(BODY)).toBe(BODY_WITHOUT_MARKERS);
    expect(stripSections(BODY, [])).toBe(BODY_WITHOUT_MARKERS);
  });

  it('removes a superseded section whole and keeps the others without markers', () => {
    const result = stripSections(BODY, ['loop']);

    expect(result).toBe(
      [
        'Intro.',
        '',
        '6. **Implement tasks**',
        '',
        '   Follow the overlay if present.',
        '',
        '**Output**',
        '',
        '```',
        'done',
        '```',
        '',
        '**Guardrails**',
        '- stay scoped',
      ].join('\n')
    );
    expect(result).not.toContain('opsx:section');
  });

  it('collapses the seam to one blank line when adjacent sections are both removed', () => {
    expect(stripSections(BODY, ['loop', 'outputs'])).toBe(
      [
        'Intro.',
        '',
        '6. **Implement tasks**',
        '',
        '   Follow the overlay if present.',
        '',
        '**Guardrails**',
        '- stay scoped',
      ].join('\n')
    );
  });

  it('handles a section that closes at end of input without a trailing newline', () => {
    const body = ['Keep me.', '', open('tail'), '**Output Format**', '- list', close('tail')].join('\n');

    expect(stripSections(body)).toBe(['Keep me.', '', '**Output Format**', '- list'].join('\n'));
    expect(stripSections(body, ['tail'])).toBe('Keep me.');
  });

  it('recognises indented markers', () => {
    const body = ['a', `   ${open('x')}`, '   inner', `   ${close('x')}`, 'b'].join('\n');

    expect(stripSections(body)).toBe(['a', '   inner', 'b'].join('\n'));
    expect(stripSections(body, ['x'])).toBe(['a', 'b'].join('\n'));
  });

  it('fails closed, naming every superseded section the body does not define', () => {
    expect(() => stripSections(BODY, ['loop', 'nope', 'also-missing'], 'apply')).toThrowError(
      /apply.*nope.*also-missing/s
    );
    expect(() => stripSections(BODY_WITHOUT_MARKERS, ['loop'])).toThrowError(/loop/);
  });

  it('lists the available sections in the unknown-name error', () => {
    expect(() => stripSections(BODY, ['nope'])).toThrowError(/Available sections: loop, outputs/);
  });

  it('rejects unbalanced, nested, duplicated or malformed markers', () => {
    expect(() => stripSections([open('a'), 'x'].join('\n'))).toThrowError(/not closed/);
    expect(() => stripSections(['x', close('a')].join('\n'))).toThrowError(/without a matching open/);
    expect(() => stripSections([open('a'), open('b'), close('b'), close('a')].join('\n'))).toThrowError(/nested/);
    expect(() => stripSections([open('a'), close('b')].join('\n'))).toThrowError(/without a matching open/);
    expect(() =>
      stripSections([open('a'), close('a'), open('a'), close('a')].join('\n'))
    ).toThrowError(/more than once/);
    expect(() => stripSections(['<!-- opsx:section -->'].join('\n'))).toThrowError(/Malformed/);
    expect(() => stripSections(['text <!-- opsx:section a --> text'].join('\n'))).toThrowError(/Malformed/);
  });
});

describe('listSections', () => {
  it('returns section names in document order', () => {
    expect(listSections(BODY)).toEqual(['loop', 'outputs']);
    expect(listSections(BODY_WITHOUT_MARKERS)).toEqual([]);
  });
});
