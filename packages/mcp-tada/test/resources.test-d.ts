import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expectTypeOf, test } from "vitest";
import { initMcpTada, readOnly } from "../src/index.js";
import type {
  HasNoRequiredTemplateVars,
  PickTools,
  ResourceMimeType,
  ResourceTemplateNames,
  ResourceTemplateParams,
  ResourceUris,
  UriTemplateParams,
} from "../src/index.js";
import { mockMcpTada } from "../src/testing.js";
import type { introspection } from "./fixtures/everything.introspection.d.ts";

declare const client: Client;
const mcp = initMcpTada<introspection>().typed(client);

describe("UriTemplateParams", () => {
  test("simple, reserved, fragment, label, path, and path-style variables are required", () => {
    expectTypeOf<UriTemplateParams<"file:///{path}">>().toEqualTypeOf<{ path: string }>();
    expectTypeOf<UriTemplateParams<"{+base}/{#frag}{.ext}{/dir}{;p}">>().toEqualTypeOf<{
      base: string;
      frag: string;
      ext: string;
      dir: string;
      p: string;
    }>();
  });

  test("query and continuation variables are optional", () => {
    expectTypeOf<UriTemplateParams<"repo://{owner}/{name}{?ref,path}{&raw}">>().toEqualTypeOf<{
      owner: string;
      name: string;
      ref?: string;
      path?: string;
      raw?: string;
    }>();
    expectTypeOf<HasNoRequiredTemplateVars<"repo://{owner}">>().toEqualTypeOf<false>();
    expectTypeOf<HasNoRequiredTemplateVars<"search:{?q,limit}">>().toEqualTypeOf<true>();
  });

  test("an exploded variable takes a list, a prefix modifier is stripped", () => {
    expectTypeOf<UriTemplateParams<"{/segments*}{?tags*}{name:3}">>().toEqualTypeOf<{
      segments: string | string[];
      name: string;
      tags?: string | string[];
    }>();
  });

  test("a template without variables needs nothing", () => {
    expectTypeOf<UriTemplateParams<"static://thing">>().toEqualTypeOf<{}>();
    expectTypeOf<HasNoRequiredTemplateVars<"static://thing">>().toEqualTypeOf<true>();
  });
});

describe("resource types from a snapshot", () => {
  test("ResourceUris and ResourceTemplateNames are the recorded keys", () => {
    expectTypeOf<ResourceTemplateNames<introspection>>().toEqualTypeOf<
      "Dynamic Blob Resource" | "Dynamic Text Resource"
    >();
    expectTypeOf<"demo://resource/static/document/architecture.md">().toExtend<
      ResourceUris<introspection>
    >();
  });

  test("ResourceTemplateParams comes from the template string", () => {
    expectTypeOf<ResourceTemplateParams<introspection, "Dynamic Text Resource">>().toEqualTypeOf<{
      resourceId: string;
    }>();
  });

  test("ResourceMimeType is the recorded literal, or string for an unknown URI", () => {
    expectTypeOf<
      ResourceMimeType<introspection, "demo://resource/static/document/architecture.md">
    >().toEqualTypeOf<"text/markdown">();
    expectTypeOf<ResourceMimeType<introspection, "urn:anything">>().toEqualTypeOf<string>();
  });

  test("a snapshot without resources has no URIs or template names", async () => {
    type Legacy = { tools: { echo: { inputSchema: { type: "object" } } } };
    expectTypeOf<ResourceUris<Legacy>>().toEqualTypeOf<never>();
    expectTypeOf<ResourceTemplateNames<Legacy>>().toEqualTypeOf<never>();
    const legacy = initMcpTada<Legacy>().typed(client);
    // Any URI is still readable; only its mimeType is unknown.
    const r = await legacy.readResource("urn:anything");
    expectTypeOf(r.contents[0]!.mimeType).toEqualTypeOf<string | undefined>();
    // @ts-expect-error nothing to expand
    await legacy.readResourceTemplate("anything", {});
  });
});

describe("readResource / readResourceTemplate", () => {
  test("a known URI narrows mimeType; an unknown one is accepted and stays string", async () => {
    const known = await mcp.readResource("demo://resource/static/document/architecture.md");
    expectTypeOf(known.contents[0]!.mimeType).toEqualTypeOf<"text/markdown" | undefined>();
    const item = known.contents[0]!;
    if ("text" in item) expectTypeOf(item.text).toEqualTypeOf<string>();

    const unknown = await mcp.readResource("demo://resource/from/a/tool/result");
    expectTypeOf(unknown.contents[0]!.mimeType).toEqualTypeOf<string | undefined>();
  });

  test("a template takes its parsed params and narrows on its mimeType", async () => {
    const r = await mcp.readResourceTemplate("Dynamic Text Resource", { resourceId: "1" });
    expectTypeOf(r.contents[0]!.mimeType).toEqualTypeOf<"text/plain" | undefined>();
    await mcp.readResourceTemplate("Dynamic Blob Resource", { resourceId: "1" }, { timeout: 5 });

    // @ts-expect-error missing resourceId
    await mcp.readResourceTemplate("Dynamic Text Resource", {});
    // @ts-expect-error params are required when a variable is
    await mcp.readResourceTemplate("Dynamic Text Resource");
    // @ts-expect-error unknown variable
    await mcp.readResourceTemplate("Dynamic Text Resource", { resourceId: "1", extra: "x" });
    // @ts-expect-error unknown template
    await mcp.readResourceTemplate("Nope", { resourceId: "1" });
  });

  test("readOnly and PickTools keep the snapshot's resources", async () => {
    const safe = readOnly(mcp);
    await safe.readResourceTemplate("Dynamic Text Resource", { resourceId: "1" });
    type Picked = PickTools<introspection, "get-sum">;
    expectTypeOf<ResourceTemplateNames<Picked>>().toEqualTypeOf<
      ResourceTemplateNames<introspection>
    >();
  });
});

describe("mockMcpTada resources", () => {
  test("handlers are typed by URI and template name", () => {
    mockMcpTada<introspection>({
      resources: {
        "demo://resource/static/document/architecture.md": {
          contents: [{ uri: "x", mimeType: "text/markdown", text: "# hi" }],
        },
        "urn:not-in-snapshot": { contents: [{ uri: "x", text: "" }] },
      },
      resourceTemplates: {
        "Dynamic Text Resource": ({ resourceId }) => {
          expectTypeOf(resourceId).toEqualTypeOf<string>();
          return { contents: [{ uri: `demo://${resourceId}`, mimeType: "text/plain", text: "" }] };
        },
      },
    });
    mockMcpTada<introspection>({
      resources: {
        "demo://resource/static/document/architecture.md": {
          // @ts-expect-error mimeType must match the snapshot
          contents: [{ uri: "x", mimeType: "text/html", text: "" }],
        },
      },
      // @ts-expect-error unknown template name
      resourceTemplates: { Nope: { contents: [] } },
    });
  });
});
