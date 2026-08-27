import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  writeChangeMetadata,
  readChangeMetadata,
  resolveSchemaForChange,
  validateSchemaName,
  ChangeMetadataError,
  readRetireCapabilitiesMarker,
  readSkipSpecsMarker,
} from '../../src/utils/change-metadata.js';
import { ChangeMetadataSchema } from '../../src/core/change-metadata/index.js';

describe('ChangeMetadataSchema', () => {
  describe('valid metadata', () => {
    it('should accept valid schema with created date', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: 'spec-driven',
        created: '2025-01-05',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.schema).toBe('spec-driven');
        expect(result.data.created).toBe('2025-01-05');
      }
    });

    it('should accept skip_specs boolean and reject non-boolean values', () => {
      const withFlag = ChangeMetadataSchema.safeParse({
        schema: 'spec-driven',
        skip_specs: true,
      });
      expect(withFlag.success).toBe(true);
      if (withFlag.success) {
        expect(withFlag.data.skip_specs).toBe(true);
      }

      const nonBoolean = ChangeMetadataSchema.safeParse({
        schema: 'spec-driven',
        skip_specs: 'yes',
      });
      expect(nonBoolean.success).toBe(false);
    });

    it('should accept valid schema without created date', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: 'custom-schema',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.schema).toBe('custom-schema');
        expect(result.data.created).toBeUndefined();
      }
    });

    it('should accept a portable initiative link', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: 'spec-driven',
        initiative: {
          store: 'platform',
          id: 'billing-launch',
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.initiative).toEqual({
          store: 'platform',
          id: 'billing-launch',
        });
      }
    });
  });

  describe('invalid metadata', () => {
    it('should reject empty schema', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing schema', () => {
      const result = ChangeMetadataSchema.safeParse({
        created: '2025-01-05',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid date format', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: 'spec-driven',
        created: '01/05/2025', // Wrong format
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-ISO date format', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: 'spec-driven',
        created: '2025-1-5', // Missing leading zeros
      });
      expect(result.success).toBe(false);
    });

    it('should reject initiative links with local paths or copied content', () => {
      const result = ChangeMetadataSchema.safeParse({
        schema: 'spec-driven',
        initiative: {
          store: 'platform',
          id: 'billing-launch',
          path: '/tmp/store/initiatives/billing-launch',
          summary: 'Copied initiative prose',
        },
      });

      expect(result.success).toBe(false);
    });

    it('should reject unsafe initiative link identifiers', () => {
      for (const initiative of [
        { store: '/tmp/platform', id: 'billing-launch' },
        { store: 'platform', id: 'billing/launch' },
        { store: 'Platform', id: 'billing-launch' },
        { store: 'platform', id: 'billing launch' },
      ]) {
        const result = ChangeMetadataSchema.safeParse({
          schema: 'spec-driven',
          initiative,
        });

        expect(result.success).toBe(false);
      }
    });
  });
});

describe('writeChangeMetadata', () => {
  let testDir: string;
  let changeDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-test-'));
    changeDir = path.join(testDir, 'openspec', 'changes', 'test-change');
    await fs.mkdir(changeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should write valid YAML metadata file', async () => {
    writeChangeMetadata(changeDir, {
      schema: 'spec-driven',
      created: '2025-01-05',
    });

    const metaPath = path.join(changeDir, '.openspec.yaml');
    const content = await fs.readFile(metaPath, 'utf-8');

    expect(content).toContain('schema: spec-driven');
    expect(content).toContain('created: 2025-01-05');
  });

  it('should throw error for unknown schema', () => {
    expect(() =>
      writeChangeMetadata(changeDir, {
        schema: 'unknown-schema',
        created: '2025-01-05',
      })
    ).toThrow(/Unknown schema 'unknown-schema'/);
  });
});

describe('readChangeMetadata', () => {
  let testDir: string;
  let changeDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-test-'));
    changeDir = path.join(testDir, 'openspec', 'changes', 'test-change');
    await fs.mkdir(changeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should return null when no metadata file exists', () => {
    const result = readChangeMetadata(changeDir);
    expect(result).toBeNull();
  });

  it('should read valid metadata', async () => {
    const metaPath = path.join(changeDir, '.openspec.yaml');
    await fs.writeFile(
      metaPath,
      'schema: spec-driven\ncreated: "2025-01-05"\n',
      'utf-8'
    );

    const result = readChangeMetadata(changeDir);
    expect(result).toEqual({
      schema: 'spec-driven',
      created: '2025-01-05',
    });
  });

  it('should read portable initiative metadata', async () => {
    const metaPath = path.join(changeDir, '.openspec.yaml');
    await fs.writeFile(
      metaPath,
      [
        'schema: spec-driven',
        'initiative:',
        '  store: platform',
        '  id: billing-launch',
        '',
      ].join('\n'),
      'utf-8'
    );

    const result = readChangeMetadata(changeDir);
    expect(result?.initiative).toEqual({
      store: 'platform',
      id: 'billing-launch',
    });
  });

  it('should throw ChangeMetadataError for invalid YAML', async () => {
    const metaPath = path.join(changeDir, '.openspec.yaml');
    await fs.writeFile(metaPath, '{ invalid yaml', 'utf-8');

    expect(() => readChangeMetadata(changeDir)).toThrow(ChangeMetadataError);
  });

  it('should throw ChangeMetadataError for missing schema field', async () => {
    const metaPath = path.join(changeDir, '.openspec.yaml');
    await fs.writeFile(metaPath, 'created: "2025-01-05"\n', 'utf-8');

    expect(() => readChangeMetadata(changeDir)).toThrow(ChangeMetadataError);
  });

  it('should throw ChangeMetadataError for unknown schema', async () => {
    const metaPath = path.join(changeDir, '.openspec.yaml');
    await fs.writeFile(metaPath, 'schema: unknown-schema\n', 'utf-8');

    expect(() => readChangeMetadata(changeDir)).toThrow(/Unknown schema/);
  });
});

