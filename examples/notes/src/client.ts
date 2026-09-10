// A typed client for the notes server. Every callTool below is checked against the snapshot in
// notes.introspection.d.ts, which `pnpm introspect` regenerates from the running server.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { initMcpTada } from "mcp-tada";
import type { IntrospectionOf } from "mcp-tada-server";
import type { introspection } from "./notes.introspection.js";
import type { tools } from "./tools.js";

// Both of these describe the same server. The snapshot is what you use for a server you do not
// own; IntrospectionOf is what you use when the definitions live in your own codebase.
type FromSnapshot = introspection;
type FromDefinitions = IntrospectionOf<typeof tools>;
const sameShape: FromSnapshot extends FromDefinitions ? true : false = true;
void sameShape;

const client = new Client({ name: "notes-example", version: "0.1.0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: [new URL("./server.js", import.meta.url).pathname],
    stderr: "pipe",
  }),
);
const notes = initMcpTada<introspection>().typed(client);

const added = await notes.callTool("add_note", { title: "Groceries", body: "Milk, eggs" });
if (added.isError) throw new Error("add_note failed");
console.log("added note", added.structuredContent.id, added.structuredContent.title);
//                                                ^ number                       ^ string

const missing = await notes.callTool("get_note", { id: 999 });
if (missing.isError) {
  console.log("get_note reported:", missing.content[0]?.type === "text" && missing.content[0].text);
}

// Every tool is also a method under `tools`, with the same types as callTool.
const all = await notes.tools.list_notes();
if (!all.isError)
  console.log(
    "stored notes:",
    all.structuredContent.notes.map((n) => n.title),
  );

const cleared = await notes.callTool("clear_notes");
console.log("clear_notes:", cleared.content[0]?.type === "text" && cleared.content[0].text);

// The type system rejects each of these. Uncomment one to see the error.
// await notes.callTool("add_note", { title: "no body" });
// await notes.callTool("get_note", { id: "1" });
// await notes.callTool("remove_note", { id: 1 });
// await notes.tools.add_note({ title: "no body" });

await client.close();
