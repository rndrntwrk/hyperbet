import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { ContractFactory, JsonRpcProvider, ethers, type Contract } from "ethers";
import { WebSocketServer, WebSocket } from "ws";

import {
    loadArtifact,
    duelKey,
    hashParticipant,
    sleep,
    MARKET_KIND_DUEL_WINNER,
    DUEL_STATUS_BETTING_OPEN,
    SIDE_A,
    SIDE_B,
    BUY_SIDE,
    SELL_SIDE,
    MAX_PRICE,
    shortAddr,
    formatEth,
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
let oracle: Contract;
let clob: Contract;
let agents: BaseAgent[] = [];
let simRunning = false;
let simSpeed = 500; // ms between ticks
let simTick = 0;
let currentDuelKey = "";
let currentMarketKey = "";
let currentDuelLabel = "";
let duelCounter = 0;
let treasuryAddr = "";
let mmAddr = "";
const eventLog: any[] = [];
const initialBalances: Map<string, string> = new Map();
const wsClients = new Set<WebSocket>();

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

    const signers = await Promise.all(
        Array.from({ length: 20 }, (_, i) => provider.getSigner(i)),
    );
    const admin = signers[0];
    const operator = signers[1];
    const reporter = signers[2];
    const treasury = signers[3];
    const marketMaker = signers[4];

    // Compile contracts if needed
    if (!existsSync(join(CONTRACTS_DIR, "artifacts", "contracts", "GoldClob.sol", "GoldClob.json"))) {
        console.log("[deploy] Artifacts not found. Run `npx hardhat compile` in packages/evm-contracts first.");
        process.exit(1);
    }
    
    treasuryAddr = await treasury.getAddress();
    mmAddr = await marketMaker.getAddress();

    const oracleArtifact = loadArtifact(CONTRACTS_DIR, "DuelOutcomeOracle");
    const clobArtifact = loadArtifact(CONTRACTS_DIR, "GoldClob");

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

    for (const agent of agents) {
        if (!agent.config.enabled) continue;

        try {
            // Build context
            const market = await clob.getMarket(currentDuelKey, MARKET_KIND_DUEL_WINNER);
            const position = await clob.positions(currentMarketKey, await agent.signer.getAddress());

            const ctx: SimContext = {
                duelKey: currentDuelKey,
                marketKey: currentMarketKey,
                bestBid: Number(market.bestBid),
                bestAsk: Number(market.bestAsk) >= MAX_PRICE ? 0 : Number(market.bestAsk),
                mid: calculateMid(Number(market.bestBid), Number(market.bestAsk)),
                totalAShares: market.totalAShares,
                totalBShares: market.totalBShares,
                tick: simTick,
                treasuryFeeBps: await clob.tradeTreasuryFeeBps(),
                mmFeeBps: await clob.tradeMarketMakerFeeBps(),
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
                continue;
            }

            const actions = agent.decide(ctx);
            if (actions.length > 0) {
                const logs = await agent.executeActions(actions, ctx);
                for (const msg of logs) {
                    broadcast({ type: "log", data: { message: msg, tick: simTick } });
                }
            }
        } catch (err: any) {
            broadcast({
                type: "log",
                data: { message: `[${agent.config.name}] ERROR: ${err.message?.slice(0, 150)}`, tick: simTick },
            });
        }
    }

    // Broadcast full state update
    await broadcastState();
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
        const market = await clob.getMarket(currentDuelKey, MARKET_KIND_DUEL_WINNER);

        // Gather agent states
        const agentStates = await Promise.all(
            agents.map(async (agent) => {
                const addr = await agent.signer.getAddress();
                const balance = await provider.getBalance(addr);
                const position = await clob.positions(currentMarketKey, addr);
                const balanceFormatted = formatEth(balance);
                const initBal = initialBalances.get(addr) || "10000";
                const pnl = (Number(balanceFormatted) - Number(initBal)).toFixed(4);

                return {
                    name: agent.config.name,
                    strategy: agent.config.strategy,
                    description: agent.config.description,
                    enabled: agent.config.enabled,
                    color: agent.config.color,
                    address: addr,
                    balance: balanceFormatted,
                    pnl,
                    tradeCount: agent.tradeCount,
                    activeOrders: agent.activeOrderIds.length,
                    position: {
                        aShares: position.aShares.toString(),
                        bShares: position.bShares.toString(),
                        aStake: formatEth(position.aStake),
                        bStake: formatEth(position.bStake),
                    },
                };
            }),
        );

        // Build order book snapshot (scan populated price levels)
        const book = await buildOrderBook();

        const treasuryBalance = await provider.getBalance(treasuryAddr);
        const mmBalance = await provider.getBalance(mmAddr);

        const state = {
            type: "state",
            data: {
                tick: simTick,
                running: simRunning,
                speed: simSpeed,
                duel: {
                    label: currentDuelLabel,
                    key: currentDuelKey,
                    counter: duelCounter,
                },
                market: {
                    exists: market.exists,
                    status: Number(market.status),
                    winner: Number(market.winner),
                    bestBid: Number(market.bestBid),
                    bestAsk: Number(market.bestAsk),
                    totalAShares: market.totalAShares.toString(),
                    totalBShares: market.totalBShares.toString(),
                },
                contracts: {
                    oracle: await oracle.getAddress(),
                    clob: await clob.getAddress(),
                },
                fees: {
                    treasuryBps: (await clob.tradeTreasuryFeeBps()).toString(),
                    mmBps: (await clob.tradeMarketMakerFeeBps()).toString(),
                    winningsMmBps: (await clob.winningsMarketMakerFeeBps()).toString(),
                    treasuryAccruedWei: (treasuryBalance - ethers.parseEther(initialBalances.get(treasuryAddr) || "10000")).toString(),
                    mmAccruedWei: (mmBalance - ethers.parseEther(initialBalances.get(mmAddr) || "10000")).toString(),
                },
                agents: agentStates,
                book,
                scenarios: SCENARIO_PRESETS,
                eventLogCount: eventLog.length,
            },
        };

        broadcast(state);
    } catch (err: any) {
        console.error("[state] Error building state:", err.message);
    }
}

