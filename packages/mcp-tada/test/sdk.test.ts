import { afterEach, describe, expect, it, vi } from "vitest";
import { detectSdk, loadSdk, SDK_ENV, SDKS } from "../src/cli/sdk.js";

// Both SDKs are installed in this workspace, so the loader can be steered explicitly; the
// "neither installed" rejection is exercised end to end in the packed-tarball dogfood, since it
// needs an environment where the packages are genuinely absent.
describe("loadSdk", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers v2 when both SDKs are installed", async () => {
    expect(detectSdk()).toBe(SDKS.v2);
    expect((await loadSdk()).choice).toBe("v2");
  });

  it("loads v1 on request and builds a client that satisfies the CLI surface", async () => {
    const sdk = await loadSdk("v1");
    expect(sdk.choice).toBe("v1");
    const client = sdk.createClient({ name: "t", version: "0.0.0" });
    expect(typeof client.connect).toBe("function");
    expect(typeof client.callTool).toBe("function");
    // Not connected yet: no capabilities, no version.
    expect(client.getServerCapabilities()).toBeUndefined();
    expect(client.getServerVersion()).toBeUndefined();
  });

  it(`honours ${SDK_ENV}, and rejects a value that is neither v1 nor v2`, async () => {
    vi.stubEnv(SDK_ENV, "v1");
    expect((await loadSdk()).choice).toBe("v1");
    vi.stubEnv(SDK_ENV, "v2");
    expect((await loadSdk()).choice).toBe("v2");
    vi.stubEnv(SDK_ENV, "");
    expect((await loadSdk()).choice).toBe("v2");
    vi.stubEnv(SDK_ENV, "V1");
    await expect(loadSdk()).rejects.toThrow(/MCP_TADA_SDK="V1" is not "v1" or "v2"/);
  });

  it("classifies each SDK's own timeout and 4xx errors, and not the other's", async () => {
    const v1 = await loadSdk("v1");
    const v2 = await loadSdk("v2");
    const { McpError, ErrorCode } = await import("@modelcontextprotocol/sdk/types.js");
    const { SdkError, SdkErrorCode, SdkHttpError } = await import("@modelcontextprotocol/client");
    const { StreamableHTTPError } =
      await import("@modelcontextprotocol/sdk/client/streamableHttp.js");

    const v1Timeout = new McpError(ErrorCode.RequestTimeout, "slow");
    const v2Timeout = new SdkError(SdkErrorCode.RequestTimeout, "slow");
    expect(v1.isTimeoutError(v1Timeout)).toBe(true);
    expect(v2.isTimeoutError(v2Timeout)).toBe(true);
    expect(v1.isTimeoutError(v2Timeout)).toBe(false);
    expect(v2.isTimeoutError(v1Timeout)).toBe(false);
    // A plain aborted fetch counts on both.
    const aborted = new DOMException("aborted", "AbortError");
    expect(v1.isTimeoutError(aborted)).toBe(true);
    expect(v2.isTimeoutError(aborted)).toBe(true);

    const http = (status: number, statusText: string) =>
      new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, statusText, { status, statusText });
    expect(v1.isLikelyClientError(new StreamableHTTPError(404, "nope"))).toBe(true);
    expect(v2.isLikelyClientError(http(404, "Not Found"))).toBe(true);
    expect(v2.isLikelyClientError(http(500, "Internal Server Error"))).toBe(false);
    expect(v1.isLikelyClientError(new Error("fetch failed"))).toBe(false);
    expect(v2.isLikelyClientError(new Error("fetch failed"))).toBe(false);
  });
});

describe.each(["v1", "v2"] as const)("%s stdio PID retention", (choice) => {
  it("retains the spawned PID after close", async () => {
    const sdk = await loadSdk(choice);
    const transport = sdk.stdioTransport({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      env: process.env as Record<string, string>,
    });
    try {
      await (transport as unknown as { start(): Promise<void> }).start();
      const pid = transport.pid;
      expect(pid).toBeTypeOf("number");
      expect(pid).toBeGreaterThan(0);
      expect(() => process.kill(pid!, 0)).not.toThrow();
      await transport.close();
      expect(transport.pid).toBe(pid);
    } finally {
      await transport.close();
    }
  });
});
