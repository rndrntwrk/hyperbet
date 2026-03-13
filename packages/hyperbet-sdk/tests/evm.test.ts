import { describe, it, expect, vi, beforeEach } from "vitest";
import { HyperbetEVMClient } from "../src/evm/client";
import { HyperbetClient } from "../src";
import { SIDE_BID, SIDE_ASK, MARKET_KIND_DUEL_WINNER } from "../src/types";

// Mock ethers
vi.mock("ethers", () => {
  const mockWait = vi.fn().mockResolvedValue({ status: 1 });
  const mockPlaceOrder = vi.fn().mockResolvedValue({ wait: mockWait });
  const mockCancelOrder = vi.fn().mockResolvedValue({ wait: mockWait });
  const mockClaim = vi.fn().mockResolvedValue({ wait: mockWait });

  class MockJsonRpcProvider {
    constructor(public url: string) {}
  }
  class MockWallet {
    constructor(public privateKey: string) {}
  }
  class MockContract {
    tradeTreasuryFeeBps = vi.fn().mockResolvedValue(100n);
    tradeMarketMakerFeeBps = vi.fn().mockResolvedValue(100n);
    placeOrder = mockPlaceOrder;
    cancelOrder = mockCancelOrder;
    claim = mockClaim;
  }

  return {
    JsonRpcProvider: MockJsonRpcProvider,
    Wallet: MockWallet,
    Contract: MockContract,
    ethers: {
      keccak256: vi.fn((val) => "mock-hash"),
      toUtf8Bytes: vi.fn(),
    },
  };
});

describe("HyperbetEVMClient", () => {
  let client: HyperbetEVMClient;

  beforeEach(() => {
    client = new HyperbetEVMClient(
      "http://localhost:8545",
      "0x" + "1".repeat(64),
      "0xC10b",
      "0x0rac1e"
    );
    vi.clearAllMocks();
  });

  it("should initialize providers and contracts", () => {
    expect(client.provider).toBeDefined();
    expect(client.wallet).toBeDefined();
    expect(client.clob).toBeDefined();
    expect(client.oracle).toBeDefined();
  });

  it("should place an order and compute correct value with fees", async () => {
    await client.placeOrder({
      duelId: "test-duel",
      side: "buy",
      price: 600,
      amount: 1000n, // Assuming nominal units that don't underflow
    });
    
    // verify placeOrder was called
    expect(client.clob.placeOrder).toHaveBeenCalled();
    const args = (client.clob.placeOrder as any).mock.calls[0];
    
    expect(args[1]).toBe(MARKET_KIND_DUEL_WINNER);
    expect(args[2]).toBe(SIDE_BID);
    expect(args[3]).toBe(600);
    expect(args[4]).toBe(1000n);
    expect(args[5].value).toBeDefined(); // The total value to send
  });

  it("should cancel an order", async () => {
    await client.cancelOrder({ duelId: "test-duel", orderId: 1 });
    expect(client.clob.cancelOrder).toHaveBeenCalledWith("mock-hash", MARKET_KIND_DUEL_WINNER, 1);
  });

  it("should claim winnings", async () => {
    await client.claim({ duelId: "test-duel" });
    expect(client.clob.claim).toHaveBeenCalledWith("mock-hash", MARKET_KIND_DUEL_WINNER);
  });
});


describe("HyperbetClient network RPC defaults", () => {
  const evmPrivateKey = "0x" + "1".repeat(64);

  it("uses BSC testnet RPC by default when bscNetwork is bscTestnet", () => {
    const client = new HyperbetClient({
      evmPrivateKey,
      bscNetwork: "bscTestnet",
    });

    expect((client.evmBsc?.provider as any).url).toBe(HyperbetClient.DEFAULT_BSC_TESTNET_RPC);
  });

  it("uses Avalanche Fuji RPC by default when avaxNetwork is avaxFuji", () => {
    const client = new HyperbetClient({
      evmPrivateKey,
      avaxNetwork: "avaxFuji",
    });

    expect((client.evmAvax?.provider as any).url).toBe(HyperbetClient.DEFAULT_AVAX_FUJI_RPC);
  });
});
