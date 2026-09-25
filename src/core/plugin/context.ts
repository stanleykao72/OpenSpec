import { readProjectConfig } from '../project-config.js';
import { loadPlugins } from './loader.js';
import { validateAllPluginConfigs } from './config-validator.js';
import type { LoadedPlugin } from './types.js';

interface PluginLoadResult {
  plugins: LoadedPlugin[];
  /** Why part or all of the whitelist could not be loaded; null when all loaded. */
  failure: Error | null;
}

let cachedResult: PluginLoadResult | null = null;
let cachedProjectRoot: string | null = null;

function loadAndValidate(projectRoot: string): PluginLoadResult {
  const config = readProjectConfig(projectRoot);
  if (!config?.plugins || config.plugins.length === 0) {
    return { plugins: [], failure: null };
  }

  let loaded: LoadedPlugin[];
  try {
    loaded = loadPlugins(projectRoot, config.plugins);
  } catch (err) {
    return { plugins: [], failure: err instanceof Error ? err : new Error(String(err)) };
  }

  const validated = validateAllPluginConfigs(
    loaded,
    config.plugin_config as Record<string, unknown> | undefined
  );
  for (const err of validated.errors) {
    console.warn(`Plugin config: ${err}`);
  }

  const kept = new Set(validated.plugins.map((plugin) => plugin.manifest.name));
  const dropped = loaded.map((plugin) => plugin.manifest.name).filter((name) => !kept.has(name));
  const failure = dropped.length > 0
    ? new Error(
        `Whitelisted plugin(s) ${dropped.join(', ')} failed config validation: ${validated.errors.join('; ')}`
      )
    : null;
  return { plugins: validated.plugins, failure };
}

/**
 * Lazily load and cache plugins for the current project.
 * Returns empty array if no plugins configured.
 *
 * This avoids requiring every call site to manually load plugins.
 * Cache is invalidated if projectRoot changes.
 *
 * By default a whitelisted plugin that fails to load (not found, invalid
 * manifest, incompatible version) empties the list with a warning, and one
 * whose config fails validation is dropped with a warning, so read-only
 * commands keep working. `strict: true` throws instead: skill and command
 * generation uses it, because silently rendering without a whitelisted
 * plugin's overlays would overwrite its customised output with base text.
 * The failure is cached with the result, so a lenient call that ran first
 * cannot make a later strict call pass.
 */
export function getLoadedPlugins(
  projectRoot: string,
  options: { strict?: boolean } = {}
): LoadedPlugin[] {
  if (cachedResult === null || cachedProjectRoot !== projectRoot) {
    cachedResult = loadAndValidate(projectRoot);
    cachedProjectRoot = projectRoot;
    if (cachedResult.failure && cachedResult.plugins.length === 0) {
      console.warn(`Plugin loading failed: ${cachedResult.failure.message}`);
    }
  }

  if (cachedResult.failure && options.strict) {
    throw cachedResult.failure;
  }
  return cachedResult.plugins;
}

/**
 * Clear plugin cache (useful for testing).
 */
export function clearPluginCache(): void {
  cachedResult = null;
  cachedProjectRoot = null;
}
