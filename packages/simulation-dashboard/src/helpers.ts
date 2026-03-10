import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ethers } from "ethers";

// ─── Contract Constants ──────────────────────────────────────────────────────
export const MARKET_KIND_DUEL_WINNER = 0;
export const DUEL_STATUS_BETTING_OPEN = 2;
export const SIDE_A = 1;
export const SIDE_B = 2;
export const BUY_SIDE = 1;
export const SELL_SIDE = 2;
export const MAX_PRICE = 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function duelKey(label: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
}

export function hashParticipant(label: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
}

export function quoteCost(
    side: number,
    price: number,
    amount: bigint,
): bigint {
    const component = BigInt(side === BUY_SIDE ? price : MAX_PRICE - price);
    return (amount * component) / BigInt(MAX_PRICE);
}

export function quoteWithFees(
    side: number,
    price: number,
    amount: bigint,
    treasuryFeeBps: bigint,
    mmFeeBps: bigint,
): bigint {
    const cost = quoteCost(side, price, amount);
    const treasuryFee = (cost * treasuryFeeBps) / 10_000n;
    const mmFee = (cost * mmFeeBps) / 10_000n;
    return cost + treasuryFee + mmFee;
}

export type Artifact = {
    abi: readonly unknown[];
    bytecode: string;
};

export function loadArtifact(contractsDir: string, name: string): Artifact {
    // Try the nested contracts/<name>.sol/<name>.json format first
    const nestedPath = join(
        contractsDir,
        "artifacts",
        "contracts",
        `${name}.sol`,
        `${name}.json`,
    );
    try {
        return JSON.parse(readFileSync(nestedPath, "utf8")) as Artifact;
    } catch {
        // Try perps subdirectory
        const perpsPath = join(
            contractsDir,
            "artifacts",
            "contracts",
            "perps",
            `${name}.sol`,
            `${name}.json`,
        );
        return JSON.parse(readFileSync(perpsPath, "utf8")) as Artifact;
    }
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function formatEth(wei: bigint): string {
    return ethers.formatEther(wei);
}

export function shortAddr(addr: string): string {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
