import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { ContractFactory, JsonRpcProvider, ethers, type Contract } from "ethers";
import { WebSocketServer, WebSocket } from "ws";
import {
    computeToxicityBps,
    type AgentActionTrace,
    type MitigationGate,
    type ScenarioResult,
} from "@hyperbet/mm-core";

import {
    loadArtifact,
    duelKey,
    hashParticipant,
    sleep,
    random,
    setRandomSeed,
    resetRandomSource,
    MARKET_KIND_DUEL_WINNER,
    DUEL_STATUS_BETTING_OPEN,
    SIDE_A,
    SIDE_B,
    BUY_SIDE,
    SELL_SIDE,
    MAX_PRICE,
    shortAddr,
    formatEth,
    withTimeout,
} from "./helpers.js";

import {
    BaseAgent,
    RetailAgent,
    MarketMakerAgent,
    WhaleAgent,
    MevFrontrunnerAgent,
    SandwichAgent,
    WashTraderAgent,
    OracleAttackAgent,
    CabalAgent,
    ArbitrageurAgent,
    StressTestAgent,
    SCENARIO_PRESETS,
    type SimContext,
    type ScenarioPreset,
} from "./agents.js";

// ─── Config ──────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ANVIL_PORT = 18546;
const WS_PORT = 3400;
const HTTP_PORT = 3401;
const PUBLIC_DIR = join(__dirname, "..", "public");
const CONTRACTS_DIR = join(__dirname, "..", "..", "evm-contracts");

// ─── State ───────────────────────────────────────────────────────────────────
let anvilProcess: ChildProcess | null = null;
let provider: JsonRpcProvider;
let readProvider: JsonRpcProvider;
let oracle: Contract;
let oracleRead: Contract;
let clob: Contract;
let clobRead: Contract;
let agents: BaseAgent[] = [];
let simRunning = false;
let simSpeed = 500; // ms between ticks
let simTick = 0;
let currentDuelKey = "";
let currentMarketKey = "";
let currentDuelLabel = "";
let duelCounter = 0;
let currentScenarioId = "manual";
let treasuryAddr = "";
let mmAddr = "";
const eventLog: any[] = [];
const initialBalances: Map<string, string> = new Map();
const wsClients = new Set<WebSocket>();
const ATTACKER_STRATEGIES = new Set([
    "mev_frontrunner",
    "sandwich",
    "wash_trader",
    "oracle_attack",
    "cabal",
    "arbitrageur",
    "stress_test",
]);
const MARKET_STATUS_RESOLVED = 3;
const MARKET_STATUS_CANCELLED = 4;
let peakInventorySeen = 0;
let worstMarketMakerPnl = 0;
let bestAttackerPnlSeen = 0;
let scenarioObservedTicks = 0;
let scenarioQuotedTicks = 0;
let scenarioSpreadBpsTotal = 0;
let scenarioSpreadSamples = 0;
let lastResolveLatencyMs: number | null = null;
let lastComputedState: Record<string, any> | null = null;
let scenarioRunInFlight = false;
let scenarioHistory: ScenarioResult[] = [];
let baselineSnapshotId: string | null = null;
let baselineRuntimeState:
    | {
          duelCounter: number;
          currentDuelLabel: string;
          currentDuelKey: string;
          currentMarketKey: string;
      }
    | null = null;

function resetScenarioMetrics(): void {
    peakInventorySeen = 0;
    worstMarketMakerPnl = 0;
    bestAttackerPnlSeen = 0;
    scenarioObservedTicks = 0;
    scenarioQuotedTicks = 0;
    scenarioSpreadBpsTotal = 0;
    scenarioSpreadSamples = 0;
    lastResolveLatencyMs = null;
    lastComputedState = null;
    simTick = 0;
}

function applyScenarioPresetByName(name: string): ScenarioPreset {
    const preset = SCENARIO_PRESETS.find((entry) => entry.name === name || entry.id === name);
    if (!preset) {
        throw new Error(`Unknown scenario preset: ${name}`);
    }

    currentScenarioId = preset.id;
    for (const agent of agents) {
        agent.config.enabled = preset.enabledStrategies.includes(agent.config.strategy);
    }
    return preset;
}

async function restoreScenarioBaseline(): Promise<void> {
    if (!provider || !baselineSnapshotId || !baselineRuntimeState) {
        throw new Error("Scenario baseline is not initialized");
    }

    simRunning = false;
    await provider.send("evm_revert", [baselineSnapshotId]);
    baselineSnapshotId = await provider.send("evm_snapshot", []);

    duelCounter = baselineRuntimeState.duelCounter;
    currentDuelLabel = baselineRuntimeState.currentDuelLabel;
    currentDuelKey = baselineRuntimeState.currentDuelKey;
    currentMarketKey = baselineRuntimeState.currentMarketKey;
    currentScenarioId = "manual";
    eventLog.length = 0;
    for (const agent of agents) {
        agent.activeOrderIds = [];
        agent.tradeCount = 0;
    }
    resetScenarioMetrics();
}

// ─── Anvil Management ────────────────────────────────────────────────────────

