import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  type ContentBlock,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { isWrappedToolReturn, type AnyToolDefinition } from "./define.js";

/**
 * Registers a record of `defineTool`/`defineTools` definitions on an `McpServer`.
 *
 * The SDK's high-level `McpServer.registerTool` only accepts Zod (or Standard Schema) input,
 * so passing plain JSON Schema through it and getting the exact same `inputSchema`/`outputSchema`
 * back on the wire is not possible (see `@modelcontextprotocol/sdk` 1.30's `AnySchema`, which is
 * `z3.ZodTypeAny | z4.$ZodType`, not raw JSON Schema). `registerTools` instead installs the
 * low-level `tools/list` and `tools/call` request handlers directly on `server.server`, so the
 * JSON Schema objects you wrote in `defineTool` are emitted verbatim.
 *
 * Because of that, `registerTools` owns the `tools/list`/`tools/call` handlers on the given
 * server: call it at most once per `McpServer`, and don't also call `server.registerTool` /
 * `server.tool` on the same instance, since the last handler installed wins.
 */
export function registerTools<Tools extends Record<string, AnyToolDefinition>>(
  server: McpServer,
  tools: Tools,
): void {
  const byName = new Map<string, AnyToolDefinition>(Object.values(tools).map((t) => [t.name, t]));
  const lowLevel = server.server;

  lowLevel.registerCapabilities({ tools: {} });

  lowLevel.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Array.from(byName.values(), toWireTool),
  }));

  lowLevel.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const args = request.params.arguments ?? {};
    const result = await tool.handler(args, extra);

    if (!tool.outputSchema) {
      return result;
    }

    if (isWrappedToolReturn(result)) {
      const content: ContentBlock[] = result.content ?? [textBlock(result.structuredContent)];
      return {
        structuredContent: result.structuredContent,
        content,
        ...(result.isError !== undefined ? { isError: result.isError } : {}),
      };
    }

    return {
      structuredContent: result,
      content: [textBlock(result)],
    };
  });
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
