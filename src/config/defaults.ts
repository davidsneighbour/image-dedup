import { type ImageOriginConfig, configSchema } from "./schema.js";

/**
 * Resolves the documented defaults (PLAN.md §4) for a given set of inputs.
 * Useful for tests, `--help` text, and printing the resolved configuration
 * in verbose mode when no config file is present.
 */
export function resolveDefaultConfig(inputs: string[]): ImageOriginConfig {
  return configSchema.parse({ inputs });
}
