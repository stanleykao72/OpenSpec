import { describe, it, expect } from 'vitest';
import {
  SPEC_VIEWER_STYLE,
  SPEC_VIEWER_NAV_SCRIPT,
  LIFECYCLE_STATIONS,
} from '../../../src/core/render/html-template.js';

describe('html-template', () => {
  it('carries the global [hidden] protection rule', () => {
    expect(SPEC_VIEWER_STYLE).toContain('[hidden]');
    expect(SPEC_VIEWER_STYLE).toContain('display: none !important');
  });

  it('does not declare any comment-layer classes (Non-Goal)', () => {
    expect(SPEC_VIEWER_STYLE).not.toContain('spec-comment-');
    expect(SPEC_VIEWER_STYLE).not.toContain('spec-review-');
    expect(SPEC_VIEWER_NAV_SCRIPT).not.toContain('spec-comment-');
  });

  it('never contains a DOCTYPE or html/head/body wrapper literal', () => {
    for (const chunk of [SPEC_VIEWER_STYLE, SPEC_VIEWER_NAV_SCRIPT]) {
      expect(chunk.toLowerCase()).not.toMatch(/<!doctype/);
      expect(chunk.toLowerCase()).not.toMatch(/<html[\s>]/);
      expect(chunk.toLowerCase()).not.toMatch(/<head[\s>]/);
      expect(chunk.toLowerCase()).not.toMatch(/<body[\s>]/);
    }
  });

  it('ports the drawer/scrollspy/revealTarget navigation logic', () => {
    expect(SPEC_VIEWER_NAV_SCRIPT).toContain('revealTarget');
    expect(SPEC_VIEWER_NAV_SCRIPT).toContain('IntersectionObserver');
    expect(SPEC_VIEWER_NAV_SCRIPT).toContain('spec-drawer-toggle');
  });

  it('fixes the 5-station lifecycle in order', () => {
    expect(LIFECYCLE_STATIONS).toEqual(['explore', 'propose', 'apply', 'verify', 'archive']);
  });
});
