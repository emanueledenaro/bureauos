export const VERSION = "0.0.0";

export { BureauConfigSchema } from "./config/schema.js";
export type {
  BureauConfig,
  Preset,
  AutonomyMode,
  ProviderName,
} from "./config/schema.js";
export { loadConfig, defaultConfig, ConfigError } from "./config/loader.js";
export { workspacePaths } from "./paths.js";
export type { WorkspacePaths } from "./paths.js";
export { newId, slugify } from "./ids.js";
export { AuditLog } from "./audit/log.js";
export type { AuditEvent, AuditEventInput } from "./audit/log.js";
export { initWorkspace, InitError } from "./init/initializer.js";
export type { InitOptions, InitResult } from "./init/initializer.js";
