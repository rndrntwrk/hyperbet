import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  copyIntoArtifacts,
  resolveArtifactRoot,
  runCommand,
  writeJsonArtifact,
} from "./ci-lib";

type ChainKey = "solana" | "bsc" | "avax";

type ControlFile = {
  services?: Record<
    string,
    {
      logPath?: string;
      pidFile?: string;
    }
  >;
};

function parseArgs(): ChainKey {
  const targetArg =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--chain="))
      ?.slice("--chain=".length) ?? "solana";
  if (targetArg !== "solana" && targetArg !== "bsc" && targetArg !== "avax") {
    throw new Error(`unsupported e2e chain ${targetArg}`);
  }
  return targetArg;
}

const chain = parseArgs();
const artifactRoot = resolveArtifactRoot(`e2e-${chain}`);
const appRoot = path.join(process.cwd(), `packages/hyperbet-${chain}/app`);
const statePath = path.join(appRoot, "tests/e2e/state.json");
const controlPath = path.join(appRoot, "tests/e2e/control.json");
const marketFlowGrepByChain: Record<ChainKey, string> = {
  solana:
    "solana predictions place YES and NO orders, resolve, and claim|solana prediction markets recover after keeper and proxy restarts|solana cancelled duel refunds and clears claim state",
  bsc:
    "evm predictions place YES and NO orders, resolve, and claim|bsc prediction markets recover after keeper and anvil restarts|bsc cancelled prediction markets refund and clear positions",
  avax:
    "evm predictions place YES and NO orders, resolve, and claim|avax prediction markets recover after keeper and anvil restarts|avax cancelled prediction markets refund and clear positions",
};

async function runGate(): Promise<void> {
  await runCommand(
    "bash",
    [
      "scripts/run-e2e-local.sh",
      "tests/e2e/market-flows.spec.ts",
      "--grep",
      marketFlowGrepByChain[chain],
    ],
    {
      cwd: appRoot,
      stdoutFile: path.join(artifactRoot, "market-flows.out.log"),
      stderrFile: path.join(artifactRoot, "market-flows.err.log"),
    },
  );

  await runCommand(
    "bash",
    [
      "scripts/run-e2e-local.sh",
      "tests/e2e/app-tabs-and-apis.spec.ts",
      "--grep",
      "keeper backend exposes all app-facing data endpoints",
    ],
    {
      cwd: appRoot,
      stdoutFile: path.join(artifactRoot, "api-smoke.out.log"),
      stderrFile: path.join(artifactRoot, "api-smoke.err.log"),
    },
  );
}

function collectArtifacts(): void {
  copyIntoArtifacts(artifactRoot, statePath, "state.json");
  copyIntoArtifacts(artifactRoot, controlPath, "control.json");
  if (!existsSync(controlPath)) return;
  const control = JSON.parse(readFileSync(controlPath, "utf8")) as ControlFile;
  writeJsonArtifact(artifactRoot, "control-summary.json", control);
  for (const [service, spec] of Object.entries(control.services ?? {})) {
    if (spec.logPath) {
      copyIntoArtifacts(artifactRoot, spec.logPath, path.join("logs", `${service}.log`));
    }
  }
}

try {
  await runGate();
} finally {
  collectArtifacts();
}
