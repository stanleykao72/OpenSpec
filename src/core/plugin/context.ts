import { readPluginWhitelist, readProjectConfig } from '../project-config.js';
import { loadPlugins } from './loader.js';
import { validateAllPluginConfigs } from './config-validator.js';
import type { LoadedPlugin } from './types.js';

interface PluginLoadResult {
  plugins: LoadedPlugin[];
  /** Why part or all of the whitelist could not be loaded; null when all loaded. */
  failure: Error | null;
  /** A plugin failed to load (warned once); whitelist problems are warned by the config parser. */
  loadFailed?: boolean;
}

let cachedResult: PluginLoadResult | null = null;
let cachedProjectRoot: string | null = null;

function loadAndValidate(projectRoot: string): PluginLoadResult {
  // The whitelist is read strictly so that a corrupt config.yaml (unreadable,
  // not YAML, `plugins` not a list, a bad entry) is a failure, not "no
  // plugins". The lenient path still loads the valid entries, as before.
  const whitelist = readPluginWhitelist(projectRoot);
  const whitelistFailure = whitelist.problem
    ? new Error(`Plugin whitelist cannot be trusted: ${whitelist.problem}`)
    : null;
  if (whitelist.plugins.length === 0) {
    return { plugins: [], failure: whitelistFailure };
  }
  const config = readProjectConfig(projectRoot);

  let loaded: LoadedPlugin[];
  try {
    loaded = loadPlugins(projectRoot, whitelist.plugins);
  } catch (err) {
    return {
      plugins: [],
      failure: whitelistFailure ?? (err instanceof Error ? err : new Error(String(err))),
      loadFailed: true,
    };
  }

  const validated = validateAllPluginConfigs(
    loaded,
    config?.plugin_config as Record<string, unknown> | undefined
  );
  for (const err of validated.errors) {
    console.warn(`Plugin config: ${err}`);
  }

  const kept = new Set(validated.plugins.map((plugin) => plugin.manifest.name));
  const dropped = loaded.map((plugin) => plugin.manifest.name).filter((name) => !kept.has(name));
  const failure = whitelistFailure ?? (dropped.length > 0
    ? new Error(
        `Whitelisted plugin(s) ${dropped.join(', ')} failed config validation: ${validated.errors.join('; ')}`
      )
    : null);
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
    if (cachedResult.loadFailed && cachedResult.failure) {
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