describe('resolveSchemaForChange', () => {
  let testDir: string;
  let changeDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-test-'));
    changeDir = path.join(testDir, 'openspec', 'changes', 'test-change');
    await fs.mkdir(changeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should return explicit schema when provided', async () => {
    // Even with metadata file, explicit schema wins
    const metaPath = path.join(changeDir, '.openspec.yaml');
    await fs.writeFile(metaPath, 'schema: spec-driven\n', 'utf-8');

    const result = resolveSchemaForChange(changeDir, 'custom-schema');
    expect(result).toBe('custom-schema');
  });

  it('should return schema from metadata when no explicit schema', async () => {
    const metaPath = path.join(changeDir, '.openspec.yaml');
    await fs.writeFile(metaPath, 'schema: spec-driven\n', 'utf-8');

    const result = resolveSchemaForChange(changeDir);
    expect(result).toBe('spec-driven');
  });

  it('should return default when no metadata and no explicit schema', () => {
    const result = resolveSchemaForChange(changeDir);
    expect(result).toBe('spec-driven');
  });

  it('should fail when metadata exists but cannot be read', async () => {
    // Create an invalid metadata file
    const metaPath = path.join(changeDir, '.openspec.yaml');
    await fs.writeFile(metaPath, '{ invalid yaml', 'utf-8');

    expect(() => resolveSchemaForChange(changeDir)).toThrow(ChangeMetadataError);
  });

  it('should use project config schema when no metadata exists', async () => {
    // Create project config
    const configDir = path.join(testDir, 'openspec');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.yaml'),
      'schema: custom-schema\n',
      'utf-8'
    );

    const result = resolveSchemaForChange(changeDir);
    expect(result).toBe('custom-schema');
  });

  it('should prefer change metadata over project config', async () => {
    // Create project config
    const configDir = path.join(testDir, 'openspec');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.yaml'),
      'schema: custom-schema\n',
      'utf-8'
    );

    // Create change metadata with different schema
    const metaPath = path.join(changeDir, '.openspec.yaml');
    await fs.writeFile(metaPath, 'schema: spec-driven\n', 'utf-8');

    const result = resolveSchemaForChange(changeDir);
    expect(result).toBe('spec-driven'); // Change metadata wins
  });

  it('should prefer explicit schema over all config sources', async () => {
    // Create project config
    const configDir = path.join(testDir, 'openspec');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.yaml'),
      'schema: custom-schema\n',
      'utf-8'
    );

    // Create change metadata
    const metaPath = path.join(changeDir, '.openspec.yaml');
    await fs.writeFile(metaPath, 'schema: spec-driven\n', 'utf-8');

    // Explicit schema should win
    const result = resolveSchemaForChange(changeDir, 'custom-schema');
    expect(result).toBe('custom-schema');
  });

  it('should test full precedence order: CLI > metadata > config > default', async () => {
    // Setup all levels
    const configDir = path.join(testDir, 'openspec');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'config.yaml'),
      'schema: custom-schema\n',
      'utf-8'
    );

    const metaPath = path.join(changeDir, '.openspec.yaml');
    await fs.writeFile(metaPath, 'schema: spec-driven\n', 'utf-8');

    // Test each level
    expect(resolveSchemaForChange(changeDir, 'custom-schema')).toBe('custom-schema'); // CLI wins
    expect(resolveSchemaForChange(changeDir)).toBe('spec-driven'); // Metadata wins when no CLI

    // Remove metadata, config should win
    await fs.unlink(metaPath);
    expect(resolveSchemaForChange(changeDir)).toBe('custom-schema'); // Config wins

    // Remove config, default should win
    await fs.unlink(path.join(configDir, 'config.yaml'));
    expect(resolveSchemaForChange(changeDir)).toBe('spec-driven'); // Default wins
  });
});

describe('validateSchemaName', () => {
  it('should accept valid schema name', () => {
    expect(() => validateSchemaName('spec-driven')).not.toThrow();
  });

  it('should throw for unknown schema', () => {
    expect(() => validateSchemaName('unknown-schema')).toThrow(
      /Unknown schema 'unknown-schema'/
    );
  });
});

