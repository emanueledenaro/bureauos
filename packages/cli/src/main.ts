import { VERSION, initWorkspace, InitError, type Preset } from "@bureauos/core";

const HELP = `bureau ${VERSION}

Usage:
  bureau <command> [options]

Commands:
  init [--preset <p>] [--name <n>] [--force]
                       Initialize a new BureauOS workspace in the current directory.
                       Presets: freelancer (default), agency, startup, operator.
  status               Show company pulse: active runs, pending approvals, blockers. (planned)
  config validate      Validate the local bureauos.yaml. (planned)
  memory search <q>    Search executive and project memory. (planned)
  run new              Start a new run from a trigger. (planned)
  audit tail           Tail the audit log. (planned)
  policy explain <a>   Explain why an action would be allowed or blocked. (planned)
  providers list       List configured providers. (planned)
  github sync          Reconcile project state from GitHub. (planned)

Run \`bureau <command> --help\` for command-specific help.
`;

const PRESETS: ReadonlySet<Preset> = new Set<Preset>([
  "freelancer",
  "agency",
  "startup",
  "operator",
]);

interface InitArgs {
  preset?: Preset;
  name?: string;
  force: boolean;
}

function parseInitArgs(args: readonly string[]): InitArgs | string {
  const out: InitArgs = { force: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--force" || arg === "-f") {
      out.force = true;
    } else if (arg === "--preset" || arg === "-p") {
      const next = args[i + 1];
      if (!next) return "missing value for --preset";
      if (!PRESETS.has(next as Preset)) {
        return `unknown preset "${next}"; expected one of: ${Array.from(PRESETS).join(", ")}`;
      }
      out.preset = next as Preset;
      i++;
    } else if (arg === "--name" || arg === "-n") {
      const next = args[i + 1];
      if (!next) return "missing value for --name";
      out.name = next;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      return "help";
    } else {
      return `unknown option "${arg}"`;
    }
  }
  return out;
}

async function runInit(args: readonly string[]): Promise<number> {
  const parsed = parseInitArgs(args);
  if (typeof parsed === "string") {
    if (parsed === "help") {
      process.stdout.write(
        `bureau init [--preset <freelancer|agency|startup|operator>] [--name <organization name>] [--force]\n`,
      );
      return 0;
    }
    process.stderr.write(`bureau init: ${parsed}\n`);
    return 2;
  }

  try {
    const result = await initWorkspace({
      root: process.cwd(),
      ...(parsed.preset !== undefined ? { preset: parsed.preset } : {}),
      ...(parsed.name !== undefined ? { organizationName: parsed.name } : {}),
      force: parsed.force,
    });
    process.stdout.write(`bureau: initialized workspace at ${result.workspaceDir}\n`);
    process.stdout.write(`bureau: ${result.filesCreated.length} files created\n`);
    process.stdout.write(`bureau: config written to ${result.configFile}\n`);
    process.stdout.write(`\nNext steps:\n`);
    process.stdout.write(`  - review .bureauos/bureauos.yaml and adjust autonomy\n`);
    process.stdout.write(`  - edit .bureauos/memory/COMPANY.md with owner preferences\n`);
    process.stdout.write(`  - see .bureauos/memory/artifacts/ for the first executive report\n`);
    return 0;
  } catch (e) {
    if (e instanceof InitError) {
      process.stderr.write(`bureau init: ${e.message}\n`);
      return 1;
    }
    process.stderr.write(`bureau init: unexpected error: ${String(e)}\n`);
    return 1;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const [, , ...args] = argv;
  const command = args[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (command === "init") {
    return runInit(args.slice(1));
  }

  process.stderr.write(`bureau: unknown command "${command}"\n\n${HELP}`);
  return 1;
}
