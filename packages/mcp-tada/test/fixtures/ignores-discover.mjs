// An older stdio server that silently ignores methods it does not recognize.
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "server/discover" || request.id === undefined) return;
  const result =
    request.method === "initialize"
      ? {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "old", version: "1" },
        }
      : { tools: [] };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
});
