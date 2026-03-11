import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import type { AgentActionTrace } from "@hyperbet/mm-core";

import type { ScenarioPreset } from "../../scenario-catalog.js";
import type { SolanaProofOutcome, SolanaActorSnapshot } from "./types.js";
import {
    SolanaProgramRuntime,
    SIDE_ASK,
    SIDE_BID,
    buildSeededDuelKey,
    deriveUserBalancePda,
    hasProgramError,
    marketStatusCode,
    marketStatusLabel,
    marketWinnerCode,
    writableAccount,
    type SolanaOpenMarket,
    type SolanaRuntimeActor,
} from "./program-runtime.js";

function lamportsToSol(lamports: bigint): number {
    return Number(lamports) / LAMPORTS_PER_SOL;
}

function readBigintField(
    value: Record<string, unknown> | null | undefined,
    ...keys: string[]
): bigint {
    if (!value) {
        return 0n;
    }
    for (const key of keys) {
        const candidate = value[key];
        if (typeof candidate === "bigint") {
            return candidate;
        }
        if (typeof candidate === "number") {
            return BigInt(candidate);
        }
        if (typeof candidate === "string" && candidate.length > 0) {
            return BigInt(candidate);
        }
        if (candidate instanceof Uint8Array) {
            const hex = Buffer.from(candidate).toString("hex");
            return hex.length > 0 ? BigInt(`0x${hex}`) : 0n;
        }
        if (
            typeof candidate === "object" &&
            candidate != null &&
            "toString" in candidate &&
            typeof candidate.toString === "function"
        ) {
            const stringValue = candidate.toString();
            if (/^-?\d+$/.test(stringValue)) {
                return BigInt(stringValue);
            }
        }
    }
    return 0n;
}

function readNumberField(
    value: Record<string, unknown> | null | undefined,
    key: string,
): number {
    if (!value) {
        return 0;
    }
    const candidate = value[key];
    return typeof candidate === "number" ? candidate : Number(candidate ?? 0);
}

function buildTrace(
    action: string,
    market: SolanaOpenMarket,
    input: {
        actor: string;
        ok: boolean;
        txRef?: string | null;
        message?: string;
        price?: number | null;
        units?: number | null;
    },
): AgentActionTrace {
    return {
        actor: input.actor,
        action,
        chainKey: "solana",
        duelKey: Buffer.from(market.duelKey).toString("hex"),
        marketRef: market.marketState.toBase58(),
        price: input.price ?? null,
        units: input.units ?? null,
        txRef: input.txRef ?? null,
        ok: input.ok,
        message: input.message,
    };
}

async function snapshotActor(
    runtime: SolanaProgramRuntime,
    market: SolanaOpenMarket,
    actor: SolanaRuntimeActor,
    initialBalanceLamports: bigint,
): Promise<SolanaActorSnapshot> {
    const balanceLamports = await runtime.getBalanceLamports(actor.keypair.publicKey);
    const userBalance = await runtime.fetchUserBalanceNullable(
        deriveUserBalancePda(
            runtime.clobProgram.programId,
            market.marketState,
            actor.keypair.publicKey,
        ),
    );

    return {
        name: actor.name,
        role: actor.role,
        description: actor.description,
        color: actor.color,
        address: actor.keypair.publicKey.toBase58(),
        tradeCount: actor.tradeCount,
        activeOrders: actor.activeOrders,
        balance: {
            lamports: balanceLamports,
            pnlSol: lamportsToSol(balanceLamports - initialBalanceLamports),
        },
        position: {
            aShares: readBigintField(userBalance, "aShares"),
            bShares: readBigintField(userBalance, "bShares"),
            aLockedLamports: readBigintField(
                userBalance,
                "aLockedLamports",
                "aStake",
            ),
            bLockedLamports: readBigintField(
                userBalance,
                "bLockedLamports",
                "bStake",
            ),
        },
    };
}

