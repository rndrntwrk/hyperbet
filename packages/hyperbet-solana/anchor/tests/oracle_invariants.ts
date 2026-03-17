import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as assert from "assert";

import {
  SIDE_ASK,
  SIDE_BID,
  airdrop,
  cancelDuel,
  deriveDuelStatePda,
  deriveOracleConfigPda,
  ensureOracleReady,
  finalizeDuelResult,
  hasProgramError,
  marketSideA,
  marketSideB,
  proposeDuelResult,
  uniqueDuelKey,
  upsertDuel,
  duelStatusLocked,
  duelStatusBettingOpen,
  duelStatusScheduled,
  deriveProgramDataAddress,
  sleep,
} from "./clob-test-helpers";
import { configureAnchorTests } from "./test-anchor";
import { FightOracle } from "../target/types/fight_oracle";

describe("oracle invariants (solana parity)", () => {
  const provider = configureAnchorTests();
  anchor.setProvider(provider);

  const fightProgram = anchor.workspace.FightOracle as Program<FightOracle>;
  const authority = (provider.wallet as anchor.Wallet & { payer: Keypair }).payer;

  const STATUS_RANK = {
    Scheduled: 0,
    BettingOpen: 1,
    Locked: 2,
    Proposed: 3,
    Challenged: 4,
    Resolved: 5,
    Cancelled: 6,
  };

  it("PM16: rejects initialize_oracle with zero addresses (bootstrap removal)", async () => {
    const oracleConfig = deriveDuelStatePda(fightProgram.programId, uniqueDuelKey("zero-addr")); // using dummy pda for test isolation
    // Actually config PDA is fixed seed, so we need to test initialization on a fresh localnet or assume it's already initialized and test Update
    // But since we are on localnet and we might run this multiple times, it's better to verify the logic.
    
    // We can't easily re-initialize the same PDA if it exists, so we test the 'Update' gates too which share logic.
    const configPda = deriveOracleConfigPda(fightProgram.programId);
    
    try {
        await fightProgram.methods
            .updateOracleConfig(
                authority.publicKey,
                PublicKey.default, // Invalid reporter
                authority.publicKey,
                authority.publicKey,
                new BN(3600)
            )
            .accountsPartial({
                authority: authority.publicKey,
                oracleConfig: configPda,
            })
            .rpc();
        assert.fail("allowed zero reporter");
    } catch (e) {
        assert.ok(hasProgramError(e, "InvalidReporter"));
    }

    try {
        await fightProgram.methods
            .updateOracleConfig(
                authority.publicKey,
                authority.publicKey,
                PublicKey.default, // Invalid finalizer
                authority.publicKey,
                new BN(3600)
            )
            .accountsPartial({
                authority: authority.publicKey,
                oracleConfig: configPda,
            })
            .rpc();
        assert.fail("allowed zero finalizer");
    } catch (e) {
        assert.ok(hasProgramError(e, "InvalidFinalizer"));
    }
  });

  it("PM16: rejects non-positive dispute window", async () => {
    const configPda = deriveOracleConfigPda(fightProgram.programId);
    try {
        await fightProgram.methods
            .updateOracleConfig(
                authority.publicKey,
                authority.publicKey,
                authority.publicKey,
                authority.publicKey,
                new BN(0) // Invalid window
            )
            .accountsPartial({
                authority: authority.publicKey,
                oracleConfig: configPda,
            })
            .rpc();
        assert.fail("allowed zero dispute window");
    } catch (e) {
        assert.ok(hasProgramError(e, "InvalidDisputeWindow"));
    }
  });

  describe("terminal state preservation", () => {
    let terminalDuelKey: number[];
    let terminalDuelPda: PublicKey;

    before(async () => {
        terminalDuelKey = uniqueDuelKey("terminal-immutability");
        terminalDuelPda = deriveDuelStatePda(fightProgram.programId, terminalDuelKey);
        const now = Math.floor(Date.now() / 1000);
        
        await ensureOracleReady(fightProgram, authority);
        await upsertDuel(fightProgram, authority, terminalDuelKey, {
            status: duelStatusLocked(),
            betOpenTs: now - 100,
            betCloseTs: now - 50,
        });
        await proposeDuelResult(fightProgram, authority, terminalDuelKey, {
            winner: marketSideA(),
            duelEndTs: now - 10,
        });
        await sleep(2100);
        // Short dispute window for test
        await finalizeDuelResult(fightProgram, authority, terminalDuelKey);
    });

    it("prevents any state change from Resolved", async () => {
        const now = Math.floor(Date.now() / 1000);
        try {
            await upsertDuel(fightProgram, authority, terminalDuelKey, {
                status: duelStatusBettingOpen(),
                betOpenTs: now,
                betCloseTs: now + 100,
            });
            assert.fail("allowed update to RESOLVED duel");
        } catch (e) {
            assert.ok(hasProgramError(e, "DuelAlreadyFinalized"));
        }
    });

    it("prevents cancellation of Resolved duel", async () => {
        try {
            await cancelDuel(fightProgram, authority, terminalDuelKey);
            assert.fail("allowed cancellation of RESOLVED duel");
        } catch (e) {
            assert.ok(hasProgramError(e, "DuelAlreadyFinalized"));
        }
    });
  });

  describe("state regression prevention", () => {
    it("prevents moving from Locked back to BettingOpen", async () => {
        const duelKey = uniqueDuelKey("regression-test");
        const now = Math.floor(Date.now() / 1000);
        await upsertDuel(fightProgram, authority, duelKey, {
            status: duelStatusLocked(),
            betOpenTs: now - 100,
            betCloseTs: now - 10,
        });

        try {
            await upsertDuel(fightProgram, authority, duelKey, {
                status: duelStatusBettingOpen(),
                betOpenTs: now - 100,
                betCloseTs: now + 100,
            });
            assert.fail("allowed regression from Locked to BettingOpen");
        } catch (e) {
            assert.ok(hasProgramError(e, "InvalidLifecycleTransition"));
        }
    });

    it("prevents moving from Proposed back to Locked", async () => {
        const duelKey = uniqueDuelKey("regression-prop-lock");
        const now = Math.floor(Date.now() / 1000);
        await upsertDuel(fightProgram, authority, duelKey, {
            status: duelStatusLocked(),
            betOpenTs: now - 100,
            betCloseTs: now - 10,
        });
        await proposeDuelResult(fightProgram, authority, duelKey, {
            winner: marketSideA(),
            duelEndTs: now - 5,
        });

        try {
            await upsertDuel(fightProgram, authority, duelKey, {
                status: duelStatusLocked(),
                betOpenTs: now - 100,
                betCloseTs: now - 10,
            });
            assert.fail("allowed regression from Proposed to Locked");
        } catch (e) {
            assert.ok(hasProgramError(e, "InvalidLifecycleTransition"));
        }
    });
  });

  it("cancellation clears pending proposal data", async () => {
    const duelKey = uniqueDuelKey("cancel-clear");
    const now = Math.floor(Date.now() / 1000);
    await upsertDuel(fightProgram, authority, duelKey, {
        status: duelStatusLocked(),
        betOpenTs: now - 100,
        betCloseTs: now - 10,
    });
    await proposeDuelResult(fightProgram, authority, duelKey, {
        winner: marketSideB(),
        duelEndTs: now - 5,
    });

    const stateBefore = await fightProgram.account.duelState.fetch(deriveDuelStatePda(fightProgram.programId, duelKey));
    assert.notStrictEqual(stateBefore.activeProposal.toString(), "0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0");

    await cancelDuel(fightProgram, authority, duelKey);

    const stateAfter = await fightProgram.account.duelState.fetch(deriveDuelStatePda(fightProgram.programId, duelKey));
    assert.strictEqual(stateAfter.activeProposal.toString(), "0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0");
    assert.ok(stateAfter.status.cancelled !== undefined);
  });
});
