import { describe, it, expect, vi, beforeEach } from "vitest";
import { HyperbetSolanaClient, duelKeyHexToBytes } from "../src/solana/client";
import { SIDE_BID, SIDE_ASK } from "../src/types";

// Mock @solana/web3.js and @coral-xyz/anchor
vi.mock("@solana/web3.js", () => {
  class MockPublicKey {
    constructor(public value: string) {}
    toBase58() { return this.value; }
    toBuffer() { return Buffer.from("mock-pubkey"); }
    static findProgramAddressSync() { return [new MockPublicKey("mock-pda"), 255]; }
  }
  return {
    Connection: class {},
    Keypair: {
      fromSecretKey: vi.fn(() => ({ publicKey: new MockPublicKey("mock-wallet") }))
    },
    PublicKey: MockPublicKey,
    SystemProgram: { programId: new MockPublicKey("11111111111111111111111111111111") }
  };
});

vi.mock("bs58", () => ({
  default: {
    decode: vi.fn(() => new Uint8Array(64))
  }
}));

vi.mock("@coral-xyz/anchor", () => {
  const mockRpc = vi.fn().mockResolvedValue("mock-tx-sig");
  return {
    AnchorProvider: class {},
    Wallet: class {},
    Program: class {
      account = {
        marketConfig: {
          fetch: vi.fn().mockResolvedValue({
            treasury: { toBase58: () => "mock-treasury" },
            marketMaker: { toBase58: () => "mock-mm" }
          })
        }
      };
      methods = {
         placeOrder: vi.fn(() => ({
            accountsPartial: vi.fn(() => ({
               remainingAccounts: vi.fn(() => ({
                  rpc: mockRpc
               }))
            }))
         })),
         cancelOrder: vi.fn(() => ({
            accountsPartial: vi.fn(() => ({
               remainingAccounts: vi.fn(() => ({
                  rpc: mockRpc
               }))
            }))
         })),
         claimWinnings: vi.fn(() => ({
            accountsPartial: vi.fn(() => ({
               remainingAccounts: vi.fn(() => ({
                  rpc: mockRpc
               }))
            }))
         }))
      };
    }
  };
});

describe("HyperbetSolanaClient", () => {
  let client: HyperbetSolanaClient;

  beforeEach(() => {
    client = new HyperbetSolanaClient(
      "http://localhost:8899",
      "mock-base58-key",
      "11111111111111111111111111111111",
      "11111111111111111111111111111111"
    );
    vi.clearAllMocks();
  });

  it("should initialize anchor program", () => {
    expect(client.clob).toBeDefined();
    expect(client.oracle).toBeDefined();
  });

  it("should derive correct PDAs", () => {
    const pda = client.getMarketConfigPda();
    expect(pda).toBeDefined();
    expect(pda.toBase58()).toBe("mock-pda");
  });

  it("should place an order via RPC", async () => {
    const tx = await client.placeOrder({
      duelId: "0".repeat(64),
      side: "sell",
      price: 500,
      amount: 1000n
    });
    expect(tx).toBe("mock-tx-sig");
  });

  it("should cancel an order via RPC", async () => {
    const tx = await client.cancelOrder({
      duelId: "0".repeat(64),
      orderId: 5
    });
    expect(tx).toBe("mock-tx-sig");
  });

  it("should claim winnings via RPC", async () => {
     const tx = await client.claim({
        duelId: "0".repeat(64),
     });
     expect(tx).toBe("mock-tx-sig");
  });
});
