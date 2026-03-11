import type { Contract, JsonRpcSigner, JsonRpcProvider } from "ethers";
import {
    BUY_SIDE,
    SELL_SIDE,
    MARKET_KIND_DUEL_WINNER,
    quoteCost,
    quoteWithFees,
    randomInt,
    clamp,
    MAX_PRICE,
    SIDE_A,
} from "./helpers.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentAction = {
    type: "placeOrder" | "cancelOrder" | "claim" | "noop";
    side?: number;
    price?: number;
    amount?: bigint;
    orderId?: number;
    label?: string;
};

export type SimContext = {
    duelKey: string;
    marketKey: string;
    bestBid: number;
    bestAsk: number;
    mid: number;
    totalAShares: bigint;
    totalBShares: bigint;
    tick: number;
    treasuryFeeBps: bigint;
    mmFeeBps: bigint;
    agentActiveOrderIds: number[];
    agentPosition: { aShares: bigint; bShares: bigint; aStake: bigint; bStake: bigint };
};

export type AgentConfig = {
    name: string;
    strategy: string;
    description: string;
    enabled: boolean;
    color: string;
};

// ─── Base Agent ──────────────────────────────────────────────────────────────

export abstract class BaseAgent {
    config: AgentConfig;
    signer: JsonRpcSigner;
    clob: Contract;
    activeOrderIds: number[] = [];
    tradeCount = 0;

    constructor(config: AgentConfig, signer: JsonRpcSigner, clob: Contract) {
        this.config = config;
        this.signer = signer;
        this.clob = clob;
    }

    abstract decide(ctx: SimContext): AgentAction[];

    async executeActions(
        actions: AgentAction[],
        ctx: SimContext,
    ): Promise<string[]> {
        const logs: string[] = [];
        for (const action of actions) {
            try {
                if (action.type === "placeOrder" && action.side && action.price && action.amount) {
                    const valueNeeded = quoteWithFees(
                        action.side,
                        action.price,
                        action.amount,
                        ctx.treasuryFeeBps,
                        ctx.mmFeeBps,
                    ) + 50n; // small buffer

                    const tx = await (this.clob.connect(this.signer) as any).placeOrder(
                        ctx.duelKey,
                        MARKET_KIND_DUEL_WINNER,
                        action.side,
                        action.price,
                        action.amount,
                        { value: valueNeeded },
                    );
                    const receipt = await tx.wait();
                    this.tradeCount++;

                    // Extract order ID from events
                    const iface = this.clob.interface;
                    let orderId = 0;
                    for (const log of receipt.logs) {
                        try {
                            const parsed = iface.parseLog({ topics: log.topics, data: log.data });
                            if (parsed?.name === "OrderPlaced") {
                                orderId = Number(parsed.args.orderId ?? parsed.args[1]);
                                break;
                            }
                        } catch { /* skip */ }
                    }
                    if (orderId > 0) this.activeOrderIds.push(orderId);

                    const sideLabel = action.side === BUY_SIDE ? "BUY" : "SELL";
                    logs.push(
                        `[${this.config.name}] ${sideLabel} @${action.price} x${action.amount} (order #${orderId})`,
                    );
                } else if (action.type === "cancelOrder" && action.orderId) {
                    try {
                        const tx = await (this.clob.connect(this.signer) as any).cancelOrder(
                            ctx.duelKey,
                            MARKET_KIND_DUEL_WINNER,
                            action.orderId,
                        );
                        await tx.wait();
                        logs.push(`[${this.config.name}] CANCEL order #${action.orderId}`);
                    } catch {
                        // Order was already filled or cancelled — silently clean up
                    }
                    this.activeOrderIds = this.activeOrderIds.filter(
                        (id) => id !== action.orderId,
                    );
                }
            } catch (err: any) {
                const msg = err.message || "";
                // Suppress noisy but harmless errors
                if (!msg.includes("not maker") && !msg.includes("order inactive") && !msg.includes("market not open") && !msg.includes("betting closed")) {
                    logs.push(`[${this.config.name}] ERROR: ${msg.slice(0, 120)}`);
                }
            }
        }
        return logs;
    }
}

