#!/usr/bin/env node
import { main } from "../main.js";

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`bureau: fatal: ${String(err)}\n`);
    process.exit(1);
  },
);
