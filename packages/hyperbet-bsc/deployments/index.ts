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
} {
  if (environment === "mainnet-beta") {
    return {
      bsc: BETTING_DEPLOYMENTS.evm.bsc,
    };
  }

  return {
    bsc: BETTING_DEPLOYMENTS.evm.bscTestnet,
  };
}
