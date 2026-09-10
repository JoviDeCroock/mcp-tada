// What the committed snapshots of real servers derive at the type level. These run under
// vitest's typecheck mode and need no network; they pin the shape the runtime tests rely on.
import { describe, expectTypeOf, test } from "vitest";
import type {
  NonDestructiveToolNames,
  PromptArgs,
  PromptNames,
  ReadOnlyToolNames,
  ToolArgs,
  ToolOutput,
} from "mcp-tada";
import type { introspection as Cloudflare } from "../snapshots/cloudflare.introspection.js";
import type { introspection as Context7 } from "../snapshots/context7.introspection.js";
import type { introspection as DeepWiki } from "../snapshots/deepwiki.introspection.js";
import type { introspection as Filesystem } from "../snapshots/filesystem.introspection.js";
import type { introspection as Memory } from "../snapshots/memory.introspection.js";

describe("filesystem", () => {
  test("annotations separate the read tools from the write tools", () => {
    expectTypeOf<"read_text_file">().toMatchTypeOf<ReadOnlyToolNames<Filesystem>>();
    expectTypeOf<"list_directory">().toMatchTypeOf<ReadOnlyToolNames<Filesystem>>();
    expectTypeOf<"write_file">().not.toMatchTypeOf<ReadOnlyToolNames<Filesystem>>();
    expectTypeOf<"edit_file">().not.toMatchTypeOf<ReadOnlyToolNames<Filesystem>>();
  });

  test("outputs are typed from outputSchema, closed as declared", () => {
    expectTypeOf<ToolOutput<Filesystem, "read_text_file">["content"]>().toEqualTypeOf<string>();
    expectTypeOf<ToolArgs<Filesystem, "read_text_file">>().toMatchTypeOf<{ path: string }>();
  });
});

describe("memory", () => {
  test("exactly three read-only tools", () => {
    expectTypeOf<ReadOnlyToolNames<Memory>>().toEqualTypeOf<
      "open_nodes" | "read_graph" | "search_nodes"
    >();
    expectTypeOf<"create_entities">().toMatchTypeOf<NonDestructiveToolNames<Memory>>();
  });

  test("read_graph returns typed entities", () => {
    expectTypeOf<
      ToolOutput<Memory, "read_graph">["entities"][number]["name"]
    >().toEqualTypeOf<string>();
  });
});

describe("remote servers", () => {
  test("DeepWiki wraps every result in { result: string }", () => {
    expectTypeOf<ToolOutput<DeepWiki, "read_wiki_structure">["result"]>().toEqualTypeOf<string>();
    expectTypeOf<ReadOnlyToolNames<DeepWiki>>().toEqualTypeOf<never>(); // no annotations sent
  });

  test("Cloudflare declares one prompt with no arguments", () => {
    expectTypeOf<PromptNames<Cloudflare>>().toEqualTypeOf<"workers-prompt-full">();
    expectTypeOf<PromptArgs<Cloudflare, "workers-prompt-full">>().toEqualTypeOf<{} & {}>();
    expectTypeOf<
      ToolOutput<Cloudflare, "search_cloudflare_documentation">["results"][number]["url"]
    >().toEqualTypeOf<string>();
  });

  test("Context7 offers the prompts capability but lists none, and no output schemas", () => {
    expectTypeOf<PromptNames<Context7>>().toEqualTypeOf<never>();
    expectTypeOf<ToolOutput<Context7, "resolve-library-id">>().toEqualTypeOf<unknown>();
  });
});
