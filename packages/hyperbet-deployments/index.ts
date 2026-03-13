import rawManifest from "./contracts.json";

export type BettingSolanaCluster =
  | "localnet"
  | "devnet"
  | "testnet"
  | "mainnet-beta";
export type BettingAppEnvironment = BettingSolanaCluster | "e2e" | "stream-ui";
export type BettingEvmNetwork =
  | "bscTestnet"
  | "bsc"
  | "baseSepolia"
  | "base"
  | "avaxFuji"
  | "avax";
export type BettingEvmChain = "bsc" | "base" | "avax";
export type BettingTargetKind = "testnet" | "mainnet";

export interface BettingSolanaDeployment {
  cluster: BettingSolanaCluster;
  fightOracleProgramId: string;
  goldClobMarketProgramId: string;
  goldPerpsMarketProgramId: string;
  goldMint: string;
  usdcMint: string;
}

export interface BettingEvmDeployment {
  networkKey: BettingEvmNetwork;
  chain: BettingEvmChain;
  chainId: number;
  label: string;
  targetKind: BettingTargetKind;
  rpcEnvVar: string;
  duelOracleAddress: string;
  goldClobAddress: string;
  skillOracleAddress: string;
  perpEngineAddress: string;
  adminAddress: string;
  marketOperatorAddress: string;
  treasuryAddress: string;
  marketMakerAddress: string;
  deploymentVersion: string;
  goldTokenAddress: string;
  perpMarginTokenAddress: string;
}

export interface BettingDeploymentManifest {
  solana: Record<BettingSolanaCluster, BettingSolanaDeployment>;
  evm: Record<BettingEvmNetwork, BettingEvmDeployment>;
}

const SOLANA_CLUSTERS: BettingSolanaCluster[] = [
  "localnet",
  "devnet",
  "testnet",
  "mainnet-beta",
] as const;
const EVM_NETWORKS: BettingEvmNetwork[] = [
  "bscTestnet",
  "bsc",
  "baseSepolia",
  "base",
  "avaxFuji",
  "avax",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Deployment manifest field '${key}' must be a string`);
  }
  return value;
}

function readRequiredNumber(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Deployment manifest field '${key}' must be a number`);
  }
  return value;
}

function validateManifest(manifest: unknown): BettingDeploymentManifest {
  if (!isRecord(manifest)) {
    throw new Error("Deployment manifest root must be an object");
  }

  const solanaRaw = manifest.solana;
  const evmRaw = manifest.evm;
  if (!isRecord(solanaRaw) || !isRecord(evmRaw)) {
    throw new Error("Deployment manifest must include solana and evm sections");
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
      goldMint: readRequiredString(clusterValue, "goldMint"),
      usdcMint: readRequiredString(clusterValue, "usdcMint"),
    };
  }

  const evm = {} as Record<BettingEvmNetwork, BettingEvmDeployment>;
  for (const network of EVM_NETWORKS) {
    const networkValue = evmRaw[network];
    if (!isRecord(networkValue)) {
      throw new Error(`Missing evm deployment config for '${network}'`);
    }
    evm[network] = {
      networkKey: network,
      chain: readRequiredString(networkValue, "chain") as BettingEvmChain,
      chainId: readRequiredNumber(networkValue, "chainId"),
      label: readRequiredString(networkValue, "label"),
      targetKind: readRequiredString(
        networkValue,
        "targetKind",
      ) as BettingTargetKind,
      rpcEnvVar: readRequiredString(networkValue, "rpcEnvVar"),
      duelOracleAddress: readRequiredString(networkValue, "duelOracleAddress"),
      goldClobAddress: readRequiredString(networkValue, "goldClobAddress"),
      skillOracleAddress: readRequiredString(networkValue, "skillOracleAddress"),
      perpEngineAddress: readRequiredString(networkValue, "perpEngineAddress"),
      adminAddress: readRequiredString(networkValue, "adminAddress"),
      marketOperatorAddress: readRequiredString(
        networkValue,
        "marketOperatorAddress",
      ),
      treasuryAddress: readRequiredString(networkValue, "treasuryAddress"),
      marketMakerAddress: readRequiredString(networkValue, "marketMakerAddress"),
      deploymentVersion: readRequiredString(networkValue, "deploymentVersion"),
      goldTokenAddress: readRequiredString(networkValue, "goldTokenAddress"),
      perpMarginTokenAddress: readRequiredString(
        networkValue,
        "perpMarginTokenAddress",
      ),
    };
  }

  return { solana, evm };
}

export const BETTING_DEPLOYMENTS = validateManifest(rawManifest);
export const BETTING_EVM_DEPLOYMENTS = {
  bscTestnet: BETTING_DEPLOYMENTS.evm.bscTestnet,
  bsc: BETTING_DEPLOYMENTS.evm.bsc,
  baseSepolia: BETTING_DEPLOYMENTS.evm.baseSepolia,
  base: BETTING_DEPLOYMENTS.evm.base,
  avaxFuji: BETTING_DEPLOYMENTS.evm.avaxFuji,
  avax: BETTING_DEPLOYMENTS.evm.avax,
} as const;

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

export function resolveBettingEvmDeployment(
  network: BettingEvmNetwork,
): BettingEvmDeployment {
  return BETTING_DEPLOYMENTS.evm[network];
}

export function resolveBettingEvmDefaults(environment: BettingAppEnvironment): {
  bsc: BettingEvmDeployment;
  base: BettingEvmDeployment;
  avax: BettingEvmDeployment;
} {
  if (environment === "mainnet-beta") {
    return {
      bsc: BETTING_DEPLOYMENTS.evm.bsc,
      base: BETTING_DEPLOYMENTS.evm.base,
      avax: BETTING_DEPLOYMENTS.evm.avax,
    };
  }

  return {
    bsc: BETTING_DEPLOYMENTS.evm.bscTestnet,
    base: BETTING_DEPLOYMENTS.evm.baseSepolia,
    avax: BETTING_DEPLOYMENTS.evm.avaxFuji,
  };
}
