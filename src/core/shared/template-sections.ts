/**
 * Named sections in base workflow templates.
 *
 * A template may delimit a block that a plugin overlay can replace:
 *
 *   <!-- opsx:section NAME -->
 *   ...block...
 *   <!-- /opsx:section NAME -->
 *
 * Markers sit on their own lines (indentation allowed). Rendering always goes
 * through `stripSections`: superseded sections are dropped whole, every other
 * marker line is removed, so output with nothing superseded is byte-identical
 * to the template as it read before the markers were added.
 */

const MARKER_RE = /^\s*<!-- (\/?)opsx:section ([a-z0-9][a-z0-9-]*) -->\s*$/;
const MARKER_HINT = 'opsx:section';

interface ParsedMarker {
  closing: boolean;
  name: string;
}

function parseMarker(line: string, lineNumber: number): ParsedMarker | null {
  if (!line.includes(MARKER_HINT)) return null;
  const match = MARKER_RE.exec(line);
  if (!match) {
    throw new Error(
      `Malformed section marker on line ${lineNumber}: "${line.trim()}". ` +
        'Expected "<!-- opsx:section NAME -->" or "<!-- /opsx:section NAME -->" on its own line.'
    );
  }
  return { closing: match[1] === '/', name: match[2] };
}

interface Section {
  name: string;
  start: number; // index of the opening marker line
  end: number; // index of the closing marker line
}

function parseSections(lines: string[]): { sections: Section[]; markerLines: Set<number> } {
  const sections: Section[] = [];
  const markerLines = new Set<number>();
  const seen = new Set<string>();
  let current: { name: string; start: number } | null = null;

  lines.forEach((line, index) => {
    const marker = parseMarker(line, index + 1);
    if (!marker) return;
    markerLines.add(index);

    if (!marker.closing) {
      if (current) {
        throw new Error(
          `Section "${marker.name}" opens on line ${index + 1} inside section "${current.name}"; nested sections are not supported.`
        );
      }
      if (seen.has(marker.name)) {
        throw new Error(`Section "${marker.name}" is defined more than once (line ${index + 1}).`);
      }
      current = { name: marker.name, start: index };
      return;
    }

    if (!current || current.name !== marker.name) {
      throw new Error(
        `Section "${marker.name}" closes on line ${index + 1} without a matching open marker.`
      );
    }
    sections.push({ name: current.name, start: current.start, end: index });
    seen.add(current.name);
    current = null;
  });

  if (current) {
    const open = current as { name: string; start: number };
    throw new Error(`Section "${open.name}" opened on line ${open.start + 1} is not closed.`);
  }

  return { sections, markerLines };
}

/**
 * Names of the sections a template body defines, in document order.
 */
export function listSections(body: string): string[] {
  return parseSections(body.split('\n')).sections.map((section) => section.name);
}

/**
 * Renders a template body: drops each section named in `superseded` whole and
 * removes the marker lines of every other section.
 *
 * Fails closed: a superseded name the body does not define is an error, so a
 * renamed or deleted section can never be silently left in place.
 *
 * Where a dropped section leaves a blank line on both sides, one of them is
 * removed so the seam reads as a single paragraph break; a section dropped at
 * the end of the body takes the blank lines before it along.
 *
 * @param label - Names the template in error messages (e.g. the workflow ID).
 */
export function stripSections(
  body: string,
  superseded: readonly string[] = [],
  label?: string
): string {
  const lines = body.split('\n');
  const { sections, markerLines } = parseSections(lines);

  const available = sections.map((section) => section.name);
  const unknown = [...new Set(superseded)].filter((name) => !available.includes(name));
  if (unknown.length > 0) {
    const where = label ? ` in the "${label}" template` : '';
    throw new Error(
      `Overlay supersedes unknown section(s)${where}: ${unknown.join(', ')}. ` +
        `Available sections: ${available.length > 0 ? available.join(', ') : '(none)'}.`
    );
  }

  if (markerLines.size === 0) return body;

  const dropped = new Set(superseded);
  const droppedRanges = sections.filter((section) => dropped.has(section.name));

  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const range = droppedRanges.find((section) => section.start === index);
    if (range) {
      index = range.end + 1;
      const atEnd = index >= lines.length;
      if (atEnd) {
        while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
      } else if (out.length > 0 && out[out.length - 1].trim() === '' && lines[index].trim() === '') {
        index += 1;
      }
      continue;
    }
    if (!markerLines.has(index)) out.push(lines[index]);
    index += 1;
  }

  return out.join('\n');
}