// ─── Retail Agent ────────────────────────────────────────────────────────────
export class RetailAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Retail Trader",
                strategy: "retail",
                description: "Random buy/sell at mid ± noise, realistic retail flow",
                enabled: true,
                color: "#4fc3f7",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        if (Math.random() < 0.4) return []; // 40% chance of sitting out

        const isBuy = Math.random() > 0.5;
        const noise = randomInt(-50, 50);
        const price = clamp(ctx.mid + noise, 10, 990);
        const amount = BigInt(randomInt(1, 5)) * 1000n;

        return [
            {
                type: "placeOrder",
                side: isBuy ? BUY_SIDE : SELL_SIDE,
                price,
                amount,
                label: isBuy ? "retail buy" : "retail sell",
            },
        ];
    }
}

// ─── Market Maker Agent ──────────────────────────────────────────────────────
export class MarketMakerAgent extends BaseAgent {
    private targetSpreadBps = 200;

    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Market Maker",
                strategy: "market_maker",
                description: "Two-sided quoting around mid with inventory awareness",
                enabled: true,
                color: "#66bb6a",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        const actions: AgentAction[] = [];

        // Cancel stale orders first
        if (this.activeOrderIds.length > 4) {
            const toCancel = this.activeOrderIds.slice(0, 2);
            for (const id of toCancel) {
                actions.push({ type: "cancelOrder", orderId: id });
            }
        }

        const quoteWidth = Math.max(
            Math.ceil((this.targetSpreadBps * ctx.mid) / 10000),
            5,
        );
        const bidPrice = clamp(Math.floor(ctx.mid - quoteWidth / 2), 10, 990);
        const askPrice = clamp(Math.ceil(ctx.mid + quoteWidth / 2), 10, 990);
        const amount = BigInt(randomInt(2, 8)) * 1000n;

        actions.push(
            { type: "placeOrder", side: BUY_SIDE, price: bidPrice, amount, label: "MM bid" },
            { type: "placeOrder", side: SELL_SIDE, price: askPrice, amount, label: "MM ask" },
        );

        return actions;
    }
}

// ─── Whale Agent ─────────────────────────────────────────────────────────────
export class WhaleAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Whale",
                strategy: "whale",
                description: "Large single-side orders that move the book",
                enabled: true,
                color: "#ab47bc",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        if (Math.random() < 0.7) return []; // Only trades 30% of ticks

        const isBuy = Math.random() > 0.5;
        const price = isBuy
            ? clamp(ctx.mid + randomInt(10, 40), 10, 990)
            : clamp(ctx.mid - randomInt(10, 40), 10, 990);
        const amount = BigInt(randomInt(5, 20)) * 1000n;

        return [
            {
                type: "placeOrder",
                side: isBuy ? BUY_SIDE : SELL_SIDE,
                price,
                amount,
                label: isBuy ? "whale buy" : "whale sell",
            },
        ];
    }
}

// ─── MEV Frontrunner Agent ───────────────────────────────────────────────────
export class MevFrontrunnerAgent extends BaseAgent {
    private provider: JsonRpcProvider;

    constructor(signer: JsonRpcSigner, clob: Contract, provider: JsonRpcProvider) {
        super(
            {
                name: "MEV Frontrunner",
                strategy: "mev_frontrunner",
                description: "Front-runs retail orders in the same block",
                enabled: false,
                color: "#ef5350",
            },
            signer,
            clob,
        );
        this.provider = provider;
    }

    decide(ctx: SimContext): AgentAction[] {
        if (Math.random() < 0.6) return [];

        // Simulate front-running by placing aggressive orders at better prices
        const isBuy = Math.random() > 0.5;
        const price = isBuy
            ? clamp(ctx.bestAsk > 0 && ctx.bestAsk < MAX_PRICE ? ctx.bestAsk : ctx.mid + 20, 10, 990)
            : clamp(ctx.bestBid > 0 ? ctx.bestBid : ctx.mid - 20, 10, 990);
        const amount = BigInt(randomInt(1, 5)) * 1000n;

        return [
            {
                type: "placeOrder",
                side: isBuy ? BUY_SIDE : SELL_SIDE,
                price,
                amount,
                label: "MEV frontrun",
            },
        ];
    }
}

// ─── Sandwich Agent ──────────────────────────────────────────────────────────
export class SandwichAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Sandwich Bot",
                strategy: "sandwich",
                description: "Front-run + back-run around retail orders",
                enabled: false,
                color: "#ff7043",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        if (Math.random() < 0.7) return [];

        const amount = BigInt(randomInt(1, 5)) * 1000n;
        // Buy before and sell after — in sim, these are sequential
        return [
            {
                type: "placeOrder",
                side: BUY_SIDE,
                price: clamp(ctx.mid + 15, 10, 990),
                amount,
                label: "sandwich front",
            },
            {
                type: "placeOrder",
                side: SELL_SIDE,
                price: clamp(ctx.mid + 30, 10, 990),
                amount,
                label: "sandwich back",
            },
        ];
    }
}

