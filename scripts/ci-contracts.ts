import path from "node:path";

import {
  copyIntoArtifacts,
  resolveArtifactRoot,
  rootDir,
  runCommand,
  writeJsonArtifact,
} from "./ci-lib";

type ContractCiTarget = "fast" | "proof" | "security";

function parseArgs(): ContractCiTarget {
  const targetArg =
    process.argv
      .slice(2)
      .find((arg) => arg.startsWith("--target="))
      ?.slice("--target=".length) ?? "fast";
  if (
    targetArg !== "fast" &&
    targetArg !== "proof" &&
    targetArg !== "security"
  ) {
    throw new Error(`unsupported contract CI target ${targetArg}`);
  }
  return targetArg;
}

const target = parseArgs();
const artifactNameByTarget: Record<ContractCiTarget, string> = {
  fast: "evm-contract-validation",
  proof: "evm-contract-proof-gate",
  security: "evm-contract-security-gate",
};
const artifactRoot = resolveArtifactRoot(artifactNameByTarget[target]);
const contractRoot = path.join(rootDir, "packages/evm-contracts");
const anvilLog = path.join(artifactRoot, "anvil.log");

async function runStep(
  name: string,
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  await runCommand(command, args, {
    cwd: contractRoot,
    env,
    stdoutFile: path.join(artifactRoot, `${name}.out.log`),
    stderrFile: path.join(artifactRoot, `${name}.err.log`),
  });
}

writeJsonArtifact(artifactRoot, "summary.json", {
  target,
  contractRoot,
  requiredCheckName:
    target === "fast"
      ? "EVM Contract Validation"
      : target === "proof"
        ? "EVM Contract Proof Gate"
        : "EVM Contract Security Gate",
});

try {
  if (target === "fast") {
    await runStep("foundry-fast", "bun", ["run", "test:foundry:fast"]);
  } else if (target === "proof") {
    await runStep("foundry-test", "bun", ["run", "test:foundry"]);
    await runStep("foundry-fuzz", "bun", ["run", "test:fuzz"]);
    await runStep("anvil-proof", "bun", ["run", "test:anvil"], {
      ANVIL_LOG: anvilLog,
    });
  } else {
    await runStep("slither", "bun", ["run", "analyze:slither"]);
  }
} finally {
  if (target === "proof") {
    copyIntoArtifacts(artifactRoot, anvilLog, "anvil.log");
  }
}