async function executeTradeFlow(
    runtime: SolanaProgramRuntime,
    market: SolanaOpenMarket,
    marketMaker: SolanaRuntimeActor,
    taker: SolanaRuntimeActor,
    traces: AgentActionTrace[],
): Promise<{
    makerUserBalancePda: string;
    takerUserBalancePda: string;
    makerSnapshotBeforeClaim: Record<string, unknown>;
    takerSnapshotBeforeClaim: Record<string, unknown>;
    peakInventory: number;
    quoteChecks: number;
    quoteActiveChecks: number;
}> {
    const amount = 1_000n;
    const price = 600;

    const makerAsk = await runtime.placeOrder({
        market,
        user: marketMaker,
        orderId: 1,
        side: SIDE_ASK,
        price,
        amount,
    });
    traces.push(
        buildTrace("place_order", market, {
            actor: marketMaker.name,
            ok: true,
            txRef: makerAsk.signature,
            message: "resting ask placed",
            price,
            units: Number(amount),
        }),
    );

    const makerOrder = await (runtime.clobProgram.account as any).order.fetch(
        makerAsk.order,
    );
    const quoteChecks = 1;
    const quoteActiveChecks = makerOrder.active ? 1 : 0;

    const takerBid = await runtime.placeOrder({
        market,
        user: taker,
        orderId: 2,
        side: SIDE_BID,
        price,
        amount,
        remainingAccounts: [
            writableAccount(makerAsk.restingLevel),
            writableAccount(makerAsk.order),
            writableAccount(makerAsk.userBalance),
        ],
    });
    traces.push(
        buildTrace("take_quote", market, {
            actor: taker.name,
            ok: true,
            txRef: takerBid.signature,
            message: "taker matched the resting ask",
            price,
            units: Number(amount),
        }),
    );

    marketMaker.activeOrders = 0;
    taker.activeOrders = 0;

    const makerSnapshotBeforeClaim = await runtime.fetchUserBalance(makerAsk.userBalance);
    const takerSnapshotBeforeClaim = await runtime.fetchUserBalance(takerBid.userBalance);
    const peakInventory = Math.max(
        Number(
            readBigintField(makerSnapshotBeforeClaim, "aShares") +
                readBigintField(makerSnapshotBeforeClaim, "bShares"),
        ),
        Number(
            readBigintField(takerSnapshotBeforeClaim, "aShares") +
                readBigintField(takerSnapshotBeforeClaim, "bShares"),
        ),
    );

    return {
        makerUserBalancePda: makerAsk.userBalance.toBase58(),
        takerUserBalancePda: takerBid.userBalance.toBase58(),
        makerSnapshotBeforeClaim,
        takerSnapshotBeforeClaim,
        peakInventory,
        quoteChecks,
        quoteActiveChecks,
    };
}