async function startAnvil(): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log(`[anvil] Starting on port ${ANVIL_PORT}...`);
        anvilProcess = spawn("anvil", [
            "--host", "127.0.0.1",
            "--port", String(ANVIL_PORT),
            "--chain-id", "31337",
            "--accounts", "20",
            "--balance", "10000",
            "--silent",
        ]);

        anvilProcess.on("error", (err) => {
            console.error("[anvil] Failed to start:", err.message);
            reject(err);
        });

        anvilProcess.stderr?.on("data", (chunk: Buffer) => {
            const text = chunk.toString();
            if (text.includes("error") || text.includes("Error")) {
                console.error("[anvil stderr]", text.trim());
            }
        });

        // Wait for Anvil to be ready
        const checkReady = async () => {
            for (let i = 0; i < 60; i++) {
                try {
                    const testProvider = new JsonRpcProvider(`http://127.0.0.1:${ANVIL_PORT}`);
                    await testProvider.getBlockNumber();
                    console.log("[anvil] Ready ✓");
                    resolve();
                    return;
                } catch {
                    await sleep(500);
                }
            }
            reject(new Error("Anvil did not start within 30s"));
        };

        checkReady();
    });
}

function stopAnvil(): void {
    if (anvilProcess) {
        anvilProcess.kill("SIGTERM");
        anvilProcess = null;
        console.log("[anvil] Stopped");
    }
}

// ─── Deploy Contracts ────────────────────────────────────────────────────────

async function deployContracts(): Promise<void> {
    provider = new JsonRpcProvider(`http://127.0.0.1:${ANVIL_PORT}`, 31337);
    readProvider = new JsonRpcProvider(`http://127.0.0.1:${ANVIL_PORT}`, 31337);

    const signers = await Promise.all(
        Array.from({ length: 20 }, (_, i) => provider.getSigner(i)),
    );
    const admin = signers[0];
    const operator = signers[1];
    const reporter = signers[2];
    const treasury = signers[3];
    const marketMaker = signers[4];

    treasuryAddr = await treasury.getAddress();
    mmAddr = await marketMaker.getAddress();

    let oracleArtifact;
    let clobArtifact;
    try {
        oracleArtifact = loadArtifact(CONTRACTS_DIR, "DuelOutcomeOracle");
        clobArtifact = loadArtifact(CONTRACTS_DIR, "GoldClob");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(
            `[deploy] Contract artifacts not found. Build packages/evm-contracts first. (${message})`,
        );
        process.exit(1);
    }

    console.log("[deploy] Deploying DuelOutcomeOracle...");
    const oracleFactory = new ContractFactory(oracleArtifact.abi as any, oracleArtifact.bytecode, admin);
    oracle = (await oracleFactory.deploy(
        await admin.getAddress(),
        await reporter.getAddress(),
    )) as unknown as Contract;
    await oracle.waitForDeployment();

    console.log("[deploy] Deploying GoldClob...");
    const clobFactory = new ContractFactory(clobArtifact.abi as any, clobArtifact.bytecode, admin);
    clob = (await clobFactory.deploy(
        await admin.getAddress(),
        await operator.getAddress(),
        await oracle.getAddress(),
        await treasury.getAddress(),
        await marketMaker.getAddress(),
    )) as unknown as Contract;
    await clob.waitForDeployment();

    const oracleAddr = await oracle.getAddress();
    const clobAddr = await clob.getAddress();
    oracleRead = oracle.connect(readProvider) as unknown as Contract;
    clobRead = clob.connect(readProvider) as unknown as Contract;
    console.log(`[deploy] Oracle: ${oracleAddr}`);
    console.log(`[deploy] CLOB:   ${clobAddr}`);

    // Set up event listeners on CLOB
    setupEventListeners();

    // Create initial agents
    await createAgents(signers);

    // Create initial duel
    await openNewDuel();
}

function setupEventListeners(): void {
    const iface = clob.interface;

    clob.on("*", (event: any) => {
        try {
            const entry = {
                timestamp: new Date().toISOString(),
                event: event.eventName || event.fragment?.name || "unknown",
                args: {} as Record<string, any>,
                blockNumber: event.log?.blockNumber,
                txHash: event.log?.transactionHash,
            };

            // Parse args
            if (event.args) {
                const fragment = event.fragment;
                if (fragment && (fragment as any).inputs) {
                    for (let i = 0; i < (fragment as any).inputs.length; i++) {
                        const name = (fragment as any).inputs[i].name;
                        const val = event.args[i];
                        entry.args[name] = typeof val === "bigint" ? val.toString() : val;
                    }
                }
            }

            eventLog.push(entry);
            if (eventLog.length > 1000) eventLog.shift();

            broadcast({ type: "event", data: entry });
        } catch {
            // Ignore parsing errors for catch-all listener
        }
    });
}