// ─── Wash Trader Agent ───────────────────────────────────────────────────────
export class WashTraderAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Wash Trader",
                strategy: "wash_trader",
                description: "Self-trades to inflate volume",
                enabled: false,
                color: "#ffa726",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        if (Math.random() < 0.5) return [];

        const price = clamp(ctx.mid, 10, 990);
        const amount = BigInt(randomInt(1, 3)) * 1000n;

        // Place both sides at the same price to self-trade
        return [
            { type: "placeOrder", side: SELL_SIDE, price, amount, label: "wash sell" },
            { type: "placeOrder", side: BUY_SIDE, price, amount, label: "wash buy" },
        ];
    }
}

// ─── Oracle Attack Agent ─────────────────────────────────────────────────────
export class OracleAttackAgent extends BaseAgent {
    private oracle: Contract;

    constructor(signer: JsonRpcSigner, clob: Contract, oracle: Contract) {
        super(
            {
                name: "Oracle Attacker",
                strategy: "oracle_attack",
                description: "Attempts unauthorized oracle manipulation",
                enabled: false,
                color: "#e53935",
            },
            signer,
            clob,
        );
        this.oracle = oracle;
    }

    decide(_ctx: SimContext): AgentAction[] {
        // This agent doesn't use the standard action system — it's handled specially
        return [{ type: "noop", label: "oracle attack attempt" }];
    }

    async executeOracleAttack(duelKey: string): Promise<string> {
        try {
            const { ethers } = await import("ethers");
            const tx = await (this.oracle.connect(this.signer) as any).reportResult(
                duelKey,
                SIDE_A,
                13,
                ethers.keccak256(ethers.toUtf8Bytes("attack-replay")),
                ethers.keccak256(ethers.toUtf8Bytes("attack-result")),
                BigInt(Math.floor(Date.now() / 1000)) + 90n,
                "attack",
            );
            await tx.wait();
            return `[${this.config.name}] ⚠️ ATTACK SUCCEEDED (unexpected!)`;
        } catch {
            return `[${this.config.name}] 🛡️ Attack rejected by access control (expected)`;
        }
    }
}

// ─── Cabal Agent ─────────────────────────────────────────────────────────────
export class CabalAgent extends BaseAgent {
    private biasAgainstHouse: boolean;

    constructor(signer: JsonRpcSigner, clob: Contract, biasAgainstHouse = true) {
        super(
            {
                name: biasAgainstHouse ? "Cabal (Anti-House)" : "Cabal (Pro-House)",
                strategy: "cabal",
                description: "Coordinated group betting against/with the house bias",
                enabled: false,
                color: "#7e57c2",
            },
            signer,
            clob,
        );
        this.biasAgainstHouse = biasAgainstHouse;
    }

    decide(ctx: SimContext): AgentAction[] {
        if (Math.random() < 0.3) return [];

        // Cabal always bets one direction aggressively
        const side = this.biasAgainstHouse ? BUY_SIDE : SELL_SIDE;
        const price = side === BUY_SIDE
            ? clamp(ctx.mid + randomInt(20, 60), 10, 990)
            : clamp(ctx.mid - randomInt(20, 60), 10, 990);
        const amount = BigInt(randomInt(1, 5)) * 1000n;

        return [
            { type: "placeOrder", side, price, amount, label: "cabal push" },
        ];
    }
}

// ─── Arbitrageur Agent ───────────────────────────────────────────────────────
export class ArbitrageurAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Arbitrageur",
                strategy: "arbitrageur",
                description: "Exploits crossed book by buying low and selling high",
                enabled: false,
                color: "#26a69a",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        // Only act when spread is crossed or very tight (arb opportunity)
        if (ctx.bestBid <= 0 || ctx.bestAsk >= MAX_PRICE) return [];
        if (ctx.bestBid < ctx.bestAsk - 20) return []; // needs tight/crossed spread

        const amount = BigInt(randomInt(1, 3)) * 1000n;

        return [
            {
                type: "placeOrder",
                side: SELL_SIDE,
                price: ctx.bestBid,
                amount,
                label: "arb sell at bid",
            },
            {
                type: "placeOrder",
                side: BUY_SIDE,
                price: ctx.bestAsk,
                amount,
                label: "arb buy at ask",
            },
        ];
    }
}

