// Typed calls against published stdio servers, using the committed snapshots for the types and
// the servers' own outputSchema to validate what comes back at runtime.
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initMcpTada, readOnly } from "mcp-tada";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { introspection as Filesystem } from "../snapshots/filesystem.introspection.js";
import type { introspection as Memory } from "../snapshots/memory.introspection.js";
import {
  committedSnapshot,
  connectStdio,
  expectStructuredContentToMatch,
  FILESYSTEM_SERVER,
  MEMORY_SERVER,
} from "./helpers.js";

describe("@modelcontextprotocol/server-filesystem", () => {
  // realpath: the server reports resolved paths, and macOS puts tmpdir behind a symlink.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "mcp-tada-e2e-fs-")));
  const snapshot = committedSnapshot("filesystem");
  let client: Client;

  beforeAll(async () => {
    client = await connectStdio(FILESYSTEM_SERVER, [dir]);
  });
  afterAll(async () => {
    await client.close();
  });

  it("reads a file back through a typed call whose output matches the outputSchema", async () => {
    const fs = initMcpTada<Filesystem>().typed(client);
    writeFileSync(join(dir, "hello.txt"), "hello from e2e\n");

    const result = await fs.tools.read_text_file({ path: join(dir, "hello.txt") });
    expect(result.isError).not.toBe(true);
    if (result.isError) throw new Error("unexpected error");
    expect(result.structuredContent.content).toBe("hello from e2e\n");
    expectStructuredContentToMatch(snapshot, "read_text_file", result.structuredContent);

    const allowed = await fs.callTool("list_allowed_directories");
    if (allowed.isError) throw new Error("unexpected error");
    expect(allowed.structuredContent.content).toContain(dir);
    expectStructuredContentToMatch(snapshot, "list_allowed_directories", allowed.structuredContent);
  });

  it("readOnly hides every writing tool from the live list, matching the snapshot", async () => {
    const fs = initMcpTada<Filesystem>().typed(client);
    const live = (await readOnly(fs).listTools()).map((t) => t.name).sort();
    const recorded = Object.entries(snapshot.tools)
      .filter(([, t]) => t.annotations?.readOnlyHint === true)
      .map(([name]) => name)
      .sort();
    expect(live).toEqual(recorded);
    expect(live).toContain("read_text_file");
    expect(live).not.toContain("write_file");
    expect(live).not.toContain("edit_file");
  });

  it("surfaces an invalid path as an isError result, not a thrown error", async () => {
    const fs = initMcpTada<Filesystem>().typed(client);
    const result = await fs.tools.read_text_file({ path: "/definitely/not/allowed.txt" });
    expect(result.isError).toBe(true);
  });
});

describe("@modelcontextprotocol/server-memory", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-tada-e2e-memory-"));
  const snapshot = committedSnapshot("memory");
  let client: Client;

  beforeAll(async () => {
    // A fresh store per run, so entities from an earlier run cannot satisfy the assertions.
    client = await connectStdio(MEMORY_SERVER, [], {
      MEMORY_FILE_PATH: join(dir, "memory.jsonl"),
    });
  });
  afterAll(async () => {
    await client.close();
  });

  it("round-trips an entity through typed create and read calls", async () => {
    const memory = initMcpTada<Memory>().typed(client);
    const created = await memory.tools.create_entities({
      entities: [{ name: "mcp-tada", entityType: "library", observations: ["typed MCP client"] }],
    });
    if (created.isError) throw new Error("create_entities failed");
    expectStructuredContentToMatch(snapshot, "create_entities", created.structuredContent);

    const graph = await memory.tools.read_graph();
    if (graph.isError) throw new Error("read_graph failed");
    expectStructuredContentToMatch(snapshot, "read_graph", graph.structuredContent);
    expect(graph.structuredContent.entities.map((e) => e.name)).toEqual(["mcp-tada"]);
  });

  it("readOnly keeps exactly the three read tools", async () => {
    const memory = initMcpTada<Memory>().typed(client);
    const names = (await readOnly(memory).listTools()).map((t) => t.name).sort();
    expect(names).toEqual(["open_nodes", "read_graph", "search_nodes"]);
  });
});