async function createAgents(signers: any[]): Promise<void> {
    // Define agents with their desired starting balances
    const agentDefs: { agent: BaseAgent; balance: string }[] = [
        { agent: new RetailAgent(signers[5], clob), balance: "5" },
        { agent: new RetailAgent(signers[6], clob), balance: "5" },
        { agent: new RetailAgent(signers[16], clob), balance: "3" },
        { agent: new MarketMakerAgent(signers[7], clob), balance: "1" },
        { agent: new WhaleAgent(signers[8], clob), balance: "10" },
        { agent: new MevFrontrunnerAgent(signers[9], clob, provider), balance: "2" },
        { agent: new MevFrontrunnerAgent(signers[17], clob, provider), balance: "2" },
        { agent: new SandwichAgent(signers[10], clob), balance: "3" },
        { agent: new SandwichAgent(signers[18], clob), balance: "2" },
        { agent: new WashTraderAgent(signers[11], clob), balance: "3" },
        { agent: new OracleAttackAgent(signers[12], clob, oracle), balance: "2" },
        { agent: new CabalAgent(signers[13], clob, true), balance: "3" },
        { agent: new CabalAgent(signers[19], clob, false), balance: "3" },
        { agent: new ArbitrageurAgent(signers[14], clob), balance: "2" },
        { agent: new StressTestAgent(signers[15], clob), balance: "2" },
    ];

    agents = agentDefs.map(d => d.agent);

    // Name duplicated agent types
    agents[1].config.name = "Retail Trader 2";
    agents[1].config.color = "#29b6f6";
    agents[2].config.name = "Retail Trader 3";
    agents[2].config.color = "#4dd0e1";
    agents[6].config.name = "MEV Bot 2";
    agents[6].config.color = "#ff6e40";
    agents[8].config.name = "Sandwich Bot 2";
    agents[8].config.color = "#e040fb";
    agents[12].config.name = "Cabal (Counter)";
    agents[12].config.color = "#b388ff";

    // Set balances via anvil_setBalance
    for (let i = 0; i < agents.length; i++) {
        const addr = await agents[i].signer.getAddress();
        const balWei = ethers.parseEther(agentDefs[i].balance);
        await provider.send("anvil_setBalance", [addr, "0x" + balWei.toString(16)]);
        initialBalances.set(addr, agentDefs[i].balance);
        console.log(`[fund] ${agents[i].config.name}: ${agentDefs[i].balance} ETH`);
    }
}

async function openNewDuel(): Promise<void> {
    duelCounter++;
    currentDuelLabel = `sim-duel-${duelCounter}`;
    currentDuelKey = duelKey(currentDuelLabel);
    currentScenarioId = "manual";
    resetScenarioMetrics();

    const reporter = await provider.getSigner(2);
    const operator = await provider.getSigner(1);

    const block = await provider.getBlock("latest");
    const now = BigInt(block?.timestamp ?? Math.floor(Date.now() / 1000));

    const tx1 = await (oracle.connect(reporter) as any).upsertDuel(
      currentDuelKey,
      hashParticipant(`${currentDuelLabel}:agent-alpha`),
      hashParticipant(`${currentDuelLabel}:agent-beta`),
      now,
      now + 604800n, // 1 week betting window (Anvil advances time per-tx)
      now + 1209600n, // 2 week duel start
      `sim://${currentDuelLabel}`,
      DUEL_STATUS_BETTING_OPEN,
  );
  await tx1.wait();

  const tx2 = await (clob.connect(operator) as any).createMarketForDuel(currentDuelKey, MARKET_KIND_DUEL_WINNER);
  await tx2.wait();

    currentMarketKey = await clob.marketKey(currentDuelKey, MARKET_KIND_DUEL_WINNER);

    console.log(`[sim] Opened duel: ${currentDuelLabel}`);
    broadcast({ type: "duel_opened", data: { label: currentDuelLabel, duelKey: currentDuelKey } });
}

// ─── Simulation Loop ─────────────────────────────────────────────────────────

