export {
  BETTING_DEPLOYMENTS,
  normalizeSolanaCluster,
  resolveBettingEvmDeployment,
  resolveBettingSolanaDeployment,
} from "../../hyperbet-deployments";

export type {
  BettingAppEnvironment,
  BettingDeploymentManifest,
  BettingEvmChain,
  BettingEvmDeployment,
  BettingEvmNetwork,
  BettingSolanaCluster,
  BettingSolanaDeployment,
  BettingTargetKind,
} from "../../hyperbet-deployments";

import {
  BETTING_DEPLOYMENTS,
  type BettingAppEnvironment,
  type BettingEvmDeployment,
} from "../../hyperbet-deployments";

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
