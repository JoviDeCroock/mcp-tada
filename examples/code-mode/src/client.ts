// Code mode: instead of handing an LLM one function-calling tool per MCP tool, hand it a single
// `run_code` tool and a TypeScript declaration of the API it may call. The model writes a small
// program that calls several tools, filters and joins the results in the sandbox, and only the
// program's output goes back into the conversation. mcp-tada makes this cheap to set up:
//
// - the introspection snapshot `mcp-tada introspect` generated is the declaration the model reads;
// - `mcp.tools.<name>(args)` is the API the generated program calls, and it forwards to the SDK.
//
// Requires an Anthropic credential (ANTHROPIC_API_KEY or `ant auth login`).
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { initMcpTada } from "mcp-tada";
import type { introspection } from "./deepwiki.introspection.js";

const client = new Client({ name: "code-mode-example", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("https://mcp.deepwiki.com/mcp")));
const deepwiki = initMcpTada<introspection>().typed(client);

// 1. The API declaration the model programs against: the snapshot verbatim, plus the shape of
//    the `mcp` object it is bound to. Everything the model needs to know about argument names,
//    types, and structured results is already in the snapshot.
const snapshot = await readFile(new URL("./deepwiki.introspection.d.ts", import.meta.url), "utf8");
const apiDeclaration = `${snapshot}

// Bound in your program's scope. Each tool is an async method taking that tool's inputSchema
// as its single argument and resolving to its CallToolResult.
declare const mcp: {
  tools: {
    [N in keyof introspection["tools"]]: (args: FromInputSchema<N>) => Promise<{
      isError?: boolean;
      content: Array<{ type: "text"; text: string } | { type: string; [k: string]: unknown }>;
      structuredContent?: FromOutputSchema<N>; // typed from the tool's outputSchema, when declared
    }>;
  };
};
`;

const system = `You complete tasks by writing JavaScript that calls an MCP server through the \`mcp\` object.
Call the \`run_code\` tool with an async program body. \`mcp\` and \`console\` are in scope; the value
of the last expression, or an explicit \`return\`, is sent back to you along with anything logged.
Prefer one program that makes every call it needs and returns only the data you want to see;
do not echo large tool results back. The API is declared below.

${apiDeclaration}`;

// 2. One tool. Its schema never changes when the MCP server gains or loses tools.
const runCodeTool: Anthropic.Tool = {
  name: "run_code",
  description: "Run an async JavaScript program body against the declared `mcp` API.",
  input_schema: {
    type: "object",
    properties: { code: { type: "string", description: "The program body to execute." } },
    required: ["code"],
    additionalProperties: false,
  },
  strict: true,
};

// 3. The sandbox. Only `mcp.tools` is exposed, never the SDK client, so a program can call
//    tools and nothing else. `node:vm` isolates scope, not privileges: for untrusted models or
//    multi-tenant use, run this inside a real sandbox (isolated-vm, a worker, a container).
async function runCode(code: string): Promise<string> {
  const logs: string[] = [];
  const context = vm.createContext({
    mcp: { tools: deepwiki.tools },
    console: { log: (...args: unknown[]) => logs.push(args.map(String).join(" ")) },
  });
  try {
    const fn = vm.runInContext(`(async () => {\n${code}\n})`, context, { timeout: 1000 });
    const value = await fn();
    const output = value === undefined ? "" : JSON.stringify(value, null, 2);
    return [logs.join("\n"), output].filter(Boolean).join("\n");
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// 4. A plain agent loop. Each turn the model either writes more code or answers.
const anthropic = new Anthropic();
const messages: Anthropic.MessageParam[] = [
  {
    role: "user",
    content:
      "For the repositories 0no-co/gql.tada and 0no-co/urql, list the top-level wiki sections " +
      "each one has, then tell me which sections they have in common.",
  },
];

while (true) {
  const response = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: [runCodeTool],
    messages,
  });
  messages.push({ role: "assistant", content: response.content });

  if (response.stop_reason === "refusal") {
    console.error("refused:", response.stop_details?.explanation);
    break;
  }
  if (response.stop_reason !== "tool_use") {
    for (const block of response.content) if (block.type === "text") console.log(block.text);
    break;
  }

  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const block of response.content) {
    if (block.type !== "tool_use" || block.name !== "run_code") continue;
    const { code } = block.input as { code: string };
    console.log("--- model wrote ---\n" + code + "\n--- output ---");
    const output = await runCode(code);
    console.log(output || "(no output)");
    results.push({ type: "tool_result", tool_use_id: block.id, content: output || "(no output)" });
  }
  messages.push({ role: "user", content: results });
}

await client.close();
