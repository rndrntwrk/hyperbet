import { HyperbetEVMClient } from "./evm/client";
import { HyperbetSolanaClient } from "./solana/client";
import { HyperbetStreamClient } from "./stream/client";
import { SdkConfig, CreateOrderParams, CancelOrderParams, ClaimParams, OrderSide } from "./types";
import {
  BETTING_EVM_DEPLOYMENTS,
  type BettingEvmDeployment,
} from "../../hyperbet-deployments";

export * from "./types";
export { HyperbetEVMClient, HyperbetSolanaClient, HyperbetStreamClient };

export class HyperbetClient {
  public evmBsc?: HyperbetEVMClient;
  public evmAvax?: HyperbetEVMClient;
  public solana?: HyperbetSolanaClient;
  public stream?: HyperbetStreamClient;

  // Constants
  public static readonly DEFAULT_BSC_RPC = "https://bsc-dataseed.binance.org/";
  public static readonly DEFAULT_BSC_TESTNET_RPC = "https://data-seed-prebsc-1-s1.binance.org:8545";
  public static readonly DEFAULT_AVAX_RPC = "https://api.avax.network/ext/bc/C/rpc";
  public static readonly DEFAULT_AVAX_FUJI_RPC = "https://api.avax-test.network/ext/bc/C/rpc";
  public static readonly DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com";
  public static readonly DEFAULT_STREAM_URL = "wss://api.hyperbet.gg/ws";

  public static readonly BSC_CLOB_ADDRESS =
    BETTING_EVM_DEPLOYMENTS.bsc.goldClobAddress;
  public static readonly BSC_ORACLE_ADDRESS =
    BETTING_EVM_DEPLOYMENTS.bsc.duelOracleAddress;
  public static readonly AVAX_CLOB_ADDRESS =
    BETTING_EVM_DEPLOYMENTS.avax.goldClobAddress;
  public static readonly AVAX_ORACLE_ADDRESS =
    BETTING_EVM_DEPLOYMENTS.avax.duelOracleAddress;
  public static readonly SOLANA_CLOB_PROGRAM_ID = "C1obMarket11111111111111111111111111111111";
  public static readonly SOLANA_ORACLE_PROGRAM_ID = "F1ghtOrac1e11111111111111111111111111111111";

  constructor(config: SdkConfig) {
    const bscDeployment = resolveBscDeployment(config);
    const avaxDeployment = resolveAvaxDeployment(config);

    if (config.evmPrivateKey) {
      if (
        bscDeployment.goldClobAddress &&
        bscDeployment.duelOracleAddress
      ) {
        this.evmBsc = new HyperbetEVMClient(
          config.bscRpcUrl || resolveBscRpcUrl(config),
          config.evmPrivateKey,
          bscDeployment.goldClobAddress,
          bscDeployment.duelOracleAddress
        );
      }
      if (
        avaxDeployment.goldClobAddress &&
        avaxDeployment.duelOracleAddress
      ) {
        this.evmAvax = new HyperbetEVMClient(
          config.avaxRpcUrl || resolveAvaxRpcUrl(config),
          config.evmPrivateKey,
          avaxDeployment.goldClobAddress,
          avaxDeployment.duelOracleAddress
        );
      }
    }

    if (config.solanaPrivateKey) {
      this.solana = new HyperbetSolanaClient(
        config.solanaRpcUrl || HyperbetClient.DEFAULT_SOLANA_RPC,
        config.solanaPrivateKey,
        HyperbetClient.SOLANA_CLOB_PROGRAM_ID,
        HyperbetClient.SOLANA_ORACLE_PROGRAM_ID
      );
    }

    if (config.streamUrl || HyperbetClient.DEFAULT_STREAM_URL) {
      this.stream = new HyperbetStreamClient(config.streamUrl || HyperbetClient.DEFAULT_STREAM_URL);
    }
  }

  // Helper methods to place cross-chain orders simultaneously if desired
  public async placeOrderAll(params: CreateOrderParams) {
    const promises: Promise<any>[] = [];
    if (this.evmBsc) promises.push(this.evmBsc.placeOrder(params));
    if (this.evmAvax) promises.push(this.evmAvax.placeOrder(params));
    if (this.solana) promises.push(this.solana.placeOrder(params));
    return Promise.allSettled(promises);
  }
}

function resolveBscDeployment(config: SdkConfig): BettingEvmDeployment {
  return BETTING_EVM_DEPLOYMENTS[config.bscNetwork ?? "bsc"];
}

const BSC_RPC_DEFAULTS: Record<"bsc" | "bscTestnet", string> = {
  bsc: HyperbetClient.DEFAULT_BSC_RPC,
  bscTestnet: HyperbetClient.DEFAULT_BSC_TESTNET_RPC,
};

function resolveBscRpcUrl(config: SdkConfig): string {
  const network: "bsc" | "bscTestnet" = config.bscNetwork ?? "bsc";
  return BSC_RPC_DEFAULTS[network];
}

function resolveAvaxDeployment(config: SdkConfig): BettingEvmDeployment {
  return BETTING_EVM_DEPLOYMENTS[config.avaxNetwork ?? "avax"];
}

const AVAX_RPC_DEFAULTS: Record<"avax" | "avaxFuji", string> = {
  avax: HyperbetClient.DEFAULT_AVAX_RPC,
  avaxFuji: HyperbetClient.DEFAULT_AVAX_FUJI_RPC,
};

function resolveAvaxRpcUrl(config: SdkConfig): string {
  const network: "avax" | "avaxFuji" = config.avaxNetwork ?? "avax";
  return AVAX_RPC_DEFAULTS[network];
}
