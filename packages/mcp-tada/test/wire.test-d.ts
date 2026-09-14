// The structural wire types in `src/wire.ts` stand in for the SDK's own, so both SDKs' types
// must be assignable to them in the direction mcp-tada uses them: a `Client` of either SDK
// satisfies `ClientLike`, what the SDK returns fits what mcp-tada hands back, and what a caller
// passes as request options fits what mcp-tada forwards.
import type * as V2 from "@modelcontextprotocol/client";
import type { Client as ClientV1 } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions as RequestOptionsV1 } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type * as V1 from "@modelcontextprotocol/sdk/types.js";
import { describe, expectTypeOf, test } from "vitest";
import type {
  ClientLike,
  ContentBlock,
  GetPromptResult,
  Prompt,
  RequestOptions,
  Tool,
  ToolAnnotations,
} from "../src/index.js";

describe("SDK v2 (@modelcontextprotocol/client) fits the wire types", () => {
  test("Client satisfies ClientLike", () => {
    expectTypeOf<V2.Client>().toMatchTypeOf<ClientLike>();
  });
  test("results and list entries are assignable", () => {
    expectTypeOf<V2.Tool>().toMatchTypeOf<Tool>();
    expectTypeOf<V2.ToolAnnotations>().toMatchTypeOf<ToolAnnotations>();
    expectTypeOf<V2.Prompt>().toMatchTypeOf<Prompt>();
    expectTypeOf<V2.GetPromptResult>().toMatchTypeOf<GetPromptResult>();
    expectTypeOf<V2.ContentBlock>().toMatchTypeOf<ContentBlock>();
    expectTypeOf<V2.CallToolResult["content"]>().toMatchTypeOf<ContentBlock[]>();
  });
  test("request options a caller passes are accepted", () => {
    expectTypeOf<V2.RequestOptions>().toMatchTypeOf<RequestOptions>();
  });
});

describe("SDK v1 (@modelcontextprotocol/sdk) fits the wire types", () => {
  test("Client satisfies ClientLike", () => {
    expectTypeOf<ClientV1>().toMatchTypeOf<ClientLike>();
  });
  test("results and list entries are assignable", () => {
    expectTypeOf<V1.Tool>().toMatchTypeOf<Tool>();
    expectTypeOf<V1.ToolAnnotations>().toMatchTypeOf<ToolAnnotations>();
    expectTypeOf<V1.Prompt>().toMatchTypeOf<Prompt>();
    expectTypeOf<V1.GetPromptResult>().toMatchTypeOf<GetPromptResult>();
    expectTypeOf<V1.ContentBlock>().toMatchTypeOf<ContentBlock>();
    expectTypeOf<V1.CallToolResult["content"]>().toMatchTypeOf<ContentBlock[]>();
  });
  test("request options a caller passes are accepted", () => {
    expectTypeOf<RequestOptionsV1>().toMatchTypeOf<RequestOptions>();
  });
});
