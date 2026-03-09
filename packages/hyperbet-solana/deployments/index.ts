import rawManifest from "./contracts.json";

export type BettingSolanaCluster =
  | "localnet"
  | "devnet"
  | "testnet"
  | "mainnet-beta";
export type BettingAppEnvironment = BettingSolanaCluster | "e2e" | "stream-ui";

export interface BettingSolanaDeployment {
  cluster: BettingSolanaCluster;
  fightOracleProgramId: string;
  goldClobMarketProgramId: string;
  goldPerpsMarketProgramId: string;
  goldMint: string;
  usdcMint: string;
}

export interface BettingDeploymentManifest {
  solana: Record<BettingSolanaCluster, BettingSolanaDeployment>;
}

const SOLANA_CLUSTERS: BettingSolanaCluster[] = [
  "localnet",
  "devnet",
  "testnet",
  "mainnet-beta",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  options: { allowEmpty?: boolean } = {},
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Deployment manifest field '${key}' must be a string`);
  }
  if (!options.allowEmpty && value.trim().length === 0) {
    throw new Error(`Deployment manifest field '${key}' must be non-empty`);
  }
  return value;
}

function validateManifest(manifest: unknown): BettingDeploymentManifest {
  if (!isRecord(manifest)) {
    throw new Error("Deployment manifest root must be an object");
  }

  const solanaRaw = manifest.solana;
  if (!isRecord(solanaRaw)) {
    throw new Error("Deployment manifest must include a solana section");
  }

  const solana = {} as Record<BettingSolanaCluster, BettingSolanaDeployment>;
  for (const cluster of SOLANA_CLUSTERS) {
    const clusterValue = solanaRaw[cluster];
    if (!isRecord(clusterValue)) {
      throw new Error(`Missing solana deployment config for '${cluster}'`);
    }
    solana[cluster] = {
      cluster,
      fightOracleProgramId: readRequiredString(
        clusterValue,
        "fightOracleProgramId",
      ),
      goldClobMarketProgramId: readRequiredString(
        clusterValue,
        "goldClobMarketProgramId",
      ),
      goldPerpsMarketProgramId: readRequiredString(
        clusterValue,
        "goldPerpsMarketProgramId",
      ),
      goldMint: readRequiredString(clusterValue, "goldMint", {
        allowEmpty: true,
      }),
      usdcMint: readRequiredString(clusterValue, "usdcMint", {
        allowEmpty: true,
      }),
    };
  }

  return { solana };
}

export const BETTING_DEPLOYMENTS = validateManifest(rawManifest);

export function normalizeSolanaCluster(cluster: string): BettingSolanaCluster {
  switch (cluster.trim().toLowerCase()) {
    case "local":
    case "localnet":
    case "e2e":
      return "localnet";
    case "dev":
    case "devnet":
    case "stream-ui":
      return "devnet";
    case "test":
    case "testnet":
      return "testnet";
    case "mainnet":
    case "mainnet-beta":
    case "prod":
    case "production":
      return "mainnet-beta";
    default:
      throw new Error(`Unsupported Solana cluster '${cluster}'`);
  }
}

export function resolveBettingSolanaDeployment(
  cluster: string,
): BettingSolanaDeployment {
  return BETTING_DEPLOYMENTS.solana[normalizeSolanaCluster(cluster)];
}
