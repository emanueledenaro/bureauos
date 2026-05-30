#!/usr/bin/env node
import { main } from "../main.js";

// Node emits an ExperimentalWarning the first time `node:sqlite` loads (used by
// the FTS5 memory index, dynamically imported at runtime). On the owner-facing
// CLI that reads as alarming noise and pollutes captured stderr, so suppress
// just that one warning while leaving every other warning intact (SER-214). The
// SQLite index loads lazily, after this patch is installed.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === "string" ? warning : (warning?.message ?? "");
  const typeArg = args[0];
  const type =
    typeof typeArg === "string"
      ? typeArg
      : typeArg && typeof typeArg === "object" && "type" in typeArg
        ? String((typeArg as { type?: unknown }).type)
        : "";
  if (type === "ExperimentalWarning" && /sqlite/i.test(message)) return;
  (originalEmitWarning as (...rest: unknown[]) => void)(warning, ...args);
}) as typeof process.emitWarning;

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`bureau: fatal: ${String(err)}\n`);
    process.exit(1);
  },
);