async function finalizeOutcome(
    runtime: SolanaProgramRuntime,
    preset: ScenarioPreset,
    seed: string,
    market: SolanaOpenMarket,
    actors: {
        marketMaker: SolanaRuntimeActor;
        taker: SolanaRuntimeActor;
        attacker: SolanaRuntimeActor;
    },
    initialBalances: {
        authority: bigint;
        marketMaker: bigint;
        taker: bigint;
        attacker: bigint;
    },
    traces: AgentActionTrace[],
    tradeFlow: Awaited<ReturnType<typeof executeTradeFlow>>,
    winner: "A" | "B",
    attackRejected: boolean,
    onStage?: (stage: string) => void,
): Promise<SolanaProofOutcome> {
    const marketMakerBalanceBeforeClaim = await runtime.getBalanceLamports(
        actors.marketMaker.keypair.publicKey,
    );
    const takerBalanceBeforeClaim = await runtime.getBalanceLamports(
        actors.taker.keypair.publicKey,
    );

    const resolveStartedAt = Date.now();
    const resultSignature = await runtime.reportResult({
        reporter: runtime.authority,
        duelKey: market.duelKey,
        winner,
        seed: `${preset.id}:${winner}`,
        metadataUri: `https://hyperbet.local/${preset.id}/result`,
    });
    traces.push(
        buildTrace("report_result", market, {
            actor: "Authority Reporter",
            ok: true,
            txRef: resultSignature,
            message: `authoritative ${winner}-winner result reported`,
        }),
    );

    const syncSignature = await runtime.syncMarketFromDuel(market);
    const lockTransitionLatencyMs = Date.now() - resolveStartedAt;
    traces.push(
        buildTrace("sync_market", market, {
            actor: "Authority Reporter",
            ok: true,
            txRef: syncSignature,
            message: "market synced from duel state",
        }),
    );

    const claimant = winner === "B" ? actors.marketMaker : actors.taker;
    const claimantBalanceBeforeClaim =
        winner === "B" ? marketMakerBalanceBeforeClaim : takerBalanceBeforeClaim;
    onStage?.("claim");
    const claimResult = await runtime.claim(market, claimant);
    traces.push(
        buildTrace("claim", market, {
            actor: claimant.name,
            ok: true,
            txRef: claimResult.signature,
            message: "claim executed against the resolved market",
        }),
    );

    const claimantBalanceAfterClaim = await runtime.getBalanceLamports(
        claimant.keypair.publicKey,
    );
    const claimedUserBalance = await runtime.fetchUserBalance(claimResult.userBalance);
    const winningSharesAfterClaim =
        winner === "B"
            ? readBigintField(claimedUserBalance, "bShares")
            : readBigintField(claimedUserBalance, "aShares");

    const marketState = await runtime.fetchMarketState(market.marketState);
    const config = await runtime.fetchConfig(market.config);

    const actorSnapshots = await Promise.all([
        snapshotActor(runtime, market, actors.marketMaker, initialBalances.marketMaker),
        snapshotActor(runtime, market, actors.taker, initialBalances.taker),
        snapshotActor(runtime, market, actors.attacker, initialBalances.attacker),
    ]);

    const totalAShares = actorSnapshots.reduce(
        (total, actor) => total + actor.position.aShares,
        0n,
    );
    const totalBShares = actorSnapshots.reduce(
        (total, actor) => total + actor.position.bShares,
        0n,
    );

    const marketMakerPnl = actorSnapshots.find(
        (actor) => actor.role === "market_maker",
    )?.balance.pnlSol ?? 0;
    const attackerPnl =
        actorSnapshots.find((actor) => actor.role === "attacker")?.balance.pnlSol ?? 0;
    const marketMakerDrawdownBps = Math.round(
        (Math.abs(Math.min(0, marketMakerPnl)) /
            Math.max(lamportsToSol(initialBalances.marketMaker), 0.0001)) *
            10_000,
    );
    const settlementStatusCode = marketStatusCode(
        marketState.status as Record<string, unknown>,
    );
    const settlementStatus = marketStatusLabel(
        marketState.status as Record<string, unknown>,
    );
    const winnerCode = marketWinnerCode(marketState.winner as Record<string, unknown>);
    const winnerLabel =
        winnerCode === 1 ? "A" : winnerCode === 2 ? "B" : ("NONE" as const);
    const resolvedCorrectly =
        settlementStatus === "RESOLVED" && winnerLabel === winner;
    const claimCorrectly =
        winningSharesAfterClaim === 0n &&
        claimantBalanceAfterClaim > claimantBalanceBeforeClaim;
    const claimsProcessed = claimCorrectly;
    const bestBid = readNumberField(marketState, "bestBid");
    const bestAsk = readNumberField(marketState, "bestAsk");
    const bookNotCrossed = bestAsk <= 0 || bestAsk === 1_000 || bestBid < bestAsk;

    return {
        preset,
        seed,
        winner,
        duelLabel: `${preset.id}:${seed}`,
        duelKeyHex: Buffer.from(market.duelKey).toString("hex"),
        marketRef: market.marketState.toBase58(),
        rpcUrl: runtime.rpcUrl,
        contracts: {
            oracle: runtime.fightProgram.programId.toBase58(),
            clob: runtime.clobProgram.programId.toBase58(),
        },
        fees: {
            treasuryBps: readNumberField(config, "tradeTreasuryFeeBps"),
            mmBps: readNumberField(config, "tradeMarketMakerFeeBps"),
            winningsMmBps: readNumberField(config, "winningsMarketMakerFeeBps"),
            treasuryAccruedLamports:
                (await runtime.getBalanceLamports(runtime.authority.publicKey)) -
                initialBalances.authority,
            mmAccruedLamports:
                (await runtime.getBalanceLamports(actors.marketMaker.keypair.publicKey)) -
                initialBalances.marketMaker,
        },
        actors: actorSnapshots,
        book: {
            bids: [],
            asks: [],
        },
        traces,
        attackRejected,
        peakInventory: tradeFlow.peakInventory,
        quoteChecks: tradeFlow.quoteChecks,
        quoteActiveChecks: tradeFlow.quoteActiveChecks,
        orderChurn: traces.filter((trace) =>
            trace.action === "place_order" || trace.action === "take_quote"
        ).length,
        lockTransitionLatencyMs,
        resolvedCorrectly,
        claimCorrectly,
        settlementStatus,
        settlementStatusCode,
        winnerCode,
        winnerLabel,
        totalAShares,
        totalBShares,
        bestBid,
        bestAsk,
        marketMakerPnl,
        attackerPnl,
        treasuryPnl: lamportsToSol(
            (await runtime.getBalanceLamports(runtime.authority.publicKey)) -
                initialBalances.authority,
        ),
        marketMakerDrawdownBps,
        claimsProcessed,
        bookNotCrossed,
        mmSolvent: marketMakerBalanceBeforeClaim > 0n,
        degraded: false,
        debug: {
            makerUserBalancePda: tradeFlow.makerUserBalancePda,
            takerUserBalancePda: tradeFlow.takerUserBalancePda,
            makerSharesBeforeClaim: {
                aShares: readBigintField(tradeFlow.makerSnapshotBeforeClaim, "aShares").toString(),
                bShares: readBigintField(tradeFlow.makerSnapshotBeforeClaim, "bShares").toString(),
            },
            takerSharesBeforeClaim: {
                aShares: readBigintField(tradeFlow.takerSnapshotBeforeClaim, "aShares").toString(),
                bShares: readBigintField(tradeFlow.takerSnapshotBeforeClaim, "bShares").toString(),
            },
            claimant: claimant.name,
        },
    };
}

