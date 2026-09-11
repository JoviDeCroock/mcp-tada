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
  type CheckChange,
  type CheckChangeKind,
  type CheckOptions,
  type CheckReport,
  type CheckRunResult,
  type Severity,
} from "./check.js";
export { compareSchemas, type SchemaChange, type SchemaDirection } from "./compat.js";
export {
  DEFAULT_CONFIG_PATH,
  candidateSources,
  init,
  type InitOptions,
  type InitResult,
} from "./init.js";
export {
  MIN_SDK_VERSION,
  MIN_TYPESCRIPT_VERSION,
  doctor,
  formatDoctorReport,
  installedVersion,
  versionAtLeast,
  type DoctorCheck,
  type DoctorOptions,
  type DoctorResult,
  type DoctorStatus,
} from "./doctor.js";
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