async function buildOrderBook(): Promise<{ bids: any[]; asks: any[] }> {
    const bids: { price: number; total: string }[] = [];
    const asks: { price: number; total: string }[] = [];

    // Sample price levels around the interesting range
    const market = await clob.getMarket(currentDuelKey, MARKET_KIND_DUEL_WINNER);
    const bestBid = Number(market.bestBid);
    const bestAsk = Number(market.bestAsk);

    // Scan bid side downward from bestBid
    if (bestBid > 0) {
        for (let p = bestBid; p >= Math.max(1, bestBid - 100); p -= 5) {
            try {
                const level = await clob.getPriceLevel(currentDuelKey, MARKET_KIND_DUEL_WINNER, BUY_SIDE, p);
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
                const level = await clob.getPriceLevel(currentDuelKey, MARKET_KIND_DUEL_WINNER, SELL_SIDE, p);
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

    const tx1 = await (oracle.connect(reporter) as any).reportResult(
      currentDuelKey,
      winnerSide,
      BigInt(Math.floor(Math.random() * 1000000)),
      ethers.keccak256(ethers.toUtf8Bytes(`replay-${currentDuelLabel}`)),
      ethers.keccak256(ethers.toUtf8Bytes(`result-${currentDuelLabel}`)),
      now,
      `resolved-${currentDuelLabel}`,
    );
    await tx1.wait();

    const tx2 = await (clob.connect(operator) as any).syncMarketFromOracle(currentDuelKey, MARKET_KIND_DUEL_WINNER);
    await tx2.wait();

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
            const position = await clob.positions(currentMarketKey, await agent.signer.getAddress());
            if (position.aShares > 0n || position.bShares > 0n) {
                const txClaim = await (clob.connect(agent.signer) as any).claim(currentDuelKey, MARKET_KIND_DUEL_WINNER);
                await txClaim.wait();
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
                const preset = SCENARIO_PRESETS.find((p) => p.name === msg.value);
                if (preset) {
                    for (const agent of agents) {
                        agent.config.enabled = preset.enabledStrategies.includes(agent.config.strategy);
                    }
                    broadcast({
                        type: "log",
                        data: { message: `🎯 Scenario: ${preset.name}`, tick: simTick },
                    });
                    broadcastState();
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║   Hyperbet Simulation Dashboard                        ║");
    console.log("╚══════════════════════════════════════════════════════════╝");

    // 1. Start Anvil
    await startAnvil();

    // 2. Deploy contracts
    await deployContracts();

    // 3. Start HTTP server
    const httpServer = createServer(serveStatic);
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