async function simulationTick(): Promise<void> {
    simTick++;
    const treasuryFeeBps = await withTimeout(
        clobRead.tradeTreasuryFeeBps(),
        5_000,
        `tick ${simTick} treasuryFeeBps`,
    );
    const mmFeeBps = await withTimeout(
        clobRead.tradeMarketMakerFeeBps(),
        5_000,
        `tick ${simTick} mmFeeBps`,
    );

    for (const agent of agents) {
        if (!agent.config.enabled) continue;

        try {
            await withTimeout(
                (async () => {
                    // Build context
                    const market = await withTimeout(
                        clobRead.getMarket(currentDuelKey, MARKET_KIND_DUEL_WINNER),
                        5_000,
                        `tick ${simTick} agent ${agent.config.name} getMarket`,
                    );
                    const position = await withTimeout(
                        clobRead.positions(currentMarketKey, await agent.signer.getAddress()),
                        5_000,
                        `tick ${simTick} agent ${agent.config.name} getPosition`,
                    );
                    const ctx: SimContext = {
                        duelKey: currentDuelKey,
                        marketKey: currentMarketKey,
                        bestBid: Number(market.bestBid),
                        bestAsk: Number(market.bestAsk) >= MAX_PRICE ? 0 : Number(market.bestAsk),
                        mid: calculateMid(Number(market.bestBid), Number(market.bestAsk)),
                        totalAShares: market.totalAShares,
                        totalBShares: market.totalBShares,
                        tick: simTick,
                        treasuryFeeBps,
                        mmFeeBps,
                        agentActiveOrderIds: agent.activeOrderIds,
                        agentPosition: {
                            aShares: position.aShares,
                            bShares: position.bShares,
                            aStake: position.aStake,
                            bStake: position.bStake,
                        },
                    };

                    // Special handling for oracle attack agent
                    if (agent instanceof OracleAttackAgent && agent.config.enabled) {
                        if (simTick % 10 === 0) {
                            const msg = await agent.executeOracleAttack(currentDuelKey);
                            broadcast({ type: "log", data: { message: msg, tick: simTick } });
                        }
                        return;
                    }

                    const actions = agent.decide(ctx);
                    if (actions.length > 0) {
                        const logs = await withTimeout(
                            agent.executeActions(actions, ctx),
                            Math.max(12_000, actions.length * 12_000),
                            `tick ${simTick} agent ${agent.config.name} executeActions`,
                        );
                        for (const msg of logs) {
                            broadcast({ type: "log", data: { message: msg, tick: simTick } });
                        }
                    }
                })(),
                30_000,
                `tick ${simTick} agent ${agent.config.name}`,
            );
        } catch (err: any) {
            const message = err.message?.slice(0, 150) ?? "unknown simulation error";
            broadcast({
                type: "log",
                data: { message: `[${agent.config.name}] ERROR: ${message}`, tick: simTick },
            });
            if (message.includes("timed out after")) {
                throw err;
            }
        }

        await sleep(25);
    }

    // Broadcast full state update
    await withTimeout(
        broadcastState(),
        10_000,
        `tick ${simTick} broadcastState`,
    );
}

function calculateMid(bestBid: number, bestAsk: number): number {
    const bid = bestBid > 0 ? bestBid : 0;
    const ask = bestAsk > 0 && bestAsk < MAX_PRICE ? bestAsk : 0;

    if (bid > 0 && ask > 0) return Math.floor((bid + ask) / 2);
    if (bid > 0) return bid;
    if (ask > 0) return ask;
    return 500; // default mid
}