// ─── Stress Test Agent ───────────────────────────────────────────────────────
export class StressTestAgent extends BaseAgent {
    constructor(signer: JsonRpcSigner, clob: Contract) {
        super(
            {
                name: "Stress Tester",
                strategy: "stress_test",
                description: "Floods orders to test throughput limits",
                enabled: false,
                color: "#78909c",
            },
            signer,
            clob,
        );
    }

    decide(ctx: SimContext): AgentAction[] {
        const actions: AgentAction[] = [];
        const count = randomInt(3, 8);

        for (let i = 0; i < count; i++) {
            const isBuy = Math.random() > 0.5;
            const price = clamp(ctx.mid + randomInt(-100, 100), 10, 990);
            const amount = BigInt(randomInt(1, 3)) * 1000n;
            actions.push({
                type: "placeOrder",
                side: isBuy ? BUY_SIDE : SELL_SIDE,
                price,
                amount,
                label: `stress #${i}`,
            });
        }

        return actions;
    }
}

// ─── Scenario Presets ────────────────────────────────────────────────────────

export type ScenarioPreset = {
    name: string;
    description: string;
    enabledStrategies: string[];
};

export const SCENARIO_PRESETS: ScenarioPreset[] = [
    {
        name: "Normal Market",
        description: "Retail traders + market maker in a balanced market",
        enabledStrategies: ["retail", "market_maker"],
    },
    {
        name: "Retail Rush",
        description: "All retail traders active, overwhelming thin MM liquidity",
        enabledStrategies: ["retail", "market_maker"],
    },
    {
        name: "Whale Impact",
        description: "Normal market with a whale dumping large orders",
        enabledStrategies: ["retail", "market_maker", "whale"],
    },
    {
        name: "MEV Extraction",
        description: "Multiple MEV bots frontrunning retail order flow",
        enabledStrategies: ["retail", "market_maker", "mev_frontrunner"],
    },
    {
        name: "Sandwich Attack",
        description: "Multiple sandwich bots wrapping retail orders",
        enabledStrategies: ["retail", "market_maker", "sandwich"],
    },
    {
        name: "Double Sandwich + MEV",
        description: "Both sandwich bots and MEV bots extracting from retail",
        enabledStrategies: ["retail", "market_maker", "sandwich", "mev_frontrunner"],
    },
    {
        name: "Wash Trading",
        description: "Wash trader inflating volume alongside normal flow",
        enabledStrategies: ["retail", "market_maker", "wash_trader"],
    },
    {
        name: "Oracle Attack",
        description: "Attacker trying to manipulate the duel oracle",
        enabledStrategies: ["retail", "market_maker", "oracle_attack"],
    },
    {
        name: "Cabal Coordination",
        description: "Two coordinated cabal groups betting against each other",
        enabledStrategies: ["retail", "market_maker", "cabal"],
    },
    {
        name: "Arbitrage Hunt",
        description: "Arbitrageur exploiting tight/crossed spreads",
        enabledStrategies: ["retail", "market_maker", "arbitrageur"],
    },
    {
        name: "Stress Test",
        description: "High-frequency flood of orders overwhelming the book",
        enabledStrategies: ["retail", "market_maker", "stress_test"],
    },
    {
        name: "Whale vs MEV",
        description: "Whale moving markets while MEV bots try to extract",
        enabledStrategies: ["market_maker", "whale", "mev_frontrunner"],
    },
    {
        name: "Attack Gauntlet",
        description: "All attack agents vs thin MM — maximum adversarial pressure",
        enabledStrategies: [
            "market_maker",
            "mev_frontrunner",
            "sandwich",
            "wash_trader",
            "cabal",
            "arbitrageur",
        ],
    },
    {
        name: "Liquidity Crisis",
        description: "Only the underfunded MM and whale — tests insolvency edge cases",
        enabledStrategies: ["market_maker", "whale"],
    },
    {
        name: "Full Chaos",
        description: "All 15 agents active simultaneously — maximum entropy",
        enabledStrategies: [
            "retail",
            "market_maker",
            "whale",
            "mev_frontrunner",
            "sandwich",
            "wash_trader",
            "oracle_attack",
            "cabal",
            "arbitrageur",
            "stress_test",
        ],
    },
];

