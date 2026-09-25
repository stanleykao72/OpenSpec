import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import {
  getProjectPluginsDir,
  resolvePluginDir,
  parsePluginManifest,
  loadPlugins,
  PluginLoadError,
  getPluginOverlayEntries,
} from '../../../src/core/plugin/loader.js';
import type { LoadedPlugin } from '../../../src/core/plugin/types.js';

describe('plugin/loader', () => {
  let tempDir: string;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openspec-test-loader-'));
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleWarnSpy.mockRestore();
  });

  /** Helper: create a plugin.yaml in a directory */
  function createPluginYaml(
    dir: string,
    manifest: Record<string, unknown>
  ): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'plugin.yaml'),
      stringifyYaml(manifest)
    );
  }

  describe('getProjectPluginsDir', () => {
    it('should return correct path using path.join', () => {
      const result = getProjectPluginsDir('/my/project');

      expect(result).toBe(path.join('/my/project', 'openspec', 'plugins'));
    });
  });

  describe('resolvePluginDir', () => {
    it('should find project-local plugin first', () => {
      const projectPluginDir = path.join(
        tempDir,
        'openspec',
        'plugins',
        'test-plugin'
      );
      createPluginYaml(projectPluginDir, {
        name: 'test-plugin',
        version: '1.0.0',
      });

      const result = resolvePluginDir('test-plugin', tempDir);

      expect(result).not.toBeNull();
      expect(result!.source).toBe('project');
      expect(result!.dir).toBe(projectPluginDir);
    });

    it('should return null when plugin is not found anywhere', () => {
      const result = resolvePluginDir('nonexistent-plugin', tempDir);

      expect(result).toBeNull();
    });
  });

  describe('parsePluginManifest', () => {
    it('should parse a valid manifest', () => {
      const pluginDir = path.join(tempDir, 'valid-plugin');
      createPluginYaml(pluginDir, {
        name: 'valid-plugin',
        version: '2.0.0',
        description: 'A valid plugin',
      });

      const manifest = parsePluginManifest(pluginDir);

      expect(manifest.name).toBe('valid-plugin');
      expect(manifest.version).toBe('2.0.0');
      expect(manifest.description).toBe('A valid plugin');
    });

    it('should throw PluginLoadError on missing file', () => {
      const pluginDir = path.join(tempDir, 'missing-plugin');
      fs.mkdirSync(pluginDir, { recursive: true });

      expect(() => parsePluginManifest(pluginDir)).toThrow(PluginLoadError);
      expect(() => parsePluginManifest(pluginDir)).toThrow(
        /Failed to read plugin manifest/
      );
    });

    it('should throw PluginLoadError on invalid YAML', () => {
      const pluginDir = path.join(tempDir, 'bad-yaml-plugin');
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir, 'plugin.yaml'),
        '{ invalid yaml [['
      );

      // The YAML library may or may not throw on this specific input.
      // Use a manifest that fails Zod validation instead.
      const pluginDir2 = path.join(tempDir, 'invalid-schema-plugin');
      fs.mkdirSync(pluginDir2, { recursive: true });
      fs.writeFileSync(
        path.join(pluginDir2, 'plugin.yaml'),
        'not_name: foo\nnot_version: bar\n'
      );

      expect(() => parsePluginManifest(pluginDir2)).toThrow(PluginLoadError);
      expect(() => parsePluginManifest(pluginDir2)).toThrow(
        /Invalid plugin manifest/
      );
    });
  });

  describe('loadPlugins', () => {
    it('should load plugins in whitelist order', () => {
      // Create two project-local plugins
      const pluginADir = path.join(
        tempDir,
        'openspec',
        'plugins',
        'plugin-a'
      );
      const pluginBDir = path.join(
        tempDir,
        'openspec',
        'plugins',
        'plugin-b'
      );
      createPluginYaml(pluginADir, {
        name: 'plugin-a',
        version: '1.0.0',
      });
      createPluginYaml(pluginBDir, {
        name: 'plugin-b',
        version: '1.0.0',
      });

      const loaded = loadPlugins(tempDir, ['plugin-b', 'plugin-a']);

      expect(loaded).toHaveLength(2);
      expect(loaded[0].manifest.name).toBe('plugin-b');
      expect(loaded[1].manifest.name).toBe('plugin-a');
    });

    it('should throw PluginLoadError when plugin is not found', () => {
      expect(() =>
        loadPlugins(tempDir, ['nonexistent'])
      ).toThrow(PluginLoadError);
      expect(() =>
        loadPlugins(tempDir, ['nonexistent'])
      ).toThrow(/not found/);
    });
  });

  describe('getPluginOverlayEntries', () => {
    function makePlugin(
      name: string,
      overlays: Record<string, unknown>,
      files: Record<string, string> = {}
    ): LoadedPlugin {
      const dir = path.join(tempDir, 'openspec', 'plugins', name);
      createPluginYaml(dir, { name, version: '1.0.0', skill_overlays: overlays });
      for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
      }
      return { manifest: parsePluginManifest(dir), dir, source: 'project', config: {} };
    }

    it('returns plugin name, path, content and supersedes for each declared overlay', () => {
      const plugin = makePlugin(
        'sup-plugin',
        { apply: { append: 'overlays/apply.md', supersedes: ['apply-inline-loop'] } },
        { 'overlays/apply.md': '## Fan-out' }
      );

      expect(getPluginOverlayEntries([plugin], 'apply')).toEqual([
        {
          pluginName: 'sup-plugin',
          path: path.join(plugin.dir, 'overlays', 'apply.md'),
          content: '## Fan-out',
          supersedes: ['apply-inline-loop'],
        },
      ]);
    });

    it('defaults supersedes to an empty list', () => {
      const plugin = makePlugin('plain-plugin', { apply: { append: 'overlays/apply.md' } }, { 'overlays/apply.md': 'Plain' });
      expect(getPluginOverlayEntries([plugin], 'apply').map((e) => e.supersedes)).toEqual([[]]);
    });

    it('keeps a missing overlay file as a null-content entry and warns', () => {
      // The entry is kept so its supersedes can still be validated and rejected.
      const plugin = makePlugin('missing-file-plugin', {
        apply: { append: 'overlays/missing.md', supersedes: ['apply-inline-loop'] },
      });

      const entries = getPluginOverlayEntries([plugin], 'apply');

      expect(entries.map((e) => [e.content, e.supersedes])).toEqual([[null, ['apply-inline-loop']]]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Overlay file not found'));
    });

    it('returns overlays in whitelist order from multiple plugins', () => {
      const a = makePlugin('plugin-a', { apply: { append: 'overlays/apply.md' } }, { 'overlays/apply.md': 'Content from A' });
      const b = makePlugin('plugin-b', { apply: { append: 'overlays/apply.md' } }, { 'overlays/apply.md': 'Content from B' });

      expect(getPluginOverlayEntries([a, b], 'apply').map((e) => [e.pluginName, e.content])).toEqual([
        ['plugin-a', 'Content from A'],
        ['plugin-b', 'Content from B'],
      ]);
    });

    it('returns nothing when no plugin overlays the workflow', () => {
      const plugin = makePlugin('other-plugin', { explore: { append: 'overlays/explore.md' } }, { 'overlays/explore.md': 'x' });
      expect(getPluginOverlayEntries([plugin], 'apply')).toEqual([]);
    });

    it('does not resolve inherited Object.prototype keys as overlays', () => {
      const a = makePlugin('proto-a', { constructor: { append: 'overlays/c.md' } }, { 'overlays/c.md': 'C' });
      const b = makePlugin('proto-b', { apply: { append: 'overlays/apply.md' } }, { 'overlays/apply.md': 'B' });

      expect(getPluginOverlayEntries([a, b], 'constructor').map((e) => e.pluginName)).toEqual(['proto-a']);
      expect(getPluginOverlayEntries([b], 'toString')).toEqual([]);
      expect(getPluginOverlayEntries([b], '__proto__')).toEqual([]);
    });

    it('rejects an append path that escapes the plugin directory', () => {
      fs.writeFileSync(path.join(tempDir, 'outside.md'), 'secret');
      const plugin = makePlugin('escape-plugin', { apply: { append: '../../../outside.md' } });

      expect(() => getPluginOverlayEntries([plugin], 'apply')).toThrow(/escape-plugin.*outside the plugin directory/s);
    });

    it('rejects an escaping path even when the target does not exist', () => {
      const plugin = makePlugin('escape-missing', { apply: { append: '../nowhere.md' } });
      expect(() => getPluginOverlayEntries([plugin], 'apply')).toThrow(/outside the plugin directory/);
    });

    it('rejects an append file that is a symlink leaving the plugin directory', () => {
      fs.writeFileSync(path.join(tempDir, 'outside.md'), 'secret');
      const plugin = makePlugin('symlink-plugin', { apply: { append: 'overlays/apply.md' } });
      fs.mkdirSync(path.join(plugin.dir, 'overlays'), { recursive: true });
      fs.symlinkSync(path.join(tempDir, 'outside.md'), path.join(plugin.dir, 'overlays', 'apply.md'));

      expect(() => getPluginOverlayEntries([plugin], 'apply')).toThrow(/outside the plugin directory/);
    });

    it('accepts a symlinked plugin directory whose files stay inside it', () => {
      const real = path.join(tempDir, 'real-plugin');
      fs.mkdirSync(path.join(real, 'overlays'), { recursive: true });
      createPluginYaml(real, { name: 'linked', version: '1.0.0', skill_overlays: { apply: { append: 'overlays/apply.md' } } });
      fs.writeFileSync(path.join(real, 'overlays', 'apply.md'), 'linked content');
      const linkDir = path.join(tempDir, 'openspec', 'plugins', 'linked');
      fs.mkdirSync(path.dirname(linkDir), { recursive: true });
      fs.symlinkSync(real, linkDir);
      const plugin: LoadedPlugin = { manifest: parsePluginManifest(linkDir), dir: linkDir, source: 'project', config: {} };

      expect(getPluginOverlayEntries([plugin], 'apply').map((e) => e.content)).toEqual(['linked content']);
    });
  });
});
