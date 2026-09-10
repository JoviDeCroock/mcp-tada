// Typed calls against public Streamable HTTP servers: typed outputs where the server declares
// an outputSchema, a real prompt, and several servers behind one combined client.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { combineMcpTada, initMcpTada } from "mcp-tada";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { introspection as Cloudflare } from "../snapshots/cloudflare.introspection.js";
import type { introspection as Context7 } from "../snapshots/context7.introspection.js";
import type { introspection as DeepWiki } from "../snapshots/deepwiki.introspection.js";
import { committedSnapshot, connectHttp, expectStructuredContentToMatch } from "./helpers.js";

let deepwiki: Client;
let cloudflare: Client;
let context7: Client;

beforeAll(async () => {
  [deepwiki, cloudflare, context7] = await Promise.all([
    connectHttp("https://mcp.deepwiki.com/mcp"),
    connectHttp("https://docs.mcp.cloudflare.com/mcp"),
    connectHttp("https://mcp.context7.com/mcp"),
  ]);
});
afterAll(async () => {
  await Promise.all([deepwiki.close(), cloudflare.close(), context7.close()]);
});

describe("DeepWiki", () => {
  it("types read_wiki_structure from its outputSchema and the data validates", async () => {
    const wiki = initMcpTada<DeepWiki>().typed(deepwiki);
    const result = await wiki.tools.read_wiki_structure({ repoName: "0no-co/gql.tada" });
    if (result.isError) throw new Error("read_wiki_structure failed");
    expect(result.structuredContent.result).toBeTypeOf("string");
    expectStructuredContentToMatch(
      committedSnapshot("deepwiki"),
      "read_wiki_structure",
      result.structuredContent,
    );
  });
});

describe("Cloudflare docs", () => {
  it("types search results from the outputSchema and the data validates", async () => {
    const docs = initMcpTada<Cloudflare>().typed(cloudflare);
    const result = await docs.tools.search_cloudflare_documentation({
      query: "Durable Objects alarms",
    });
    if (result.isError) throw new Error("search failed");
    expect(result.structuredContent.results.length).toBeGreaterThan(0);
    expect(result.structuredContent.results[0]?.url).toMatch(/^https:\/\//);
    expectStructuredContentToMatch(
      committedSnapshot("cloudflare"),
      "search_cloudflare_documentation",
      result.structuredContent,
    );
  });

  it("gets a real prompt through the typed getPrompt", async () => {
    const docs = initMcpTada<Cloudflare>().typed(cloudflare);
    const prompt = await docs.getPrompt("workers-prompt-full");
    expect(prompt.messages.length).toBeGreaterThan(0);
    expect((await docs.listPrompts()).map((p) => p.name)).toContain("workers-prompt-full");
  });
});

describe("Context7", () => {
  it("leaves structuredContent unknown when the server declares no outputSchema", async () => {
    const ctx = initMcpTada<Context7>().typed(context7);
    const result = await ctx.tools["resolve-library-id"]({
      libraryName: "gql.tada",
      query: "typed GraphQL documents",
    });
    expect(result.content.length).toBeGreaterThan(0);
    expect(committedSnapshot("context7").tools["resolve-library-id"]?.outputSchema).toBeUndefined();
  });
});

describe("combined", () => {
  it("lists every server's tools with its prefix and routes calls back", async () => {
    const combined = combineMcpTada({
      deepwiki: initMcpTada<DeepWiki>().typed(deepwiki),
      cloudflare: initMcpTada<Cloudflare>().typed(cloudflare),
      context7: initMcpTada<Context7>().typed(context7),
    });
    const names = (await combined.listTools()).map((t) => t.name);
    expect(names).toContain("deepwiki__read_wiki_structure");
    expect(names).toContain("cloudflare__search_cloudflare_documentation");
    expect(names).toContain("context7__resolve-library-id");
    expect(combined.split("deepwiki__read_wiki_structure")).toEqual({
      server: "deepwiki",
      tool: "read_wiki_structure",
    });

    const result = await combined.callTool("cloudflare__search_cloudflare_documentation", {
      query: "Workers KV",
    });
    if (result.isError) throw new Error("combined call failed");
    expect(result.structuredContent.results.length).toBeGreaterThan(0);
  });
});
