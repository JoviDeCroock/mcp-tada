// Programmatic surface of the CLI, published as `mcp-tada/cli`. Everything here is what
// `mcp-tada introspect` and `mcp-tada check` run, minus argv parsing, so a build script or test
// suite can drive the same code without shelling out. Kept off the main `mcp-tada` entry so that
// one stays free of `node:fs` and transport imports.
export {
  DEFAULT_TIMEOUT_MS,
  connectClient,
  describeTarget,
  loadConfig,
  type ConnectOptions,
  type ConnectedClient,
  type McpTadaConfig,
  type ServerConfigEntry,
  type ServerTarget,
} from "./connect.js";
export {
  buildIntrospectionData,
  collectWarnings,
  formatDts,
  formatJson,
  introspect,
  introspectTarget,
  toPromptSnapshot,
  toToolSnapshot,
  writeIfChanged,
  type FormatDtsOptions,
  type IntrospectMeta,
  type IntrospectOptions,
  type IntrospectRunResult,
  type IntrospectSource,
  type IntrospectWarnings,
} from "./introspect.js";
export {
  check,
  diffIntrospection,
  formatReport,
  type CheckOptions,
  type CheckReport,
  type CheckRunResult,
} from "./check.js";
export {
  detectFormat,
  parseDtsSnapshot,
  parseSnapshotText,
  type IntrospectionData,
  type PromptArgumentSnapshot,
  type PromptSnapshot,
  type SnapshotFormat,
  type ToolAnnotationsSnapshot,
  type ToolSnapshot,
} from "./snapshot.js";
