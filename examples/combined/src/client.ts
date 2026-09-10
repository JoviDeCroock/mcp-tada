// Several public servers behind one typed client. Tool names are prefixed with the alias, so a
// `search` on two servers never collides, and the prefixed list can be handed to an LLM as is.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { combineMcpTada, initMcpTada } from "mcp-tada";
import type { introspection as Cloudflare } from "./cloudflare.introspection.js";
import type { introspection as Context7 } from "./context7.introspection.js";
import type { introspection as DeepWiki } from "./deepwiki.introspection.js";

async function connect(url: string) {
  const client = new Client({ name: "combined-example", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

const [deepwikiClient, cloudflareClient, context7Client] = await Promise.all([
  connect("https://mcp.deepwiki.com/mcp"),
  connect("https://docs.mcp.cloudflare.com/mcp"),
  connect("https://mcp.context7.com/mcp"),
]);

const docs = combineMcpTada({
  deepwiki: initMcpTada<DeepWiki>().typed(deepwikiClient),
  cloudflare: initMcpTada<Cloudflare>().typed(cloudflareClient),
  context7: initMcpTada<Context7>().typed(context7Client),
});

// One flat, prefixed tool list across all three servers, paged and ready for an LLM.
const tools = await docs.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

// Typed output: results is an array of { title, url, ... } from Cloudflare's outputSchema.
const cf = await docs.callTool("cloudflare__search_cloudflare_documentation", {
  query: "Durable Objects alarms",
});
if (!cf.isError) {
  for (const hit of cf.structuredContent.results.slice(0, 3)) console.log("-", hit.title, hit.url);
}

// Context7 declares no outputSchema, so structuredContent is `unknown` and content is what you use.
const lib = await docs.callTool("context7__resolve-library-id", {
  libraryName: "gql.tada",
  query: "typed GraphQL documents",
});
const first = lib.content[0];
if (first?.type === "text")
  console.log("\ncontext7:", first.text.split("\n").slice(0, 4).join("\n"));

// Route an LLM's tool call back to the right server.
console.log("\nsplit:", docs.split("deepwiki__read_wiki_structure"));

// Compile errors, one per line:
// await docs.callTool("cloudflare__search", { query: "x" });
// await docs.callTool("deepwiki__ask_question", { question: "x" });

await Promise.all([deepwikiClient.close(), cloudflareClient.close(), context7Client.close()]);
