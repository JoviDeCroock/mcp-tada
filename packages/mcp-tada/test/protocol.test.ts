import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { introspect } from "../src/cli/introspect.js";
import { runCheckWith, runDoctorWith, runIntrospectWith } from "../src/cli/main.js";
import { SDK_ENV } from "../src/cli/sdk.js";
import type { ProtocolMode, ServerTarget } from "../src/cli/connect.js";

const target: ServerTarget = {
  command: process.execPath,
  args: [fileURLToPath(new URL("./fixtures/protocol-server.mjs", import.meta.url))],
  timeoutMs: 3000,
};

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("protocol negotiation", () => {
  it.each<{ protocol?: ProtocolMode; version: string }>([
    { version: "2025-11-25" },
    { protocol: "legacy", version: "2025-11-25" },
    { protocol: "auto", version: "2026-07-28" },
    { protocol: "2026-07-28", version: "2026-07-28" },
  ])("negotiates $protocol as $version and collects every page", async ({ protocol, version }) => {
    vi.stubEnv(SDK_ENV, "v2");
    const result = await introspect({
      target: { ...target, ...(protocol !== undefined ? { protocol } : {}) },
      write: false,
    });
    expect(result.meta.protocolVersion).toBe(version);
    expect(Object.keys(result.data.tools)).toEqual(["first", "second"]);
    expect(Object.keys(result.data.prompts ?? {})).toEqual(["first-prompt", "second-prompt"]);
    expect(result.text).toContain(`// protocolVersion: ${version}`);
    if (version === "2026-07-28") {
      expect(result.meta).toMatchObject({ ttlMs: 1234, cacheScope: "public" });
      expect(result.text).toContain("// ttlMs: 1234");
      expect(result.text).toContain("// cacheScope: public");
    }
  });

  it("keeps v1 pagination and rejects unsupported negotiation before spawning", async () => {
    vi.stubEnv(SDK_ENV, "v1");
    const result = await introspect({ target, write: false });
    expect(Object.keys(result.data.tools)).toEqual(["first", "second"]);
    expect(Object.keys(result.data.prompts ?? {})).toEqual(["first-prompt", "second-prompt"]);
    for (const protocol of ["auto", "2026-07-28"]) {
      await expect(
        introspect({ target: { command: "does-not-exist", protocol }, write: false }),
      ).rejects.toThrow(/requires @modelcontextprotocol\/client/);
    }
  });

  it("honours config and flag precedence across introspect, check, and doctor", async () => {
    vi.stubEnv(SDK_ENV, "v2");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const dir = mkdtempSync(join(tmpdir(), "mcp-tada-protocol-"));
    dirs.push(dir);
    const config = join(dir, "config.json");
    const output = join(dir, "introspection.d.ts");
    const writeConfig = (protocol: string) =>
      writeFileSync(
        config,
        JSON.stringify({
          servers: { modern: { ...target, env: { MODERN_ONLY: "1" }, protocol, output } },
        }),
      );
    writeConfig("legacy");
    await expect(runIntrospectWith({ config })).rejects.toThrow();
    expect(await runIntrospectWith({ config, protocol: "auto" })).toBe(0);
    expect(readFileSync(output, "utf8")).toContain("// protocolVersion: 2026-07-28");
    await expect(runCheckWith({ config })).rejects.toThrow();
    expect(await runCheckWith({ config, protocol: "2026-07-28" })).toBe(0);
    expect(await runDoctorWith({ config, protocol: "auto" })).toBe(0);
    expect(await runDoctorWith({ config })).toBe(1);
    writeConfig("2026-07-28");
    expect(await runIntrospectWith({ config })).toBe(0);
    expect(await runCheckWith({ config })).toBe(0);
    expect(await runDoctorWith({ config })).toBe(0);
    expect(await runDoctorWith({ config, protocol: "legacy" })).toBe(1);
  });
});
