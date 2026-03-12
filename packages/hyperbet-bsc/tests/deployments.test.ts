import { describe, expect, test } from "bun:test";

import {
  BETTING_DEPLOYMENTS,
  normalizeSolanaCluster,
  resolveBettingEvmDefaults,
  resolveBettingSolanaDeployment,
} from "../deployments";

describe("betting deployment manifest", () => {
  test("normalizes build/runtime cluster aliases", () => {
    expect(normalizeSolanaCluster("mainnet")).toBe("mainnet-beta");
    expect(normalizeSolanaCluster("production")).toBe("mainnet-beta");
    expect(normalizeSolanaCluster("e2e")).toBe("localnet");
    expect(normalizeSolanaCluster("stream-ui")).toBe("devnet");
  });

  test("includes shared solana deployments in the unified manifest", () => {
    const testnet = resolveBettingSolanaDeployment("testnet");
    expect(testnet.fightOracleProgramId).toBe(
      BETTING_DEPLOYMENTS.solana.testnet.fightOracleProgramId,
    );
    expect(testnet.goldClobMarketProgramId).toBe(
      BETTING_DEPLOYMENTS.solana.testnet.goldClobMarketProgramId,
    );
    expect(testnet.goldPerpsMarketProgramId).toBe(
      BETTING_DEPLOYMENTS.solana.testnet.goldPerpsMarketProgramId,
    );
  });

  test("maps app environments to the correct default evm networks", () => {
    const testnetDefaults = resolveBettingEvmDefaults("testnet");
    expect(testnetDefaults.bsc.networkKey).toBe("bscTestnet");
    expect(testnetDefaults.bsc.perpMarginTokenAddress).toBe(
      BETTING_DEPLOYMENTS.evm.bscTestnet.perpMarginTokenAddress,
    );

    const mainnetDefaults = resolveBettingEvmDefaults("mainnet-beta");
    expect(mainnetDefaults.bsc.networkKey).toBe("bsc");
    expect(mainnetDefaults.bsc.perpMarginTokenAddress).toBe(
      BETTING_DEPLOYMENTS.evm.bsc.perpMarginTokenAddress,
    );
  });
});