describe('boolean marker reasons', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-marker-reason-'));
    await fs.mkdir(path.join(tempDir, 'openspec', 'changes', 'c'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Every reason quotes something the author wrote, and callers print it
  // straight to a terminal. A schema name carrying an ESC could redraw the
  // screen; a CR could forge a line of its own.
  it('strips control characters from a reason that quotes authored content', async () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'c');
    await fs.writeFile(
      path.join(changeDir, '.openspec.yaml'),
      'schema: "ghost\u001b[31m-schema"\nretire_capabilities: true\n',
      'utf-8'
    );

    const marker = readRetireCapabilitiesMarker(changeDir);

    expect(marker.declared).toBe(false);
    // The name is still recognisable, so the author can find what they typed.
    expect(marker.invalidReason).toContain("unknown schema 'ghost?[31m-schema'");
    expect(marker.invalidReason).not.toMatch(/[\u0000-\u001f\u007f]/);
  });
});

// Regression: the marker's schema check must resolve against the caller's
// project root, with that project's plugins loaded. Both halves are needed and
// each fails independently - a wrong root finds no plugins at all, and the
// right root without the plugins argument still lists only built-in schemas.
// A project-local schema under openspec/schemas/ cannot stand in here:
// listSchemas contributes those without any plugins argument, so such a fixture
// passes even with the defect fully present.
describe('boolean markers resolve schemas against the caller project root', () => {
  let tempDir: string;
  let projectRoot: string;
  let changeDir: string;

  const PLUGIN_NAME = 'fixture-plugin';
  const PLUGIN_SCHEMA = 'fixture-schema';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-marker-root-'));
    projectRoot = path.join(tempDir, 'project');

    // Changes live outside the project tree, as a shared spec store does. The
    // <changeDir>/../../.. derivation cannot reach projectRoot from here.
    changeDir = path.join(tempDir, 'store', 'changes', 'a-change');
    await fs.mkdir(changeDir, { recursive: true });

    const pluginDir = path.join(projectRoot, 'openspec', 'plugins', PLUGIN_NAME);
    const schemaDir = path.join(pluginDir, 'schemas', PLUGIN_SCHEMA);
    await fs.mkdir(schemaDir, { recursive: true });

    await fs.writeFile(
      path.join(projectRoot, 'openspec', 'config.yaml'),
      `changesDir: "../store/changes"\nplugins:\n  - ${PLUGIN_NAME}\n`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(pluginDir, 'plugin.yaml'),
      `name: ${PLUGIN_NAME}\nversion: 1.0.0\nschemas:\n  - ${PLUGIN_SCHEMA}\n`,
      'utf-8'
    );
    await fs.writeFile(
      path.join(schemaDir, 'schema.yaml'),
      [
        `name: ${PLUGIN_SCHEMA}`,
        'version: 1',
        'description: Fixture schema provided by a plugin',
        'artifacts:',
        '  - id: notes',
        '    generates: notes.md',
        '    description: Fixture artifact',
        '    template: notes.md',
        '',
      ].join('\n'),
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function writeMarker(schema: string, key = 'skip_specs'): Promise<void> {
    await fs.writeFile(
      path.join(changeDir, '.openspec.yaml'),
      `schema: ${schema}\n${key}: true\n`,
      'utf-8'
    );
  }

  it('honors a marker naming a plugin schema when the project root is passed', async () => {
    await writeMarker(PLUGIN_SCHEMA);

    const marker = readSkipSpecsMarker(changeDir, projectRoot);

    expect(marker.invalidReason).toBeUndefined();
    expect(marker.declared).toBe(true);
  });

  it('applies the same resolution to the retire_capabilities marker', async () => {
    await writeMarker(PLUGIN_SCHEMA, 'retire_capabilities');

    const marker = readRetireCapabilitiesMarker(changeDir, projectRoot);

    expect(marker.invalidReason).toBeUndefined();
    expect(marker.declared).toBe(true);
  });

  it('still refuses a schema no source provides, and names it', async () => {
    await writeMarker('no-such-schema');

    const marker = readSkipSpecsMarker(changeDir, projectRoot);

    expect(marker.declared).toBe(false);
    expect(marker.invalidReason).toContain("unknown schema 'no-such-schema'");
  });

  // The derivation stays the fallback, so untouched callers on the canonical
  // layout keep behaving exactly as before.
  it('derives the root from the change directory when none is passed', async () => {
    const canonicalChangeDir = path.join(
      projectRoot,
      'openspec',
      'changes',
      'canonical'
    );
    await fs.mkdir(canonicalChangeDir, { recursive: true });
    await fs.writeFile(
      path.join(canonicalChangeDir, '.openspec.yaml'),
      `schema: ${PLUGIN_SCHEMA}\nskip_specs: true\n`,
      'utf-8'
    );

    const marker = readSkipSpecsMarker(canonicalChangeDir);

    expect(marker.invalidReason).toBeUndefined();
    expect(marker.declared).toBe(true);
  });

  it('rejects a plugin schema when no root reaches the plugin', async () => {
    await writeMarker(PLUGIN_SCHEMA);

    const marker = readSkipSpecsMarker(changeDir);

    expect(marker.declared).toBe(false);
    expect(marker.invalidReason).toContain(`unknown schema '${PLUGIN_SCHEMA}'`);
  });
});