async function broadcastState(): Promise<void> {
    try {
        const market = await clobRead.getMarket(currentDuelKey, MARKET_KIND_DUEL_WINNER);

        // Gather agent states
        const agentSnapshots = [];
        for (const agent of agents) {
            const addr = await agent.signer.getAddress();
            const balance = await readProvider.getBalance(addr);
            const position = await clobRead.positions(currentMarketKey, addr);
            const balanceFormatted = formatEth(balance);
            const initBal = initialBalances.get(addr) || "10000";
            const pnlValue = Number(balanceFormatted) - Number(initBal);
            const inventoryUnits = Number(position.aShares + position.bShares);

            agentSnapshots.push({
                name: agent.config.name,
                strategy: agent.config.strategy,
                description: agent.config.description,
                enabled: agent.config.enabled,
                color: agent.config.color,
                address: addr,
                balance: balanceFormatted,
                pnl: pnlValue.toFixed(4),
                pnlValue,
                tradeCount: agent.tradeCount,
                activeOrders: agent.activeOrderIds.length,
                inventoryUnits,
                positionRaw: {
                    aShares: position.aShares.toString(),
                    bShares: position.bShares.toString(),
                    aStake: position.aStake.toString(),
                    bStake: position.bStake.toString(),
                },
                position: {
                    aShares: position.aShares.toString(),
                    bShares: position.bShares.toString(),
                    aStake: formatEth(position.aStake),
                    bStake: formatEth(position.bStake),
                },
            });
        }
        const agentStates = agentSnapshots.map(
            ({ pnlValue, inventoryUnits, positionRaw, ...agentState }) => agentState,
        );

        // Build order book snapshot (scan populated price levels)
        const book = await buildOrderBook();

        const treasuryBalance = await readProvider.getBalance(treasuryAddr);
        const mmBalance = await readProvider.getBalance(mmAddr);
        const marketStatus = Number(market.status);
        const bestBid = Number(market.bestBid);
        const bestAsk = Number(market.bestAsk);
        const boundedBestAsk = bestAsk > 0 && bestAsk < MAX_PRICE ? bestAsk : null;
        const spreadWidthBps = computeToxicityBps(
            bestBid > 0 ? bestBid : null,
            boundedBestAsk,
        );
        const orderChurn = eventLog.filter((entry) =>
            entry.event === "OrderPlaced" ||
            entry.event === "OrderCancelled" ||
            entry.event === "OrderMatched",
        ).length;
        const attackerPnl = agentSnapshots
            .filter((agent) => ATTACKER_STRATEGIES.has(agent.strategy))
            .reduce((max, agent) => Math.max(max, agent.pnlValue), 0);
        bestAttackerPnlSeen = Math.max(bestAttackerPnlSeen, attackerPnl);

        const marketMakerAgent = agentSnapshots.find(
            (agent) => agent.strategy === "market_maker",
        );
        if (marketMakerAgent) {
            worstMarketMakerPnl = Math.min(
                worstMarketMakerPnl,
                marketMakerAgent.pnlValue,
            );
        }
        peakInventorySeen = Math.max(
            peakInventorySeen,
            ...agentSnapshots.map((agent) => agent.inventoryUnits),
        );

        const marketMakerDrawdownBps = marketMakerAgent
            ? Math.round(
                (Math.abs(Math.min(0, worstMarketMakerPnl)) /
                    Math.max(
                        0.0001,
                        Number(initialBalances.get(marketMakerAgent.address) || "1"),
                    )) *
                    10_000,
            )
            : 0;
        const claimsProcessed =
            marketStatus < MARKET_STATUS_RESOLVED ||
            agentSnapshots.every(
                (agent) =>
                    BigInt(agent.positionRaw.aShares) === 0n &&
                    BigInt(agent.positionRaw.bShares) === 0n &&
                    BigInt(agent.positionRaw.aStake) === 0n &&
                    BigInt(agent.positionRaw.bStake) === 0n,
            );
        const settlementConsistent =
            marketStatus === MARKET_STATUS_RESOLVED
                ? Number(market.winner) === SIDE_A || Number(market.winner) === SIDE_B
                : marketStatus === MARKET_STATUS_CANCELLED
                  ? Number(market.winner) === 0
                  : true;
        const bookNotCrossed = boundedBestAsk == null || bestBid <= 0 || bestBid < boundedBestAsk;
        const mmSolvent =
            (marketMakerAgent ? Number(marketMakerAgent.balance) > 0 : true) &&
            mmBalance > 0n;
        const mitigationGates: MitigationGate[] = [
            {
                name: "mmSolvent",
                passed: mmSolvent,
                reason: mmSolvent ? null : "market-maker wallet depleted",
            },
            {
                name: "bookNotCrossed",
                passed: bookNotCrossed,
                reason: bookNotCrossed ? null : "best bid crosses best ask",
            },
            {
                name: "noPositiveAttackerPnl",
                passed: bestAttackerPnlSeen <= 0,
                reason:
                    bestAttackerPnlSeen <= 0
                        ? null
                        : `attacker pnl peaked at ${bestAttackerPnlSeen.toFixed(4)} ETH`,
            },
            {
                name: "settlementConsistent",
                passed: settlementConsistent,
                reason: settlementConsistent ? null : "winner/status mismatch after settlement",
            },
            {
                name: "claimsProcessed",
                passed: claimsProcessed,
                reason: claimsProcessed ? null : "settled market still has residual positions",
            },
        ];
        const protocolMmPnl = Number(
            formatEth(
                mmBalance - ethers.parseEther(initialBalances.get(mmAddr) || "10000"),
            ),
        );
        if (marketStatus === 1) {
            scenarioObservedTicks += 1;
            if ((marketMakerAgent?.activeOrders ?? 0) > 0) {
                scenarioQuotedTicks += 1;
            }
            scenarioSpreadBpsTotal += spreadWidthBps;
            scenarioSpreadSamples += 1;
        }

        const state = {
            type: "state",
            data: {
                tick: simTick,
                running: simRunning,
                speed: simSpeed,
                scenario: {
                    id: currentScenarioId,
                },
                duel: {
                    label: currentDuelLabel,
                    key: currentDuelKey,
                    counter: duelCounter,
                },
                market: {
                    exists: market.exists,
                    status: marketStatus,
                    winner: Number(market.winner),
                    bestBid,
                    bestAsk,
                    totalAShares: market.totalAShares.toString(),
                    totalBShares: market.totalBShares.toString(),
                },
                contracts: {
                    oracle: await oracle.getAddress(),
                    clob: await clob.getAddress(),
                },
                fees: {
                    treasuryBps: (await clobRead.tradeTreasuryFeeBps()).toString(),
                    mmBps: (await clobRead.tradeMarketMakerFeeBps()).toString(),
                    winningsMmBps: (await clobRead.winningsMarketMakerFeeBps()).toString(),
                    treasuryAccruedWei: (treasuryBalance - ethers.parseEther(initialBalances.get(treasuryAddr) || "10000")).toString(),
                    mmAccruedWei: (mmBalance - ethers.parseEther(initialBalances.get(mmAddr) || "10000")).toString(),
                },
                agents: agentStates,
                book,
                mitigation: {
                    gates: mitigationGates,
                    metrics: {
                        attackerPnlCurrent: attackerPnl,
                        attackerPnlPeak: bestAttackerPnlSeen,
                        marketMakerPnl:
                            marketMakerAgent?.pnlValue ?? 0,
                        protocolMarketMakerPnl: protocolMmPnl,
                        marketMakerDrawdownBps,
                        peakInventory: peakInventorySeen,
                        spreadWidthBps,
                        orderChurn,
                        settlementConsistent,
                        claimsProcessed,
                    },
                },
                scenarios: SCENARIO_PRESETS,
                eventLogCount: eventLog.length,
            },
        };

        lastComputedState = state.data;
        broadcast(state);
    } catch (err: any) {
        console.error("[state] Error building state:", err.message);
    }
}

