export {
  defineTool,
  defineTools,
  isWrappedToolReturn,
  type AnyToolDefinition,
  type DeepMutable,
  type IntrospectionOf,
  type StructuredToolReturn,
  type ToolDefinition,
  type ToolExtra,
  type ToolHandler,
  type UnstructuredToolReturn,
} from "./define.js";
export { registerTools, type RegisterToolsOptions } from "./register.js";
export { validate, type ValidationError } from "./validate.js";
export type { FromSchema } from "mcp-tada";
