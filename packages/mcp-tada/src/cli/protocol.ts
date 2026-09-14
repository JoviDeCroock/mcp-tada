/** Protocol negotiation for CLI connections. Legacy avoids probing on each invocation. */
export type ProtocolMode = "auto" | "legacy" | (string & {});

export const DEFAULT_PROTOCOL_MODE: ProtocolMode = "legacy";

export function versionNegotiationFor(mode: ProtocolMode = DEFAULT_PROTOCOL_MODE): {
  mode: "auto" | "legacy" | { pin: string };
} {
  if (mode === "auto") return { mode: "auto" };
  if (mode === "legacy") return { mode: "legacy" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mode)) {
    throw new Error(
      `Invalid protocol ${JSON.stringify(mode)}, expected "auto", "legacy", or a revision such as "2026-07-28"`,
    );
  }
  return { mode: { pin: mode } };
}