async function buildOrderBook(): Promise<{ bids: any[]; asks: any[] }> {
    const bids: { price: number; total: string }[] = [];
    const asks: { price: number; total: string }[] = [];

    // Sample price levels around the interesting range
    const market = await clobRead.getMarket(currentDuelKey, MARKET_KIND_DUEL_WINNER);
    const bestBid = Number(market.bestBid);
    const bestAsk = Number(market.bestAsk);

    // Scan bid side downward from bestBid
    if (bestBid > 0) {
        for (let p = bestBid; p >= Math.max(1, bestBid - 100); p -= 5) {
            try {
                const level = await clobRead.getPriceLevel(currentDuelKey, MARKET_KIND_DUEL_WINNER, BUY_SIDE, p);
                if (level[2] > 0n) {
                    bids.push({ price: p, total: level[2].toString() });
                }
            } catch { /* skip */ }
        }
    }

    // Scan ask side upward from bestAsk
    if (bestAsk > 0 && bestAsk < MAX_PRICE) {
        for (let p = bestAsk; p <= Math.min(999, bestAsk + 100); p += 5) {
            try {
                const level = await clobRead.getPriceLevel(currentDuelKey, MARKET_KIND_DUEL_WINNER, SELL_SIDE, p);
                if (level[2] > 0n) {
                    asks.push({ price: p, total: level[2].toString() });
                }
            } catch { /* skip */ }
        }
    }

    return { bids, asks };
}

async function runSimLoop(): Promise<void> {
    while (simRunning) {
        await simulationTick();
        await sleep(simSpeed);
    }
}

function buildScenarioTraces(limit = 80): AgentActionTrace[] {
    return eventLog.slice(-limit).map((entry) => ({
        actor: String(entry.args?.maker ?? "protocol"),
        action: String(entry.event ?? "unknown"),
        chainKey: "bsc",
        duelKey: currentDuelKey,
        marketRef: currentMarketKey,
        price:
            entry.args?.price == null
                ? null
                : Number(entry.args.price),
        units:
            entry.args?.amount != null
                ? Number(entry.args.amount)
                : entry.args?.matchedAmount != null
                  ? Number(entry.args.matchedAmount)
                  : null,
        txRef: entry.txHash ?? null,
        ok: true,
        message: entry.event,
    }));
}

function buildScenarioResult(
    preset: ScenarioPreset,
    seed: string,
): ScenarioResult {
    if (!lastComputedState) {
        throw new Error("Scenario finished without a computed state snapshot");
    }

    return {
        name: preset.name,
        seed,
        chainKey: "bsc",
        attackerPnl: Number(lastComputedState.mitigation.metrics.attackerPnlPeak ?? 0),
        marketMakerPnl: Number(lastComputedState.mitigation.metrics.marketMakerPnl ?? 0),
        maxDrawdownBps: Number(lastComputedState.mitigation.metrics.marketMakerDrawdownBps ?? 0),
        peakInventory: Number(lastComputedState.mitigation.metrics.peakInventory ?? 0),
        quoteUptimeRatio:
            scenarioObservedTicks > 0 ? scenarioQuotedTicks / scenarioObservedTicks : 0,
        spreadWidthBps:
            scenarioSpreadSamples > 0
                ? Math.round(scenarioSpreadBpsTotal / scenarioSpreadSamples)
                : Number(lastComputedState.mitigation.metrics.spreadWidthBps ?? 0),
        orderChurn: Number(lastComputedState.mitigation.metrics.orderChurn ?? 0),
        lockTransitionLatencyMs: lastResolveLatencyMs,
        resolvedCorrectly:
            Boolean(lastComputedState.mitigation.metrics.settlementConsistent) &&
            Number(lastComputedState.market.status) === MARKET_STATUS_RESOLVED,
        claimCorrectly: Boolean(lastComputedState.mitigation.metrics.claimsProcessed),
        gates: lastComputedState.mitigation.gates as MitigationGate[],
        traces: buildScenarioTraces(),
    };
}

async function runScenarioPreset(
    scenarioName: string,
    options: {
        seed?: string;
        ticks?: number;
        winner?: "A" | "B";
    } = {},
): Promise<ScenarioResult> {
    if (scenarioRunInFlight) {
        throw new Error("A scenario run is already in progress");
    }

    scenarioRunInFlight = true;
    try {
        await restoreScenarioBaseline();
        const preset = applyScenarioPresetByName(scenarioName);
        const seed = options.seed?.trim() || `${preset.id}-seed`;
        const ticks = Math.max(1, Math.min(200, options.ticks ?? preset.defaultTicks));
        const winner = options.winner ?? preset.defaultWinner;

        setRandomSeed(seed);
        broadcast({
            type: "log",
            data: {
                message: `🧪 Scenario run starting: ${preset.name} seed=${seed} ticks=${ticks}`,
                tick: simTick,
            },
        });
        await broadcastState();

        for (let i = 0; i < ticks; i += 1) {
            await withTimeout(
                simulationTick(),
                25_000,
                `scenario ${preset.id} tick ${i + 1}`,
            );
        }

        const resolveStartedAt = Date.now();
        await withTimeout(
            resolveDuel(winner === "B" ? SIDE_B : SIDE_A),
            30_000,
            `scenario ${preset.id} resolve`,
        );
        lastResolveLatencyMs = Date.now() - resolveStartedAt;

        const result = buildScenarioResult(preset, seed);
        scenarioHistory = [result, ...scenarioHistory].slice(0, 50);
        broadcast({
            type: "scenario_result",
            data: result,
        });
        return result;
    } finally {
        resetRandomSource();
        scenarioRunInFlight = false;
    }
}

