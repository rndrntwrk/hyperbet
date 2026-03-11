import { describe, expect, test } from "bun:test";

import { getScenarioPresetByIdOrName } from "../../scenario-catalog.js";
import { normalizeSolanaProofOutcome } from "./normalize.js";
import type { SolanaProofOutcome } from "./types.js";

describe("normalizeSolanaProofOutcome", () => {
    test("maps a Solana proof summary into the shared ScenarioResult contract", () => {
        const preset = getScenarioPresetByIdOrName("solana-unauthorized-oracle-attack");
        expect(preset).not.toBeNull();

        const outcome: SolanaProofOutcome = {
            preset: preset!,
            seed: "solana-proof-seed",
            winner: "A",
            duelLabel: "solana-unauthorized-oracle-attack:solana-proof-seed",
            duelKeyHex: "abcd".repeat(16),
            marketRef: "Market111111111111111111111111111111111",
            rpcUrl: "http://127.0.0.1:9999",
            contracts: {
                oracle: "Oracle111111111111111111111111111111111",
                clob: "Clob11111111111111111111111111111111111",
            },
            fees: {
                treasuryBps: 100,
                mmBps: 100,
                winningsMmBps: 200,
                treasuryAccruedLamports: 14n,
                mmAccruedLamports: 20n,
            },
            actors: [],
            book: {
                bids: [],
                asks: [],
            },
            traces: [
                {
                    actor: "Unauthorized Reporter",
                    action: "post_lock_order_rejected",
                    chainKey: "solana",
                    duelKey: "abcd",
                    marketRef: "Market111111111111111111111111111111111",
                    price: null,
                    units: null,
                    txRef: null,
                    ok: true,
                    message: "unauthorized oracle write rejected",
                },
            ],
            attackRejected: true,
            staleStreamGuardTrips: 0,
            staleOracleGuardTrips: 0,
            closeGuardTrips: 1,
            peakInventory: 1_000,
            quoteChecks: 1,
            quoteActiveChecks: 1,
            orderChurn: 2,
            lockTransitionLatencyMs: 750,
            resolvedCorrectly: true,
            claimCorrectly: true,
            settlementStatus: "RESOLVED",
            settlementStatusCode: 3,
            winnerCode: 1,
            winnerLabel: "A",
            totalAShares: 0n,
            totalBShares: 0n,
            bestBid: 0,
            bestAsk: 1_000,
            marketMakerPnl: -0.02,
            attackerPnl: -0.000005,
            treasuryPnl: 0.000014,
            marketMakerDrawdownBps: 25,
            claimsProcessed: true,
            bookNotCrossed: true,
            mmSolvent: true,
            degraded: false,
            debug: {
                claimant: "Solana Taker",
            },
        };

        const normalized = normalizeSolanaProofOutcome(outcome);

        expect(normalized.result.chainKey).toBe("solana");
        expect(normalized.result.resolvedCorrectly).toBeTrue();
        expect(normalized.result.claimCorrectly).toBeTrue();
        expect(normalized.result.passed).toBeTrue();
        expect(
            normalized.result.gates.some(
                (gate) => gate.name === "adversarialActionRejected" && gate.passed,
            ),
        ).toBeTrue();
        expect(normalized.summary.metrics.closeGuardTrips).toBe(1);
        expect(normalized.state.backend).toBe("solana");
        expect(normalized.state.market).toEqual({
            exists: true,
            status: 3,
            winner: 1,
            bestBid: 0,
            bestAsk: 1_000,
            totalAShares: "0",
            totalBShares: "0",
        });
    });
});
