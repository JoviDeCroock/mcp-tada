import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { candidateSources, init } from "../src/cli/init.js";
import { doctor, installedVersion, versionAtLeast } from "../src/cli/doctor.js";

const EVERYTHING_SERVER = resolve(
  "node_modules/@modelcontextprotocol/server-everything/dist/index.js",
);

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "mcp-tada-init-test-"));
}

describe("init", () => {
  it("imports a Claude Code .mcp.json and gives each server a snapshot under src", () => {
    const cwd = tmpDir();
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          everything: { command: "node", args: [EVERYTHING_SERVER], env: { API_TOKEN: "x" } },
          "remote api": { url: "https://example.com/mcp", headers: { Authorization: "Bearer y" } },
          broken: { disabled: true },
        },
      }),
    );
    const result = init({ cwd });
    expect(result.wrote).toBe(true);
    expect(result.source).toBe(join(cwd, ".mcp.json"));
    expect(result.config).toEqual({
      servers: {
        everything: {
          command: "node",
          args: [EVERYTHING_SERVER],
          env: { API_TOKEN: "x" },
          output: "src/everything.introspection.d.ts",
        },
        "remote api": {
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer y" },
          output: "src/remote-api.introspection.d.ts",
        },
      },
    });
    expect(result.warnings).toEqual([
      "everything: copied API_TOKEN verbatim; keep secrets out of a committed config",
      "remote api: copied Authorization verbatim; keep secrets out of a committed config",
      'broken: skipped, it has neither "command" nor "url"',
    ]);
    expect(JSON.parse(readFileSync(join(cwd, "mcp-tada.config.json"), "utf8"))).toEqual(
      result.config,
    );
    expect(() => init({ cwd })).toThrow("already exists");
    expect(init({ cwd, force: true }).wrote).toBe(false);
  });

  it("prefers project files over the desktop config, and reports what it looked for", () => {
    const cwd = tmpDir();
    const [first, , , desktop] = candidateSources(cwd, "darwin", "/home/x");
    expect(first).toBe(join(cwd, ".mcp.json"));
    expect(desktop).toBe("/home/x/Library/Application Support/Claude/claude_desktop_config.json");
    expect(() => init({ cwd, write: false })).toThrow(join(cwd, ".cursor", "mcp.json"));
    expect(existsSync(join(cwd, "mcp-tada.config.json"))).toBe(false);
  });

  it("imports a VS Code style file through --from without a src directory", () => {
    const cwd = tmpDir();
    writeFileSync(
      join(cwd, "servers.json"),
      JSON.stringify({ servers: { fs: { type: "stdio", command: "npx", args: ["-y", "x"] } } }),
    );
    const result = init({ cwd, from: "servers.json", write: false });
    expect(result.config.servers["fs"]?.output).toBe("fs.introspection.d.ts");
    expect(result.warnings).toEqual([]);
  });
});

describe("doctor", () => {
  it("compares versions by major.minor.patch", () => {
    expect(versionAtLeast("1.30.0", "1.20.0")).toBe(true);
    expect(versionAtLeast("1.9.9", "1.20.0")).toBe(false);
    expect(versionAtLeast("7.0.2-beta", "5.4.0")).toBe(true);
    expect(installedVersion("@modelcontextprotocol/sdk", process.cwd())).toMatch(/^\d+\.\d+\.\d+/);
    expect(installedVersion("no-such-package", process.cwd())).toBeUndefined();
  });

  it("reports a missing config as a failure", async () => {
    const cwd = tmpDir();
    const result = await doctor({ cwd, connect: false });
    expect(result.ok).toBe(false);
    const byStatus = Object.fromEntries(result.checks.map((c) => [c.subject, c.status]));
    expect(byStatus["@modelcontextprotocol/sdk"]).toBe("fail");
    expect(byStatus["typescript"]).toBe("warn");
    expect(byStatus["mcp-tada.config.json"]).toBe("fail");
    expect(result.text).toContain("mcp-tada init");
  });

  it("checks packages, snapshots, duplicate outputs, and reachability", async () => {
    const cwd = tmpDir();
    const configPath = join(cwd, "mcp-tada.config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        servers: {
          everything: {
            command: "node",
            args: [EVERYTHING_SERVER],
            output: join(cwd, "everything.introspection.d.ts"),
          },
          dupA: { url: "https://127.0.0.1:9/mcp", output: join(cwd, "dup.d.ts"), timeoutMs: 2000 },
          dupB: { url: "https://127.0.0.1:9/mcp", output: join(cwd, "dup.d.ts"), timeoutMs: 2000 },
          corrupt: {
            url: "https://127.0.0.1:9/mcp",
            output: join(cwd, "corrupt.d.ts"),
            timeoutMs: 2000,
          },
        },
      }),
    );
    // A snapshot a formatter has unquoted is exactly what the parser must reject.
    writeFileSync(join(cwd, "corrupt.d.ts"), "export type introspection = { tools: {} };\n");

    const result = await doctor({ cwd: process.cwd(), configPath });
    const bySubject = (subject: string) => result.checks.filter((c) => c.subject === subject);
    const one = (subject: string) => {
      const found = bySubject(subject);
      expect(found).toHaveLength(1);
      return found[0];
    };
    expect(one("@modelcontextprotocol/sdk")?.status).toBe("ok");
    expect(one("typescript")?.status).toBe("ok");
    expect(bySubject("mcp-tada.config.json")).toEqual([]);
    expect(one(configPath)?.detail).toBe("4 servers");
    expect(one("dupA, dupB")?.status).toBe("fail");
    expect(bySubject("corrupt").map((c) => c.status)).toEqual(["fail", "fail"]);
    expect(bySubject("corrupt")[0]?.detail).toContain("cannot be read back");
    expect(bySubject("dupA").map((c) => c.status)).toEqual(["warn", "fail"]);
    expect(bySubject("dupA")[1]?.detail).toContain("unreachable");
    expect(result.ok).toBe(false);

    const everything = result.checks.filter((c) => c.subject === "everything");
    expect(everything.map((c) => c.status)).toEqual(["warn", "ok"]);
    expect(everything[0]?.detail).toContain("not found");
    expect(everything[1]?.detail).toMatch(/^reachable: .*everything@\S+, \d+ tools$/);
  }, 60_000);
});