// ─── Resolve Duel ────────────────────────────────────────────────────────────

async function resolveDuel(winnerSide: number): Promise<void> {
  try {
    const reporter = await provider.getSigner(2);
    const operator = await provider.getSigner(1);

    // Advance Anvil's block time past the betting window (1 week forward)
    await provider.send("evm_increaseTime", [604800]);
    await provider.send("evm_mine", []);

    const block = await provider.getBlock("latest");
    const now = BigInt(block?.timestamp ?? Math.floor(Date.now() / 1000));

    const tx1: any = await withTimeout(
        (oracle.connect(reporter) as any).reportResult(
            currentDuelKey,
            winnerSide,
            BigInt(Math.floor(random() * 1000000)),
            ethers.keccak256(ethers.toUtf8Bytes(`replay-${currentDuelLabel}`)),
            ethers.keccak256(ethers.toUtf8Bytes(`result-${currentDuelLabel}`)),
            now,
            `resolved-${currentDuelLabel}`,
        ),
        10_000,
        "resolve reportResult",
    );
    await withTimeout(tx1.wait(), 10_000, "resolve reportResult receipt");

    const tx2: any = await withTimeout(
        (clob.connect(operator) as any).syncMarketFromOracle(currentDuelKey, MARKET_KIND_DUEL_WINNER),
        10_000,
        "resolve syncMarketFromOracle",
    );
    await withTimeout(tx2.wait(), 10_000, "resolve syncMarketFromOracle receipt");

    broadcast({
        type: "log",
        data: {
            message: `🏆 Duel resolved! Winner: Side ${winnerSide === SIDE_A ? "A" : "B"}`,
            tick: simTick,
        },
    });

    // Auto-pause so agents don't spam "market not open" errors
    simRunning = false;
    broadcast({ type: "log", data: { message: "⏸️ Simulation auto-paused after resolution. Click 'New Duel' then 'Start' to continue.", tick: simTick } });

    // Auto-claim for all agents
    for (const agent of agents) {
        try {
            const position = await withTimeout(
                clobRead.positions(currentMarketKey, await agent.signer.getAddress()),
                5_000,
                `${agent.config.name} claim position lookup`,
            );
            if (position.aShares > 0n || position.bShares > 0n) {
                const txClaim: any = await withTimeout(
                    (clob.connect(agent.signer) as any).claim(currentDuelKey, MARKET_KIND_DUEL_WINNER),
                    10_000,
                    `${agent.config.name} claim`,
                );
                await withTimeout(
                    txClaim.wait(),
                    10_000,
                    `${agent.config.name} claim receipt`,
                );
                broadcast({
                    type: "log",
                    data: { message: `[${agent.config.name}] Claimed winnings`, tick: simTick },
                });
            }
        } catch (err: any) {
            broadcast({
                type: "log",
                data: { message: `[${agent.config.name}] Claim: ${err.message?.slice(0, 80)}`, tick: simTick },
            });
        }
    }

    await broadcastState();
  } catch (err: any) {
    broadcast({
        type: "log",
        data: { message: `⚠️ Resolution error: ${err.message?.slice(0, 120)}`, tick: simTick },
    });
    console.error("[resolve] Error:", err.shortMessage || err.message);
    throw err;
  }
}

// ─── WebSocket Server ────────────────────────────────────────────────────────

function broadcast(msg: any): void {
    const payload = JSON.stringify(msg);
    for (const ws of wsClients) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
        }
    }
}

