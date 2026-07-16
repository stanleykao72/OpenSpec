import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { computeFingerprint } from '../../../src/core/validation/gate-checker.js';

describe('Gate Fingerprinting', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'openspec-fingerprint-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── computeFingerprint ────────────────────────────────────────────────

  describe('computeFingerprint', () => {
    it('should return consistent hash for same content', () => {
      writeFileSync(path.join(tmpDir, 'proposal.md'), '# Proposal\nSome content');
      writeFileSync(path.join(tmpDir, 'tasks.md'), '- [ ] Task 1');

      const hash1 = computeFingerprint(tmpDir);
      const hash2 = computeFingerprint(tmpDir);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex = 64 chars
    });

    it('should return different hash when file content changes', () => {
      writeFileSync(path.join(tmpDir, 'proposal.md'), '# Proposal v1');
      const hash1 = computeFingerprint(tmpDir);

      writeFileSync(path.join(tmpDir, 'proposal.md'), '# Proposal v2');
      const hash2 = computeFingerprint(tmpDir);

      expect(hash1).not.toBe(hash2);
    });

    it('should return different hash when a new file is added', () => {
      writeFileSync(path.join(tmpDir, 'proposal.md'), '# Proposal');
      const hash1 = computeFingerprint(tmpDir);

      writeFileSync(path.join(tmpDir, 'tasks.md'), '- [ ] New task');
      const hash2 = computeFingerprint(tmpDir);

      expect(hash1).not.toBe(hash2);
    });

    it('should not change when file mtime changes but content stays the same', () => {
      writeFileSync(path.join(tmpDir, 'proposal.md'), '# Proposal');
      const hash1 = computeFingerprint(tmpDir);

      // Re-write same content (changes mtime)
      writeFileSync(path.join(tmpDir, 'proposal.md'), '# Proposal');
      const hash2 = computeFingerprint(tmpDir);

      expect(hash1).toBe(hash2);
    });

    it('should include specs/**/*.md files', () => {
      writeFileSync(path.join(tmpDir, 'proposal.md'), '# Proposal');
      mkdirSync(path.join(tmpDir, 'specs', 'cap-a'), { recursive: true });
      writeFileSync(path.join(tmpDir, 'specs', 'cap-a', 'spec.md'), '# Spec A');

      const hash1 = computeFingerprint(tmpDir);

      // Add another spec
      mkdirSync(path.join(tmpDir, 'specs', 'cap-b'), { recursive: true });
      writeFileSync(path.join(tmpDir, 'specs', 'cap-b', 'spec.md'), '# Spec B');

      const hash2 = computeFingerprint(tmpDir);
      expect(hash1).not.toBe(hash2);
    });

    it('should handle partial files (only proposal.md and tasks.md)', () => {
      writeFileSync(path.join(tmpDir, 'proposal.md'), '# Proposal');
      writeFileSync(path.join(tmpDir, 'tasks.md'), '- [ ] Task');

      const hash = computeFingerprint(tmpDir);
      expect(hash).toHaveLength(64);
    });

    it('should handle empty change directory (no tracked files)', () => {
      const hash = computeFingerprint(tmpDir);
      expect(hash).toHaveLength(64);
    });

    it('should produce sorted deterministic output regardless of file creation order', () => {
      // Create files in one order
      const dir1 = mkdtempSync(path.join(os.tmpdir(), 'openspec-fp-order1-'));
      writeFileSync(path.join(dir1, 'tasks.md'), 'tasks');
      writeFileSync(path.join(dir1, 'proposal.md'), 'proposal');
      writeFileSync(path.join(dir1, 'design.md'), 'design');

      // Create same files in different order
      const dir2 = mkdtempSync(path.join(os.tmpdir(), 'openspec-fp-order2-'));
      writeFileSync(path.join(dir2, 'design.md'), 'design');
      writeFileSync(path.join(dir2, 'proposal.md'), 'proposal');
      writeFileSync(path.join(dir2, 'tasks.md'), 'tasks');

      expect(computeFingerprint(dir1)).toBe(computeFingerprint(dir2));

      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    });
  });

});