export async function runSolanaProofScenario(
    runtime: SolanaProgramRuntime,
    input: {
        preset: ScenarioPreset;
        seed: string;
        winner: "A" | "B";
        attackUnauthorizedReporter: boolean;
        onLog?: (message: string) => void;
        onStage?: (stage: string) => void;
    },
): Promise<SolanaProofOutcome> {
    const actors = runtime.createActors();
    await runtime.fundActors(Object.values(actors));

    const initialBalances = {
        authority: await runtime.getBalanceLamports(runtime.authority.publicKey),
        marketMaker: await runtime.getBalanceLamports(actors.marketMaker.keypair.publicKey),
        taker: await runtime.getBalanceLamports(actors.taker.keypair.publicKey),
        attacker: await runtime.getBalanceLamports(actors.attacker.keypair.publicKey),
    };

    const duelKey = buildSeededDuelKey(input.preset.id, input.seed);
    const market = await runtime.createOpenMarket(
        duelKey,
        actors.marketMaker.keypair.publicKey,
        `https://hyperbet.local/${input.preset.id}`,
    );
    input.onLog?.(
        `Solana proof market ready: ${market.marketState.toBase58()} on ${runtime.rpcUrl}`,
    );

    const traces: AgentActionTrace[] = [];
    const tradeFlow = await executeTradeFlow(
        runtime,
        market,
        actors.marketMaker,
        actors.taker,
        traces,
    );

    let attackRejected = false;
    if (input.attackUnauthorizedReporter) {
        try {
            await runtime.reportResult({
                reporter: actors.attacker.keypair,
                duelKey,
                winner: input.winner,
                seed: `${input.seed}:attacker`,
                metadataUri: `https://hyperbet.local/${input.preset.id}/unauthorized`,
            });
            traces.push(
                buildTrace("unauthorized_report", market, {
                    actor: actors.attacker.name,
                    ok: false,
                    message: "unauthorized result unexpectedly succeeded",
                }),
            );
        } catch (error) {
            attackRejected = hasProgramError(error, "Unauthorized");
            traces.push(
                buildTrace("unauthorized_report", market, {
                    actor: actors.attacker.name,
                    ok: attackRejected,
                    message: attackRejected
                        ? "unauthorized oracle write rejected"
                        : error instanceof Error
                          ? error.message
                          : String(error),
                }),
            );
        }
    }

    input.onStage?.("resolve");
    const outcome = await finalizeOutcome(
        runtime,
        input.preset,
        input.seed,
        market,
        actors,
        initialBalances,
        traces,
        tradeFlow,
        input.winner,
        attackRejected,
        input.onStage,
    );

    return outcome;
}
