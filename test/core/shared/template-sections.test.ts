import { describe, expect, it } from 'vitest';

import { hasSectionMarkers, listSections, stripSections } from '../../../src/core/shared/template-sections.js';

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
    expect(() => stripSections(['<!--opsx:section a-->'].join('\n'))).toThrowError(/Malformed/);
    expect(() => stripSections(['   <!-- opsx:section a -> '].join('\n'))).toThrowError(/Malformed/);
  });

  it('treats a mention in prose or inline code as plain text, not a marker', () => {
    const body = [
      'Wrap a block in `<!-- opsx:section NAME -->` to make it replaceable.',
      'text <!-- opsx:section a --> text',
    ].join('\n');

    expect(listSections(body)).toEqual([]);
    expect(stripSections(body)).toBe(body);
  });

  it('ignores marker-shaped lines inside fenced code blocks', () => {
    const body = [
      'Example:',
      '',
      '   ```markdown',
      `   ${open('example')}`,
      '   body',
      '   ```',
      '',
      '~~~',
      close('unbalanced-in-fence'),
      '<!-- opsx:section -->',
      '~~~',
      open('real'),
      'kept',
      close('real'),
    ].join('\n');

    expect(listSections(body)).toEqual(['real']);
    expect(stripSections(body)).toBe(body.split('\n').filter((line) => !line.includes('section real')).join('\n'));
    expect(stripSections(body, ['real'])).toBe(body.split('\n').slice(0, 11).join('\n'));
    expect(() => stripSections(body, ['example'])).toThrowError(/example/);
  });

  it('follows CommonMark: a fence line with an info string cannot close a fence', () => {
    // ```bash inside an open ``` fence is content, so the marker after it is
    // still inside the fence and must not be read as a marker.
    const body = ['```', '```bash', open('hidden'), '```', open('real'), 'x', close('real')].join('\n');

    expect(listSections(body)).toEqual(['real']);
  });

  it('closes a fence only with a run at least as long as the opener', () => {
    const body = ['````', '```', open('hidden'), '````', open('real'), 'x', close('real')].join('\n');

    expect(listSections(body)).toEqual(['real']);
  });

  it('throws on a fence left open at the end, so markers cannot hide behind it', () => {
    expect(() => listSections(['```', open('a'), 'x', close('a')].join('\n'))).toThrowError(/fence.*not closed/i);
    expect(() => stripSections(['intro', '~~~md', 'x'].join('\n'))).toThrowError(/fence.*not closed/i);
    expect(() => hasSectionMarkers(['```', 'x'].join('\n'))).toThrowError(/fence.*not closed/i);
  });

  it('does not open a fence on a backtick run whose info string has a backtick (inline code)', () => {
    expect(hasSectionMarkers('```x``` is inline\n<!-- opsx:section foo -->\n```bash\necho\n```')).toBe(true);
    expect(listSections(['```x``` is inline', open('a'), 'x', close('a')].join('\n'))).toEqual(['a']);
    // A tilde fence's info string may contain backticks.
    expect(listSections(['~~~ `x`', open('hidden'), '~~~', open('a'), close('a')].join('\n'))).toEqual(['a']);
  });

  it('does not open a fence on a run indented four or more spaces outside a list', () => {
    expect(hasSectionMarkers('    ```\n<!-- opsx:section foo -->\n    ```')).toBe(true);
    expect(listSections(['text', '', '    ```', open('a'), close('a'), '    ```'].join('\n'))).toEqual(['a']);
  });

  it('opens a fence indented four or more spaces when it belongs to a list item', () => {
    const body = [
      '1. **Step**',
      '   - Run:',
      '     ```bash',
      `     ${open('hidden')}`,
      '     ```',
      '     - Nested:',
      '       ```',
      `       ${open('hidden-too')}`,
      '       ```',
      open('real'),
      'x',
      close('real'),
    ].join('\n');

    expect(listSections(body)).toEqual(['real']);
  });

  it('does not close a backtick fence on a tilde line', () => {
    const body = ['```', '~~~', open('inside'), '```', open('outside'), 'x', close('outside')].join('\n');

    expect(listSections(body)).toEqual(['outside']);
  });
});

describe('listSections', () => {
  it('returns section names in document order', () => {
    expect(listSections(BODY)).toEqual(['loop', 'outputs']);
    expect(listSections(BODY_WITHOUT_MARKERS)).toEqual([]);
  });
});
