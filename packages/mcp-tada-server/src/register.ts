import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  type ContentBlock,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { isWrappedToolReturn, type AnyToolDefinition } from "./define.js";
import { validate, type ValidationError } from "./validate.js";

export type RegisterToolsOptions = {
  /**
   * When `true`, a handler's `structuredContent` is validated against the tool's `outputSchema`
   * before it goes on the wire; a mismatch returns `isError: true` with the validation errors
   * instead of sending bad data. Defaults to `false` (input is always validated regardless).
   */
  validateOutput?: boolean;
};

/**
 * Registers a record of `defineTool`/`defineTools` definitions on an `McpServer` or a plain
 * low-level `Server`.
 *
 * The SDK's high-level `McpServer.registerTool` only accepts Zod (or Standard Schema) input,
 * so passing plain JSON Schema through it and getting the exact same `inputSchema`/`outputSchema`
 * back on the wire is not possible (see `@modelcontextprotocol/sdk` 1.30's `AnySchema`, which is
 * `z3.ZodTypeAny | z4.$ZodType`, not raw JSON Schema). `registerTools` instead installs the
 * low-level `tools/list` and `tools/call` request handlers directly on the low-level server
 * (`server.server` when given an `McpServer`, or `server` itself when given a plain `Server`), so
 * the JSON Schema objects you wrote in `defineTool` are emitted verbatim.
 *
 * Because of that, when given an `McpServer`, `registerTools` owns the `tools/list`/`tools/call`
 * handlers on it: call it at most once per `McpServer`, and don't also call `server.registerTool`
 * / `server.tool` on the same instance, since the last handler installed wins. That caveat does
 * not apply when given a plain `Server`, which has no such high-level tool registration API.
 *
 * Call this before `connect()`-ing the server to a transport; registering capabilities after
 * connecting is rejected by the SDK.
 *
 * Incoming `arguments` are always validated against `inputSchema` before the handler runs; a
 * mismatch returns a tool result with `isError: true` listing the errors, rather than invoking
 * the handler with bad data or throwing a protocol-level error. A handler that throws is caught
 * the same way: the result carries `isError: true` and the error's message, not a JSON-RPC
 * error. Only an unknown tool name remains a protocol-level error, per the MCP spec.
 */
export function registerTools<Tools extends Record<string, AnyToolDefinition>>(
  server: Server | McpServer,
  tools: Tools,
  options: RegisterToolsOptions = {},
): void {
  const { validateOutput = false } = options;
  const byName = new Map<string, AnyToolDefinition>(Object.values(tools).map((t) => [t.name, t]));
  const lowLevel = resolveLowLevelServer(server);

  if (lowLevel.transport) {
    throw new Error(
      "registerTools: tools must be registered before calling connect() on the server " +
        "(registerCapabilities cannot be called after a transport is attached).",
    );
  }
  try {
    lowLevel.registerCapabilities({ tools: {} });
  } catch (cause) {
    throw new Error(
      "registerTools: tools must be registered before calling connect() on the server.",
      { cause },
    );
  }

  lowLevel.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Array.from(byName.values(), toWireTool),
  }));

  lowLevel.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const args = request.params.arguments ?? {};

    const inputErrors = validate(tool.inputSchema, args);
    if (inputErrors.length > 0) {
      return errorResult(`Invalid input for tool "${tool.name}"`, inputErrors);
    }

    let result: any;
    try {
      result = await tool.handler(args, extra);
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
      };
    }

    if (!tool.outputSchema) {
      return result;
    }

    let structuredContent: unknown;
    let content: ContentBlock[];
    let isError: boolean | undefined;

    if (isWrappedToolReturn(result)) {
      structuredContent = result.structuredContent;
      content = result.content ?? [textBlock(result.structuredContent)];
      isError = result.isError;
    } else {
      structuredContent = result;
      content = [textBlock(result)];
    }

    if (validateOutput && !isError) {
      const outputErrors = validate(tool.outputSchema, structuredContent);
      if (outputErrors.length > 0) {
        return errorResult(`Invalid output from tool "${tool.name}"`, outputErrors);
      }
    }

    return {
      structuredContent,
      content,
      ...(isError !== undefined ? { isError } : {}),
    };
  });
}

function resolveLowLevelServer(server: Server | McpServer): Server {
  return "server" in server ? server.server : server;
}

function errorResult(summary: string, errors: ValidationError[]) {
  const lines = errors.map((e) => `${e.path || "<root>"}: ${e.message}`);
  return {
    isError: true,
    content: [{ type: "text", text: `${summary}:\n${lines.join("\n")}` } satisfies ContentBlock],
  };
}

function textBlock(value: unknown): ContentBlock {
  return { type: "text", text: JSON.stringify(value) };
}

function toWireTool(def: AnyToolDefinition): Tool {
  return {
    name: def.name,
    ...(def.title !== undefined ? { title: def.title } : {}),
    ...(def.description !== undefined ? { description: def.description } : {}),
    inputSchema: def.inputSchema,
    ...(def.outputSchema !== undefined ? { outputSchema: def.outputSchema } : {}),
    ...(def.annotations !== undefined ? { annotations: def.annotations } : {}),
  } as Tool;
}
