import { describe, expect, test } from "bun:test";

import {
  BETTING_DEPLOYMENTS,
  normalizeSolanaCluster,
  resolveBettingSolanaDeployment,
} from "../deployments";

describe("betting deployment manifest", () => {
  test("normalizes build/runtime cluster aliases", () => {
    expect(normalizeSolanaCluster("mainnet")).toBe("mainnet-beta");
    expect(normalizeSolanaCluster("production")).toBe("mainnet-beta");
    expect(normalizeSolanaCluster("e2e")).toBe("localnet");
    expect(normalizeSolanaCluster("stream-ui")).toBe("devnet");
  });

  test("resolves solana deployments from the shared manifest", () => {
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

  test("requires non-empty Solana program ids for every cluster", () => {
    for (const deployment of Object.values(BETTING_DEPLOYMENTS.solana)) {
      expect(deployment.fightOracleProgramId.length).toBeGreaterThan(0);
      expect(deployment.goldClobMarketProgramId.length).toBeGreaterThan(0);
      expect(deployment.goldPerpsMarketProgramId.length).toBeGreaterThan(0);
    }
  });
});
