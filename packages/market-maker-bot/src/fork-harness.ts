import { ethers } from "ethers";
import { Connection } from "@solana/web3.js";

type ForkTargets = {
  bscForkRpc?: string;
  avaxForkRpc?: string;
  solanaForkRpc?: string;
};

type EnvMap = Record<string, string | undefined>;

export function resolveForkTargets(env: EnvMap): ForkTargets {
  return {
    bscForkRpc: env.BSC_FORK_RPC_URL?.trim() || undefined,
    avaxForkRpc: env.AVAX_FORK_RPC_URL?.trim() || undefined,
    solanaForkRpc: env.SOLANA_FORK_RPC_URL?.trim() || undefined,
  };
}

async function checkEvmFork(label: "bsc" | "avax", rpcUrl: string): Promise<string> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const [network, blockNumber] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber(),
  ]);
  return `${label} chainId=${network.chainId.toString()} block=${blockNumber}`;
}

async function checkSolanaFork(rpcUrl: string): Promise<string> {
  const connection = new Connection(rpcUrl, "confirmed");
  const [version, blockHeight] = await Promise.all([
    connection.getVersion(),
    connection.getBlockHeight("confirmed"),
  ]);
  return `solana core=${version["solana-core"] ?? "unknown"} block=${blockHeight}`;
}

export async function runForkHarness(env: EnvMap): Promise<{
  executed: boolean;
  lines: string[];
}> {
  const targets = resolveForkTargets(env);
  const lines: string[] = [];
  const checks: Array<Promise<string>> = [];

  if (targets.bscForkRpc) {
    checks.push(checkEvmFork("bsc", targets.bscForkRpc));
  }
  if (targets.avaxForkRpc) {
    checks.push(checkEvmFork("avax", targets.avaxForkRpc));
  }
  if (targets.solanaForkRpc) {
    checks.push(checkSolanaFork(targets.solanaForkRpc));
  }

  if (checks.length === 0) {
    lines.push(
      "[fork-harness] skipped (set BSC_FORK_RPC_URL and/or AVAX_FORK_RPC_URL and/or SOLANA_FORK_RPC_URL)",
    );
    return { executed: false, lines };
  }

  const results = await Promise.all(checks);
  for (const line of results) {
    lines.push(`[fork-harness] ok ${line}`);
  }
  return { executed: true, lines };
}

if (process.argv[1]?.includes("fork-harness")) {
  runForkHarness(process.env)
    .then((result) => {
      for (const line of result.lines) {
        console.log(line);
      }
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[fork-harness] fail ${message}`);
      process.exit(1);
    });
}
