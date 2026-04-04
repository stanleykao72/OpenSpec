/**
 * New Change Command
 *
 * Creates a new change directory with optional description and schema.
 */

import ora from 'ora';
import path from 'path';
import { createChange, validateChangeName, getChangesDir } from '../../utils/change-utils.js';
import { validateSchemaExists } from './shared.js';
import { VALID_CHANGE_CLASSES, type ChangeClass } from '../../core/artifact-graph/types.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface NewChangeOptions {
  description?: string;
  schema?: string;
  class?: string;
}

// -----------------------------------------------------------------------------
// Command Implementation
// -----------------------------------------------------------------------------

export async function newChangeCommand(name: string | undefined, options: NewChangeOptions): Promise<void> {
  if (!name) {
    throw new Error('Missing required argument <name>');
  }

  const validation = validateChangeName(name);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const projectRoot = process.cwd();

  // Validate schema if provided
  if (options.schema) {
    validateSchemaExists(options.schema, projectRoot);
  }

  // Validate class if provided
  let changeClass: ChangeClass | undefined;
  if (options.class) {
    if (!VALID_CHANGE_CLASSES.includes(options.class as ChangeClass)) {
      throw new Error(
        `Invalid change class '${options.class}'. Must be one of: ${VALID_CHANGE_CLASSES.join(', ')}`
      );
    }
    changeClass = options.class as ChangeClass;
  }

  const schemaDisplay = options.schema ? ` with schema '${options.schema}'` : '';
  const classDisplay = changeClass ? ` [${changeClass}]` : '';
  const spinner = ora(`Creating change '${name}'${schemaDisplay}${classDisplay}...`).start();

  try {
    const result = await createChange(projectRoot, name, { schema: options.schema, changeClass });

    // If description provided, create README.md with description
    if (options.description) {
      const { promises: fs } = await import('fs');
      const changeDir = path.join(getChangesDir(projectRoot), name);
      const readmePath = path.join(changeDir, 'README.md');
      await fs.writeFile(readmePath, `# ${name}\n\n${options.description}\n`, 'utf-8');
    }

    const relativeDir = path.relative(projectRoot, path.join(getChangesDir(projectRoot), name));
    spinner.succeed(`Created change '${name}' at ${relativeDir}/ (schema: ${result.schema})`);
  } catch (error) {
    spinner.fail(`Failed to create change '${name}'`);
    throw error;
  }
}
