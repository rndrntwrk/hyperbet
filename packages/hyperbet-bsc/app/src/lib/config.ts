import {
  type BettingAppEnvironment,
  type BettingEvmNetwork,
  resolveBettingEvmDefaults,
} from "../../../deployments";

export type Environment =
  | "devnet"
  | "testnet"
  | "mainnet-beta"
  | "localnet"
  | "e2e"
  | "stream-ui";

type EnvConfig = {
  refreshIntervalMs: number;
  gameApiUrl: string;
  gameWsUrl: string;
  streamUrl: string;
  bscRpcUrl: string;
  bscChainId: number;
  bscGoldClobAddress: string;
  bscGoldTokenAddress: string;
};

const ENVIRONMENT_ALIASES: Record<string, Environment> = {
  development: "devnet",
  dev: "devnet",
  devnet: "devnet",
  testnet: "testnet",
  production: "mainnet-beta",
  prod: "mainnet-beta",
  mainnet: "mainnet-beta",
  "mainnet-beta": "mainnet-beta",
  local: "localnet",
  localnet: "localnet",
  e2e: "e2e",
  "stream-ui": "stream-ui",
};

function readEnvString(name: string): string | undefined {
  const rawValue = import.meta.env[name];
  if (typeof rawValue !== "string") return undefined;
  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvNumber(name: string, fallback: number): number {
  const rawValue = readEnvString(name);
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvList(rawValue: string | undefined): string[] {
  if (!rawValue) return [];
  return rawValue
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function uniqueList(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function resolveEnvironment(): Environment {
  const explicitEnvironment =
    readEnvString("VITE_APP_ENV")?.toLowerCase() ??
    readEnvString("VITE_BETTING_ENV")?.toLowerCase();
  if (explicitEnvironment && ENVIRONMENT_ALIASES[explicitEnvironment]) {
    return ENVIRONMENT_ALIASES[explicitEnvironment];
  }

  const viteMode = readEnvString("MODE")?.toLowerCase();
  if (viteMode && ENVIRONMENT_ALIASES[viteMode]) {
    return ENVIRONMENT_ALIASES[viteMode];
  }

  return "devnet";
}

export const ACTIVE_ENV: Environment = resolveEnvironment();

function isPrivateIpv4Host(hostname: string): boolean {
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  const match = hostname.match(/^172\.(\d{1,3})\./);
  if (!match) return false;
  const octet = Number.parseInt(match[1], 10);
  return Number.isFinite(octet) && octet >= 16 && octet <= 31;
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    isPrivateIpv4Host(hostname)
  );
}

function isPublicBrowserRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  return !isLocalHostname(hostname);
}

function resolveRuntimeEnvironment(buildEnv: Environment): Environment {
  if (!isPublicBrowserRuntime()) {
    return buildEnv;
  }
  if (buildEnv === "localnet" || buildEnv === "e2e") {
    return "mainnet-beta";
  }
  return buildEnv;
}

export const RUNTIME_ENV: Environment = resolveRuntimeEnvironment(ACTIVE_ENV);

function asDeploymentEnvironment(
  environment: Environment,
): BettingAppEnvironment {
  return environment;
}

function defaultRpcUrlForEvmNetwork(network: BettingEvmNetwork): string {
  switch (network) {
    case "bsc":
      return "https://bsc-dataseed.binance.org";
    case "bscTestnet":
      return "https://data-seed-prebsc-1-s1.binance.org:8545";
  }
  return "https://data-seed-prebsc-1-s1.binance.org:8545";
}

function buildEvmConfig(environment: Environment): Pick<
  EnvConfig,
  "bscRpcUrl" | "bscChainId" | "bscGoldClobAddress" | "bscGoldTokenAddress"
> {
  const defaults = resolveBettingEvmDefaults(
    asDeploymentEnvironment(environment),
  );

  return {
    bscRpcUrl: defaultRpcUrlForEvmNetwork(defaults.bsc.networkKey),
    bscChainId: defaults.bsc.chainId,
    bscGoldClobAddress: defaults.bsc.goldClobAddress,
    bscGoldTokenAddress: defaults.bsc.goldTokenAddress,
  };
}

const DEFAULT_STREAM_URL = "https://www.twitch.tv/hyperscapeai";
const DEFAULT_STREAM_FALLBACK_URL = "";
const DEFAULT_GAME_API_URL = "http://127.0.0.1:5555";
const DEFAULT_PRODUCTION_GAME_API_URL = "https://api.hyperbet.win";

const baseConfig: Pick<
  EnvConfig,
  "refreshIntervalMs" | "gameApiUrl" | "gameWsUrl" | "streamUrl"
> = {
  refreshIntervalMs: 5000,
  gameApiUrl: DEFAULT_GAME_API_URL,
  gameWsUrl: `${DEFAULT_GAME_API_URL.replace(/^http/, "ws")}/ws`,
  streamUrl: DEFAULT_STREAM_URL,
};

const ENV_CONFIGS: Record<Environment, EnvConfig> = {
  devnet: {
    ...baseConfig,
    ...buildEvmConfig("devnet"),
  },
  testnet: {
    ...baseConfig,
    ...buildEvmConfig("testnet"),
  },
  localnet: {
    ...baseConfig,
    ...buildEvmConfig("localnet"),
    streamUrl: "",
  },
  e2e: {
    ...baseConfig,
    ...buildEvmConfig("e2e"),
    streamUrl: "",
    refreshIntervalMs: 1500,
  },
  "stream-ui": {
    ...baseConfig,
    ...buildEvmConfig("stream-ui"),
    streamUrl: "",
    refreshIntervalMs: 60000,
  },
  "mainnet-beta": {
    ...baseConfig,
    ...buildEvmConfig("mainnet-beta"),
    gameApiUrl: DEFAULT_PRODUCTION_GAME_API_URL,
    gameWsUrl: `${DEFAULT_PRODUCTION_GAME_API_URL.replace(/^http/, "ws")}/ws`,
  },
};

if (
  typeof window !== "undefined" &&
  ACTIVE_ENV !== RUNTIME_ENV &&
  typeof console !== "undefined"
) {
  console.warn(
    `[config] forcing runtime env '${RUNTIME_ENV}' on public host (build env '${ACTIVE_ENV}')`,
  );
}

const baseEnvConfig = ENV_CONFIGS[RUNTIME_ENV];
const envGameApiUrl = readEnvString("VITE_GAME_API_URL");
const resolvedGameApiUrl = envGameApiUrl ?? baseEnvConfig.gameApiUrl;
const envGameWsUrl = readEnvString("VITE_GAME_WS_URL");
const resolvedGameWsUrl =
  envGameWsUrl ?? `${resolvedGameApiUrl.replace(/^http/, "ws")}/ws`;
const defaultPrimaryStreamUrl =
  readEnvString("VITE_STREAM_URL") ?? baseEnvConfig.streamUrl;
const resolvedStreamSources = (() => {
  const fromListVar = parseEnvList(readEnvString("VITE_STREAM_SOURCES"));
  if (fromListVar.length > 0) {
    return uniqueList(fromListVar);
  }
  const envFallbackUrl = readEnvString("VITE_STREAM_FALLBACK_URL");
  const fallbackUrl =
    envFallbackUrl ??
    (defaultPrimaryStreamUrl ? DEFAULT_STREAM_FALLBACK_URL : "");
  return uniqueList([defaultPrimaryStreamUrl, fallbackUrl ?? ""]).filter(
    (value) => value.length > 0,
  );
})();

export const CONFIG: EnvConfig = {
  ...baseEnvConfig,
  refreshIntervalMs: readEnvNumber(
    "VITE_REFRESH_INTERVAL_MS",
    baseEnvConfig.refreshIntervalMs,
  ),
  gameApiUrl: resolvedGameApiUrl,
  gameWsUrl: resolvedGameWsUrl,
  streamUrl: resolvedStreamSources[0] ?? "",
  bscRpcUrl: readEnvString("VITE_BSC_RPC_URL") ?? baseEnvConfig.bscRpcUrl,
  bscChainId: readEnvNumber("VITE_BSC_CHAIN_ID", baseEnvConfig.bscChainId),
  bscGoldClobAddress:
    readEnvString("VITE_BSC_GOLD_CLOB_ADDRESS") ??
    baseEnvConfig.bscGoldClobAddress,
  bscGoldTokenAddress:
    readEnvString("VITE_BSC_GOLD_TOKEN_ADDRESS") ??
    baseEnvConfig.bscGoldTokenAddress,
};

export const DEFAULT_REFRESH_INTERVAL_MS = CONFIG.refreshIntervalMs;
export const STREAM_URL = CONFIG.streamUrl;
export const STREAM_URLS = resolvedStreamSources;
export const GAME_API_URL = CONFIG.gameApiUrl;
export const GAME_WS_URL = CONFIG.gameWsUrl;

export function getFixedMatchId(): number | null {
  const id = import.meta.env.VITE_ACTIVE_MATCH_ID;
  if (!id) return null;
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : null;
}

export const BSC_RPC_URL = CONFIG.bscRpcUrl;
export const BSC_CHAIN_ID = CONFIG.bscChainId;
export const BSC_GOLD_CLOB_ADDRESS = CONFIG.bscGoldClobAddress;
export const BSC_GOLD_TOKEN_ADDRESS = CONFIG.bscGoldTokenAddress;
