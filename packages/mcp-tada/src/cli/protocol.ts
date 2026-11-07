/** SDK v2 probes for modern servers; SDK v1 defaults to the legacy handshake. */
export type ProtocolMode = "auto" | "legacy" | (string & {});

export const DEFAULT_PROTOCOL_MODE: ProtocolMode = "auto";

export function versionNegotiationFor(
  mode: ProtocolMode = DEFAULT_PROTOCOL_MODE,
  timeoutMs = 1000,
): {
  mode: "auto" | "legacy" | { pin: string };
  probe?: { timeoutMs: number; maxRetries: number };
} {
  const probe = { timeoutMs: Math.min(1000, timeoutMs), maxRetries: 0 };
  if (mode === "auto") return { mode: "auto", probe };
  if (mode === "legacy") return { mode: "legacy" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mode)) {
    throw new Error(
      `Invalid protocol ${JSON.stringify(mode)}, expected "auto", "legacy", or a revision such as "2026-07-28"`,
    );
  }
  return { mode: { pin: mode }, probe };
}
