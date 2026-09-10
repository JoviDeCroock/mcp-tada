import { initMcpTada } from "./tada.js";
import type { introspection } from "./introspection.js";
declare const client: import("@modelcontextprotocol/sdk/client/index.js").Client;

const mcp = initMcpTada<introspection>().typed(client);

// ✅ good calls
const r1 = await mcp.callTool("get-structured-content", { location: "Chicago" });
const temp: number = r1.structuredContent.temperature;        // typed from outputSchema
const r2 = await mcp.callTool("get-sum", { a: 1, b: 2 });
const none: undefined = r2.structuredContent;                  // no outputSchema → undefined

// ❌ expected errors
// @ts-expect-error unknown tool
await mcp.callTool("nope", {});
// @ts-expect-error missing b
await mcp.callTool("get-sum", { a: 1 });
// @ts-expect-error wrong type
await mcp.callTool("echo", { message: 42 });
// @ts-expect-error number not string
const bad: string = r1.structuredContent.humidity;