function handleWsMessage(data: string): void {
    try {
        const msg = JSON.parse(data);
        switch (msg.command) {
            case "start":
                if (!simRunning) {
                    simRunning = true;
                    runSimLoop();
                    broadcast({ type: "log", data: { message: "▶ Simulation started", tick: simTick } });
                }
                break;

            case "pause":
                simRunning = false;
                broadcast({ type: "log", data: { message: "⏸ Simulation paused", tick: simTick } });
                break;

            case "step":
                if (!simRunning) {
                    simulationTick();
                }
                break;

            case "speed":
                simSpeed = Math.max(100, Math.min(5000, Number(msg.value ?? 500)));
                broadcast({ type: "log", data: { message: `⚡ Speed set to ${simSpeed}ms`, tick: simTick } });
                break;

            case "scenario": {
                const preset = SCENARIO_PRESETS.find(
                    (p) => p.name === msg.value || p.id === msg.value,
                );
                if (preset) {
                    applyScenarioPresetByName(preset.id);
                    broadcast({
                        type: "log",
                        data: { message: `🎯 Scenario: ${preset.name}`, tick: simTick },
                    });
                    void broadcastState();
                }
                break;
            }

            case "toggle_agent": {
                const agent = agents.find((a) => a.config.strategy === msg.strategy);
                if (agent) {
                    agent.config.enabled = !agent.config.enabled;
                    broadcastState();
                }
                break;
            }

            case "resolve": {
                const side = msg.winner === "B" ? SIDE_B : SIDE_A;
                resolveDuel(side);
                break;
            }

            case "new_duel":
                openNewDuel().then(() => broadcastState());
                break;

            case "get_state":
                broadcastState();
                break;

            case "get_events":
                broadcast({ type: "events_bulk", data: eventLog.slice(-200) });
                break;

            default:
                break;
        }
    } catch (err: any) {
        console.error("[ws] Message error:", err.message);
    }
}

// ─── HTTP Server (static files) ──────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url === "/" ? "/index.html" : req.url ?? "/index.html";
    const filePath = join(PUBLIC_DIR, url);

    if (!existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
    }

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    try {
        const content = readFileSync(filePath);
        res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "no-cache",
        });
        res.end(content);
    } catch {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
    }
}

function writeJson(
    res: ServerResponse,
    statusCode: number,
    payload: unknown,
): void {
    res.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
    });
    res.end(JSON.stringify(payload, null, 2));
}

async function handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
): Promise<void> {
    const requestUrl = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? `127.0.0.1:${HTTP_PORT}`}`,
    );

    if (requestUrl.pathname === "/api/state") {
        writeJson(res, 200, {
            ok: true,
            state: lastComputedState,
        });
        return;
    }

    if (requestUrl.pathname === "/api/scenarios") {
        writeJson(res, 200, {
            ok: true,
            scenarios: SCENARIO_PRESETS,
            latest: scenarioHistory[0] ?? null,
            historyCount: scenarioHistory.length,
        });
        return;
    }

    if (requestUrl.pathname === "/api/scenarios/results") {
        writeJson(res, 200, {
            ok: true,
            results: scenarioHistory,
        });
        return;
    }

    if (requestUrl.pathname === "/api/scenarios/run") {
        const scenarioName =
            requestUrl.searchParams.get("name") ??
            requestUrl.searchParams.get("id");
        if (!scenarioName) {
            writeJson(res, 400, {
                ok: false,
                error: "Missing scenario name or id",
            });
            return;
        }

        try {
            const ticksParam = requestUrl.searchParams.get("ticks");
            const winnerParam = requestUrl.searchParams.get("winner");
            const result = await runScenarioPreset(scenarioName, {
                seed: requestUrl.searchParams.get("seed") ?? undefined,
                ticks:
                    ticksParam == null || ticksParam === ""
                        ? undefined
                        : Number(ticksParam),
                winner:
                    winnerParam === "A" || winnerParam === "B"
                        ? winnerParam
                        : undefined,
            });
            writeJson(res, 200, {
                ok: true,
                result,
            });
        } catch (error) {
            writeJson(res, 500, {
                ok: false,
                error: (error as Error).message,
            });
        }
        return;
    }

    serveStatic(req, res);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║   Hyperbet Simulation Dashboard                        ║");
    console.log("╚══════════════════════════════════════════════════════════╝");

    // 1. Start Anvil
    await startAnvil();

    // 2. Deploy contracts
    await deployContracts();
    baselineRuntimeState = {
        duelCounter,
        currentDuelLabel,
        currentDuelKey,
        currentMarketKey,
    };
    baselineSnapshotId = await provider.send("evm_snapshot", []);
    eventLog.length = 0;
    await broadcastState();

    // 3. Start HTTP server
    const httpServer = createServer((req, res) => {
        void handleHttpRequest(req, res);
    });
    httpServer.listen(HTTP_PORT, () => {
        console.log(`[http] Dashboard at http://localhost:${HTTP_PORT}`);
    });

    // 4. Start WebSocket server
    const wss = new WebSocketServer({ port: WS_PORT });
    wss.on("connection", (ws) => {
        wsClients.add(ws);
        console.log(`[ws] Client connected (total: ${wsClients.size})`);

        // Send initial state
        broadcastState();
        broadcast({ type: "events_bulk", data: eventLog.slice(-200) });

        ws.on("message", (data) => handleWsMessage(data.toString()));
        ws.on("close", () => {
            wsClients.delete(ws);
            console.log(`[ws] Client disconnected (total: ${wsClients.size})`);
        });
    });
    console.log(`[ws] WebSocket server on ws://localhost:${WS_PORT}`);

    // Cleanup on exit
    const cleanup = () => {
        simRunning = false;
        stopAnvil();
        wss.close();
        httpServer.close();
        process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    console.log("\n🎮 Ready! Open http://localhost:3401 in your browser.\n");
}

main().catch((err) => {
    console.error("Fatal:", err);
    stopAnvil();
    process.exit(1);
});
