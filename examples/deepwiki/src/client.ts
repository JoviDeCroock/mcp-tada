// Client-only use against a public server you do not control. DeepWiki declares an outputSchema
// on every tool, so structuredContent is fully typed. The snapshot next to this file was written
// by `pnpm introspect`; `pnpm check` fails when DeepWiki changes a schema.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { initMcpTada } from "mcp-tada";
import type { introspection } from "./deepwiki.introspection.js";

const client = new Client({ name: "deepwiki-example", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("https://mcp.deepwiki.com/mcp")));
const deepwiki = initMcpTada<introspection>().typed(client);

// repoName is `string | string[]` here because the schema uses anyOf.
const structure = await deepwiki.callTool("read_wiki_structure", { repoName: "0no-co/gql.tada" });
if (structure.isError) {
  console.error("read_wiki_structure failed:", structure.content);
} else {
  const firstLines = structure.structuredContent.result.split("\n").slice(0, 8);
  //                                             ^ string, from outputSchema
  console.log(firstLines.join("\n"));
}

const answer = await deepwiki.callTool("ask_question", {
  repoName: ["0no-co/gql.tada"],
  question: "In one paragraph, how does gql.tada infer result types from a query string?",
});
if (!answer.isError) console.log("\n" + answer.structuredContent.result);

// Each of these is a compile error. Uncomment one to see it.
// await deepwiki.callTool("read_wiki_structure", { repo: "0no-co/gql.tada" });
// await deepwiki.callTool("ask_question", { repoName: "0no-co/gql.tada" });
// await deepwiki.callTool("search", { query: "x" });

await client.close();
