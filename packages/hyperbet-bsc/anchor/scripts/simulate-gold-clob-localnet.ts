import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

type Strategy =
  | "cabal_against_house"
  | "mev"
  | "random"
  | "always_winner"
  | "highest_spread";

type Winner = "YES" | "NO";

type Bettor = {
  wallet: Keypair;
  strategy: Strategy;
  initialBalance: bigint;
};

type RoundSummary = {
  round: number;
  winner: Winner;
  houseBias: Winner;
  betsPlaced: number;
  winningClaims: number;
};

const STRATEGIES: Strategy[] = [
  "cabal_against_house",
  "mev",
  "random",
  "always_winner",
  "highest_spread",
];

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer (got: ${raw})`);
  }
  return parsed;
}

const WALLET_COUNT = parsePositiveIntEnv("SOLANA_NATIVE_SIM_WALLETS", 100);
const ROUNDS = parsePositiveIntEnv("SOLANA_NATIVE_SIM_ROUNDS", 1);
const BASE_ORDER_AMOUNT = 3_000_000n;
const MAX_MATCHES_PER_ORDER = 4;
const BETTOR_FUNDING = Math.floor(2 * LAMPORTS_PER_SOL);
const TREASURY_FUNDING = Math.floor(0.1 * LAMPORTS_PER_SOL);
const MARKET_MAKER_FUNDING = Math.floor(0.1 * LAMPORTS_PER_SOL);
const AUTHORITY_FUNDING_BUFFER = Math.floor(10 * LAMPORTS_PER_SOL);

function createRng(seed: bigint): () => number {
  let state = seed;
  return () => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    const out = Number(state & 0xffff_ffffn);
    return Math.abs(out) / 0xffff_ffff;
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPrice(price: number): number {
  return Math.max(1, Math.min(999, Math.floor(price)));
}

function toU64Bn(value: bigint): BN {
  return new BN(value.toString());
}

function normalizeAmount(value: bigint): bigint {
  const rounded = (value / 1000n) * 1000n;
  return rounded > 0n ? rounded : 1000n;
}

function pickWinner(rng: () => number): Winner {
  return rng() > 0.5 ? "YES" : "NO";
}

function orderFromStrategy(
  strategy: Strategy,
  winner: Winner,
  houseBias: Winner,
  rng: () => number,
): { isBuy: boolean; price: number; amount: bigint } {
  const amountBump = BigInt(Math.floor(rng() * 1_000_000));
  const amount = normalizeAmount(BASE_ORDER_AMOUNT + amountBump);

  if (strategy === "always_winner") {
    return winner === "YES"
      ? { isBuy: true, price: clampPrice(620 + rng() * 120), amount }
      : { isBuy: false, price: clampPrice(380 - rng() * 120), amount };
  }

  if (strategy === "cabal_against_house") {
    return houseBias === "YES"
      ? { isBuy: false, price: clampPrice(450 - rng() * 80), amount }
      : { isBuy: true, price: clampPrice(550 + rng() * 80), amount };
  }

  if (strategy === "mev") {
    if (rng() > 0.5) {
      return { isBuy: true, price: clampPrice(520 + rng() * 160), amount };
    }
    return { isBuy: false, price: clampPrice(480 - rng() * 160), amount };
  }

  if (strategy === "highest_spread") {
    if (rng() > 0.5) {
      return { isBuy: true, price: 999, amount };
    }
    return { isBuy: false, price: 1, amount };
  }

  if (rng() > 0.5) {
    return { isBuy: true, price: clampPrice(500 + rng() * 250), amount };
  }
  return { isBuy: false, price: clampPrice(500 - rng() * 250), amount };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function deriveUserBalancePda(
  programId: PublicKey,
  matchState: PublicKey,
  user: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("balance"), matchState.toBuffer(), user.toBuffer()],
    programId,
  )[0];
}

function deriveOrderPda(
  programId: PublicKey,
  matchState: PublicKey,
  user: PublicKey,
  orderId: BN,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("order"),
      matchState.toBuffer(),
      user.toBuffer(),
      orderId.toArrayLike(Buffer, "le", 8),
    ],
    programId,
  )[0];
}

function deriveProgramDataAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  )[0];
}

function deriveOracleConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_config")],
    programId,
  )[0];
}

function deriveOracleMatchPda(programId: PublicKey, matchId: BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("match"), matchId.toArrayLike(Buffer, "le", 8)],
    programId,
  )[0];
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (value instanceof BN) return BigInt(value.toString());
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt(String(value));
  }
  return 0n;
}

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const workspaceDir = join(scriptDir, "..");
  const clobIdlPath = join(
    workspaceDir,
    "target",
    "idl",
    "gold_clob_market.json",
  );
  const fightIdlPath = join(workspaceDir, "target", "idl", "fight_oracle.json");

  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
  const wsUrl = process.env.ANCHOR_WS_URL;
  const walletPath =
    process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;

  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")) as number[]),
  );
  const connection =
    wsUrl !== undefined
      ? new anchor.web3.Connection(rpcUrl, {
          commitment: "confirmed",
          wsEndpoint: wsUrl,
        })
      : new anchor.web3.Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const clobIdl = JSON.parse(
    readFileSync(clobIdlPath, "utf8"),
  ) as anchor.Idl & {
    address: string;
  };
  const fightIdl = JSON.parse(
    readFileSync(fightIdlPath, "utf8"),
  ) as anchor.Idl & {
    address: string;
  };
  const programId = new PublicKey(clobIdl.address);
  const program = new anchor.Program(clobIdl, provider) as anchor.Program<any>;
  const fightProgram = new anchor.Program(
    fightIdl,
    provider,
  ) as anchor.Program<any>;

  const signatures: string[] = [];
  const roundSummaries: RoundSummary[] = [];
  const rng = createRng(0x5eedn);
  const executionStats = {
    betAttempts: 0,
    betSuccess: 0,
    betFailures: 0,
    cancelAttempts: 0,
    cancelSuccess: 0,
    cancelFailures: 0,
    claimAttempts: 0,
    claimSuccess: 0,
    claimFailures: 0,
  };

  async function getLatestBlockhashWithRetries(maxAttempts = 8) {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await connection.getLatestBlockhash("confirmed");
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await sleep(200 * attempt);
        }
      }
    }
    const reason =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `failed to fetch latest blockhash after ${maxAttempts} attempts: ${reason}`,
    );
  }

  async function confirmSignatureByPolling(
    label: string,
    signature: string,
    lastValidBlockHeight: number,
    timeoutMs = 120_000,
  ) {
    const deadline = Date.now() + timeoutMs;
    let lastRpcError: unknown = null;
    let pollCount = 0;

    while (Date.now() < deadline) {
      pollCount += 1;
      try {
        const statuses = await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        const status = statuses.value[0];
        if (status?.err) {
          throw new Error(
            `transaction ${signature} failed: ${JSON.stringify(status.err)}`,
          );
        }
        if (
          status &&
          (status.confirmationStatus === "confirmed" ||
            status.confirmationStatus === "finalized")
        ) {
          return;
        }

        if (pollCount % 8 === 0) {
          const currentBlockHeight =
            await connection.getBlockHeight("confirmed");
          if (currentBlockHeight > lastValidBlockHeight) {
            throw new Error(
              `transaction ${signature} expired at block height ${lastValidBlockHeight}`,
            );
          }
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("transaction ") ||
            error.message.includes("expired at block height"))
        ) {
          throw error;
        }
        lastRpcError = error;
      }

      await sleep(250);
    }

    const reason =
      lastRpcError instanceof Error ? ` (${lastRpcError.message})` : "";
    throw new Error(
      `${label} timed out waiting for confirmation for ${signature}${reason}`,
    );
  }

  async function sendTransactionWithPolling(
    label: string,
    transactionFactory: () => Promise<Transaction> | Transaction,
    signers: Keypair[] = [],
    maxAttempts = 4,
  ) {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const transaction = await transactionFactory();
        transaction.feePayer = transaction.feePayer ?? authority.publicKey;

        const { blockhash, lastValidBlockHeight } =
          await getLatestBlockhashWithRetries();
        transaction.recentBlockhash = blockhash;

        for (const signer of signers) {
          transaction.partialSign(signer);
        }

        const signedTx = await wallet.signTransaction(transaction);
        const signature = await connection.sendRawTransaction(
          signedTx.serialize(),
          {
            preflightCommitment: "confirmed",
            maxRetries: 8,
          },
        );
        signatures.push(signature);
        await confirmSignatureByPolling(label, signature, lastValidBlockHeight);
        return signature;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await sleep(250 * attempt);
        }
      }
    }

    const reason =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`${label} failed after ${maxAttempts} attempts: ${reason}`);
  }

  async function sendSol(to: PublicKey, lamports: number) {
    await sendTransactionWithPolling("fund-wallet", () =>
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: to,
          lamports,
        }),
      ),
    );
  }

  async function fundWallets(recipients: PublicKey[], lamports: number) {
    for (const group of chunk(recipients, 20)) {
      await sendTransactionWithPolling("fund-wallet-batch", () => {
        const tx = new Transaction();
        for (const recipient of group) {
          tx.add(
            SystemProgram.transfer({
              fromPubkey: authority.publicKey,
              toPubkey: recipient,
              lamports,
            }),
          );
        }
        return tx;
      });
    }
  }

  async function getBalance(pubkey: PublicKey) {
    return BigInt(await connection.getBalance(pubkey, "confirmed"));
  }

  async function ensureAuthorityBalance(requiredLamports: number) {
    let currentBalance = await connection.getBalance(
      authority.publicKey,
      "confirmed",
    );
    if (currentBalance >= requiredLamports) {
      return;
    }

    const airdropChunk = Math.floor(50 * LAMPORTS_PER_SOL);
    let lastError: unknown = null;

    while (currentBalance < requiredLamports) {
      const lamports = Math.min(
        requiredLamports - currentBalance,
        airdropChunk,
      );
      const targetBalance = currentBalance + lamports;
      try {
        const signature = await connection.requestAirdrop(
          authority.publicKey,
          lamports,
        );
        const startedAt = Date.now();
        while (Date.now() - startedAt < 30_000) {
          currentBalance = await connection.getBalance(
            authority.publicKey,
            "confirmed",
          );
          if (currentBalance >= targetBalance) {
            break;
          }

          const statuses = await connection.getSignatureStatuses([signature], {
            searchTransactionHistory: true,
          });
          const status = statuses.value[0];
          if (status?.err) {
            throw new Error(
              `authority airdrop failed: ${JSON.stringify(status.err)}`,
            );
          }
          await sleep(250);
        }
        currentBalance = await connection.getBalance(
          authority.publicKey,
          "confirmed",
        );
      } catch (error) {
        lastError = error;
        await sleep(400);
      }
    }

    const finalBalance = await connection.getBalance(
      authority.publicKey,
      "confirmed",
    );
    if (finalBalance < requiredLamports) {
      const reason =
        lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(
        `authority funding incomplete: need ${requiredLamports} lamports, have ${finalBalance} (${reason})`,
      );
    }
  }

  async function nextOrderId(matchState: PublicKey) {
    const state = (await program.account.matchState.fetch(matchState)) as {
      nextOrderId: BN;
    };
    return new BN(state.nextOrderId.toString());
  }

  async function didOrderPlacementSettle(
    matchState: PublicKey,
    orderId: BN,
    orderPda: PublicKey,
  ) {
    const existingOrder = await program.account.order.fetchNullable(orderPda);
    if (existingOrder) {
      return true;
    }

    const currentOrderId = await nextOrderId(matchState);
    return currentOrderId.gt(orderId);
  }

  async function findMatchingMakerAccounts(
    matchState: PublicKey,
    isBuy: boolean,
    price: number,
  ) {
    const allOrders = (await program.account.order.all()) as Array<{
      publicKey: PublicKey;
      account: {
        matchState: PublicKey;
        maker: PublicKey;
        isBuy: boolean;
        price: number;
        amount: BN | number | bigint;
        filled: BN | number | bigint;
      };
    }>;

    const openMakerOrders = allOrders
      .filter((order) => order.account.matchState.equals(matchState))
      .filter((order) => Boolean(order.account.isBuy) !== isBuy)
      .filter(
        (order) =>
          asBigInt(order.account.amount) > asBigInt(order.account.filled),
      )
      .filter((order) =>
        isBuy
          ? Number(order.account.price) <= price
          : Number(order.account.price) >= price,
      )
      .sort((left, right) =>
        isBuy
          ? Number(left.account.price) - Number(right.account.price)
          : Number(right.account.price) - Number(left.account.price),
      );

    return openMakerOrders.slice(0, MAX_MATCHES_PER_ORDER).flatMap((order) => [
      {
        pubkey: order.publicKey,
        isWritable: true,
        isSigner: false,
      },
      {
        pubkey: deriveUserBalancePda(
          programId,
          matchState,
          order.account.maker,
        ),
        isWritable: true,
        isSigner: false,
      },
    ]);
  }

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  );
  const oracleConfig = deriveOracleConfigPda(fightProgram.programId);

  const treasuryWallet = Keypair.generate();
  const marketMakerWallet = Keypair.generate();
  const requiredAuthorityLamports =
    TREASURY_FUNDING +
    MARKET_MAKER_FUNDING +
    BETTOR_FUNDING * WALLET_COUNT +
    Math.floor(0.05 * LAMPORTS_PER_SOL) * ROUNDS +
    AUTHORITY_FUNDING_BUFFER;
  await ensureAuthorityBalance(requiredAuthorityLamports);
  await Promise.all([
    sendSol(treasuryWallet.publicKey, TREASURY_FUNDING),
    sendSol(marketMakerWallet.publicKey, MARKET_MAKER_FUNDING),
  ]);

  await sendTransactionWithPolling("initialize-oracle", () =>
    fightProgram.methods
      .initializeOracle()
      .accountsPartial({
        authority: authority.publicKey,
        oracleConfig,
        program: fightProgram.programId,
        programData: deriveProgramDataAddress(fightProgram.programId),
        systemProgram: SystemProgram.programId,
      })
      .transaction(),
  );

  await sendTransactionWithPolling("initialize-config", () =>
    program.methods
      .initializeConfig(
        treasuryWallet.publicKey,
        marketMakerWallet.publicKey,
        100,
        100,
        200,
      )
      .accountsPartial({
        authority: authority.publicKey,
        config: configPda,
        program: program.programId,
        programData: deriveProgramDataAddress(program.programId),
        systemProgram: SystemProgram.programId,
      })
      .transaction(),
  ).catch(async () => {
    await sendTransactionWithPolling("update-config", () =>
      program.methods
        .updateConfig(
          treasuryWallet.publicKey,
          marketMakerWallet.publicKey,
          100,
          100,
          200,
        )
        .accountsPartial({
          authority: authority.publicKey,
          config: configPda,
        })
        .transaction(),
    );
  });

  const treasuryStartBalance = await getBalance(treasuryWallet.publicKey);
  const mmStartBalance = await getBalance(marketMakerWallet.publicKey);

  const bettors: Bettor[] = Array.from({ length: WALLET_COUNT }, (_, i) => ({
    wallet: Keypair.generate(),
    strategy: STRATEGIES[i % STRATEGIES.length],
    initialBalance: BigInt(BETTOR_FUNDING),
  }));
  await fundWallets(
    bettors.map((bettor) => bettor.wallet.publicKey),
    BETTOR_FUNDING,
  );

  for (let round = 1; round <= ROUNDS; round += 1) {
    const matchId = new BN(
      (Date.now() + round * 10_000 + Math.floor(rng() * 1_000)).toString(),
    );
    const oracleMatch = deriveOracleMatchPda(fightProgram.programId, matchId);
    const matchState = Keypair.generate();
    const orderBook = Keypair.generate();
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), matchState.publicKey.toBuffer()],
      programId,
    );

    await sendTransactionWithPolling("create-oracle-match", () =>
      fightProgram.methods
        .createMatch(matchId, new BN(2), `sim-round-${round}`)
        .accountsPartial({
          authority: authority.publicKey,
          oracleConfig,
          matchResult: oracleMatch,
          systemProgram: SystemProgram.programId,
        })
        .transaction(),
    );

    await sendTransactionWithPolling(
      "initialize-match",
      () =>
        program.methods
          .initializeMatch(500)
          .accountsPartial({
            matchState: matchState.publicKey,
            user: authority.publicKey,
            config: configPda,
            oracleMatch,
            vault,
            systemProgram: SystemProgram.programId,
          })
          .transaction(),
      [matchState],
    );

    await sendTransactionWithPolling(
      "initialize-order-book",
      () =>
        program.methods
          .initializeOrderBook()
          .accountsPartial({
            user: authority.publicKey,
            matchState: matchState.publicKey,
            orderBook: orderBook.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .transaction(),
      [orderBook],
    );

    // Ensure the vault PDA is rent-exempt before receiving small trade flows.
    await sendSol(vault, Math.floor(0.05 * LAMPORTS_PER_SOL));

    const winner = pickWinner(rng);
    const houseBias: Winner = round % 2 === 0 ? "YES" : "NO";
    let betsPlaced = 0;
    const placedOrders: Array<{
      wallet: Keypair;
      orderId: BN;
      orderPda: PublicKey;
      userBalancePda: PublicKey;
    }> = [];

    for (const bettor of bettors) {
      const order = orderFromStrategy(bettor.strategy, winner, houseBias, rng);

      executionStats.betAttempts += 1;

      const bettorOrderId = await nextOrderId(matchState.publicKey);
      const userBalance = deriveUserBalancePda(
        programId,
        matchState.publicKey,
        bettor.wallet.publicKey,
      );
      const newOrder = deriveOrderPda(
        programId,
        matchState.publicKey,
        bettor.wallet.publicKey,
        bettorOrderId,
      );
      const remainingAccounts = await findMatchingMakerAccounts(
        matchState.publicKey,
        order.isBuy,
        order.price,
      );
      try {
        await sendTransactionWithPolling(
          "bettor-order",
          () =>
            program.methods
              .placeOrder(
                bettorOrderId,
                order.isBuy,
                order.price,
                toU64Bn(order.amount),
              )
              .accountsPartial({
                matchState: matchState.publicKey,
                orderBook: orderBook.publicKey,
                userBalance,
                newOrder,
                config: configPda,
                treasury: treasuryWallet.publicKey,
                marketMaker: marketMakerWallet.publicKey,
                vault,
                user: bettor.wallet.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .remainingAccounts(remainingAccounts)
              .transaction(),
          [bettor.wallet],
        );
      } catch (error) {
        if (
          !(await didOrderPlacementSettle(
            matchState.publicKey,
            bettorOrderId,
            newOrder,
          ))
        ) {
          executionStats.betFailures += 1;
          throw error;
        }
      }

      executionStats.betSuccess += 1;
      betsPlaced += 1;
      placedOrders.push({
        wallet: bettor.wallet,
        orderId: bettorOrderId,
        orderPda: newOrder,
        userBalancePda: userBalance,
      });
    }

    const winnerArg =
      winner === "YES" ? ({ yes: {} } as any) : ({ no: {} } as any);
    await sleep(2_200);
    await sendTransactionWithPolling("post-result", () =>
      fightProgram.methods
        .postResult(
          winnerArg,
          new BN(round.toString()),
          Array.from(Keypair.generate().publicKey.toBytes()),
        )
        .accountsPartial({
          authority: authority.publicKey,
          oracleConfig,
          matchResult: oracleMatch,
        })
        .transaction(),
    );
    await sendTransactionWithPolling("resolve-match", () =>
      program.methods
        .resolveMatch()
        .accountsPartial({
          matchState: matchState.publicKey,
          oracleMatch,
        })
        .transaction(),
    );

    let winningClaims = 0;
    for (const placedOrder of placedOrders) {
      const orderAccount = await program.account.order.fetchNullable(
        placedOrder.orderPda,
      );
      if (
        orderAccount &&
        asBigInt(orderAccount.amount) > asBigInt(orderAccount.filled)
      ) {
        executionStats.cancelAttempts += 1;
        try {
          await sendTransactionWithPolling(
            "cancel-order",
            () =>
              program.methods
                .cancelOrder(placedOrder.orderId)
                .accountsPartial({
                  matchState: matchState.publicKey,
                  orderBook: orderBook.publicKey,
                  order: placedOrder.orderPda,
                  vault,
                  user: placedOrder.wallet.publicKey,
                  systemProgram: SystemProgram.programId,
                })
                .transaction(),
            [placedOrder.wallet],
          );
          executionStats.cancelSuccess += 1;
        } catch (error) {
          executionStats.cancelFailures += 1;
          throw error;
        }
      }

      const userBalanceAccount =
        await program.account.userBalance.fetchNullable(
          placedOrder.userBalancePda,
        );
      const winningShares =
        userBalanceAccount === null
          ? 0n
          : winner === "YES"
            ? asBigInt(userBalanceAccount.yesShares)
            : asBigInt(userBalanceAccount.noShares);
      if (winningShares === 0n) {
        continue;
      }

      executionStats.claimAttempts += 1;
      try {
        await sendTransactionWithPolling(
          "claim-winnings",
          () =>
            program.methods
              .claim()
              .accountsPartial({
                matchState: matchState.publicKey,
                orderBook: orderBook.publicKey,
                userBalance: placedOrder.userBalancePda,
                config: configPda,
                marketMaker: marketMakerWallet.publicKey,
                vault,
                user: placedOrder.wallet.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .transaction(),
          [placedOrder.wallet],
        );
        executionStats.claimSuccess += 1;
        winningClaims += 1;
      } catch (error) {
        executionStats.claimFailures += 1;
        throw error;
      }
    }

    roundSummaries.push({
      round,
      winner,
      houseBias,
      betsPlaced,
      winningClaims,
    });
  }

  const walletPnl = [];
  for (const bettor of bettors) {
    const finalBalance = await getBalance(bettor.wallet.publicKey);
    walletPnl.push({
      address: bettor.wallet.publicKey.toBase58(),
      strategy: bettor.strategy,
      initialBalance: bettor.initialBalance.toString(),
      finalBalance: finalBalance.toString(),
      pnl: (finalBalance - bettor.initialBalance).toString(),
    });
  }

  const byStrategy = new Map<
    Strategy,
    { total: bigint; wallets: number; positive: number }
  >();
  for (const strategy of STRATEGIES) {
    byStrategy.set(strategy, { total: 0n, wallets: 0, positive: 0 });
  }

  for (const row of walletPnl) {
    const agg = byStrategy.get(row.strategy as Strategy)!;
    const pnl = BigInt(row.pnl);
    agg.total += pnl;
    agg.wallets += 1;
    if (pnl > 0n) agg.positive += 1;
  }

  const strategyPnl = STRATEGIES.map((strategy) => {
    const agg = byStrategy.get(strategy)!;
    return {
      strategy,
      wallets: agg.wallets,
      totalPnl: agg.total.toString(),
      averagePnl:
        agg.wallets === 0 ? "0" : (agg.total / BigInt(agg.wallets)).toString(),
      positiveWallets: agg.positive,
    };
  });

  let verifiedSignatures = 0;
  for (const group of chunk(signatures, 256)) {
    const statuses = await connection.getSignatureStatuses(group, {
      searchTransactionHistory: true,
    });
    for (const status of statuses.value) {
      if (status && !status.err) {
        verifiedSignatures += 1;
      }
    }
  }

  const treasuryEndBalance = await getBalance(treasuryWallet.publicKey);
  const mmEndBalance = await getBalance(marketMakerWallet.publicKey);

  const report = {
    generatedAt: new Date().toISOString(),
    rpcUrl,
    programId: programId.toBase58(),
    wallets: WALLET_COUNT,
    rounds: ROUNDS,
    feeFlows: {
      tradingFeesToTreasury: (
        treasuryEndBalance - treasuryStartBalance
      ).toString(),
      allFeesToMarketMaker: (mmEndBalance - mmStartBalance).toString(),
    },
    chainVerification: {
      signaturesSubmitted: signatures.length,
      signaturesVerified: verifiedSignatures,
      verificationPassed: signatures.length === verifiedSignatures,
    },
    executionStats,
    roundsSummary: roundSummaries,
    strategyPnl,
    walletPnl,
  };

  const outputDir = join(workspaceDir, "simulations");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = join(outputDir, "solana-localnet-pnl.json");
  writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log("\n=== Solana CLOB Localnet Simulation Complete ===");
  console.log(`Wallets: ${WALLET_COUNT}`);
  console.log(`Rounds: ${ROUNDS}`);
  console.log(
    `Signatures verified: ${verifiedSignatures}/${signatures.length}`,
  );
  console.log(
    `Trading fees -> treasury: ${report.feeFlows.tradingFeesToTreasury}`,
  );
  console.log(
    `All fees -> market maker: ${report.feeFlows.allFeesToMarketMaker}`,
  );
  console.log(`Report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
