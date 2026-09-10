// Pre-commit verification. Formatters run first because they rewrite the tree;
// the read-only checks (build, typecheck, test) then run together. Output is
// printed only for failing steps.
//
//   node scripts/verify.mjs          format, lint, then build/typecheck/test
//   node scripts/verify.mjs --check  report formatting and lint, never rewrite
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const startedAt = Date.now();
const results = [];

function run(name, command, args) {
  const taskStartedAt = Date.now();
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => done({ name, ok: false, output: String(error), seconds: 0 }));
    child.on("close", (code) =>
      done({ name, ok: code === 0, output, seconds: (Date.now() - taskStartedAt) / 1000 }),
    );
  });
}

function report(result) {
  console.log(
    `\n${"=".repeat(60)}\n${result.ok ? "PASS" : "FAIL"}  ${result.name} (${result.seconds.toFixed(1)}s)`,
  );
  if (!result.ok || process.env.VERIFY_VERBOSE) console.log(result.output.trimEnd());
  results.push(result);
  return result;
}

const ok = () => results.every((r) => r.ok);

report(
  checkOnly
    ? await run("format:check", "pnpm", ["run", "format:check"])
    : await run("format", "pnpm", ["run", "format"]),
);
if (ok()) {
  report(
    checkOnly
      ? await run("lint:check", "pnpm", ["exec", "oxlint", "."])
      : await run("lint", "pnpm", ["run", "lint"]),
  );
}
if (ok()) {
  await Promise.all(
    [
      run("build", "pnpm", ["run", "build"]),
      run("typecheck", "pnpm", ["run", "typecheck"]),
      run("test", "pnpm", ["run", "test"]),
    ].map((task) => task.then(report)),
  );
}

const failed = results.filter((r) => !r.ok);
const wall = (Date.now() - startedAt) / 1000;
console.log(
  `\n${"=".repeat(60)}\n${failed.length === 0 ? "verify passed" : `verify failed: ${failed.map((r) => r.name).join(", ")}`} (${wall.toFixed(1)}s)`,
);
process.exit(failed.length === 0 ? 0 : 1);
