import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as anchor from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey, SystemProgram, clusterApiUrl } from "@solana/web3.js";

import { resolveBettingSolanaDeployment, type BettingSolanaCluster } from "../deployments";

const { Program } = anchor;

function parseArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseCluster(): BettingSolanaCluster {
  const value = parseArg("--cluster") ?? "devnet";
  switch (value) {
    case "localnet":
    case "devnet":
    case "testnet":
    case "mainnet-beta":
      return value;
    default:
      throw new Error(`Unsupported --cluster value '${value}'`);
  }
}

function usage(): never {
  console.log(
    "usage: node --import tsx packages/hyperbet-solana/scripts/init-pm-config.ts [--cluster devnet|testnet|mainnet-beta|localnet] [--freeze] [--out <path>]",
  );
  process.exit(0);
}

function resolveRpcUrl(cluster: BettingSolanaCluster): string {
  const explicit = process.env.SOLANA_RPC_URL?.trim();
  if (explicit) return explicit;
  if (cluster === "localnet") return "http://127.0.0.1:8899";
  return clusterApiUrl(cluster === "mainnet-beta" ? "mainnet-beta" : cluster);
}

function resolveWalletPath(): string {
  const candidates = [
    process.env.ANCHOR_WALLET,
    path.join(process.env.HOME ?? "", ".config/solana/hyperscape-keys/deployer.json"),
    path.join(process.env.HOME ?? "", ".config/solana/id.json"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`No Solana deploy wallet found. Checked: ${candidates.join(", ")}`);
}

function readKeypair(filepath: string): Keypair {
  const bytes = JSON.parse(fs.readFileSync(filepath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function deriveProgramDataAddress(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    anchor.web3.BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  )[0];
}

function deriveOracleConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("oracle_config")], programId)[0];
}

function deriveMarketConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

function loadIdl(filepath: string): Idl {
  return JSON.parse(fs.readFileSync(filepath, "utf8")) as Idl;
}

function loadIdlWithAddress(filepath: string, address: PublicKey): Idl {
  const idl = loadIdl(filepath) as Idl & { address?: string };
  idl.address = address.toBase58();
  return idl;
}

function writeSummary(outPath: string | undefined, payload: unknown): void {
  if (!outPath) return;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
}

async function ensureOracleConfig(
  program: Program,
  authority: Keypair,
  disputeWindowSecs: number,
): Promise<PublicKey> {
  const oracleConfig = deriveOracleConfigPda(program.programId);
  const existing = await program.account.oracleConfig.fetchNullable(oracleConfig);
  if (!existing) {
    await program.methods
      .initializeOracle(
        authority.publicKey,
        authority.publicKey,
        authority.publicKey,
        new BN(disputeWindowSecs),
      )
      .accountsPartial({
        authority: authority.publicKey,
        oracleConfig,
        program: program.programId,
        programData: deriveProgramDataAddress(program.programId),
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    return oracleConfig;
  }

  await program.methods
    .updateOracleConfig(
      authority.publicKey,
      authority.publicKey,
      authority.publicKey,
      authority.publicKey,
      new BN(disputeWindowSecs),
    )
    .accountsPartial({
      authority: authority.publicKey,
      oracleConfig,
    })
    .signers([authority])
    .rpc();
  return oracleConfig;
}

async function ensureMarketConfig(program: Program, authority: Keypair): Promise<PublicKey> {
  const config = deriveMarketConfigPda(program.programId);
  const existing = await program.account.marketConfig.fetchNullable(config);
  if (!existing) {
    await program.methods
      .initializeConfig(
        authority.publicKey,
        authority.publicKey,
        authority.publicKey,
        100,
        100,
        200,
      )
      .accountsPartial({
        authority: authority.publicKey,
        config,
        program: program.programId,
        programData: deriveProgramDataAddress(program.programId),
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    return config;
  }

  await program.methods
    .updateConfig(
      authority.publicKey,
      authority.publicKey,
      authority.publicKey,
      authority.publicKey,
      100,
      100,
      200,
    )
    .accountsPartial({
      authority: authority.publicKey,
      config,
    })
    .signers([authority])
    .rpc();
  return config;
}

async function maybeFreezeOracle(program: Program, authority: Keypair, oracleConfig: PublicKey): Promise<string | null> {
  const account = await program.account.oracleConfig.fetch(oracleConfig);
  if (account.configFrozen) return null;
  return program.methods
    .freezeOracleConfig()
    .accountsPartial({
      authority: authority.publicKey,
      oracleConfig,
    })
    .signers([authority])
    .rpc();
}

async function maybeFreezeMarket(program: Program, authority: Keypair, config: PublicKey): Promise<string | null> {
  const account = await program.account.marketConfig.fetch(config);
  if (account.configFrozen) return null;
  return program.methods
    .freezeConfig()
    .accountsPartial({
      authority: authority.publicKey,
      config,
    })
    .signers([authority])
    .rpc();
}

async function main(): Promise<void> {
  if (hasFlag("--help")) usage();

  const cluster = parseCluster();
  const freeze = hasFlag("--freeze");
  const outPath = parseArg("--out");
  const disputeWindowSecs = Number.parseInt(
    process.env.DISPUTE_WINDOW_SECONDS?.trim() || "3600",
    10,
  );
  if (!Number.isFinite(disputeWindowSecs) || disputeWindowSecs <= 0) {
    throw new Error(`Invalid DISPUTE_WINDOW_SECONDS '${process.env.DISPUTE_WINDOW_SECONDS ?? ""}'`);
  }

  const walletPath = resolveWalletPath();
  const authority = readKeypair(walletPath);
  const rpcUrl = resolveRpcUrl(cluster);
  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), {
    commitment: "confirmed",
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(__dirname, "..");
  const anchorRoot = path.join(packageRoot, "anchor");
  const deployment = resolveBettingSolanaDeployment(cluster);
  const oracleProgramId = new PublicKey(deployment.fightOracleProgramId);
  const clobProgramId = new PublicKey(deployment.goldClobMarketProgramId);

  const oracleProgram = new Program(
    loadIdlWithAddress(
      path.join(anchorRoot, "target", "idl", "fight_oracle.json"),
      oracleProgramId,
    ),
    provider,
  );
  const clobProgram = new Program(
    loadIdlWithAddress(
      path.join(anchorRoot, "target", "idl", "gold_clob_market.json"),
      clobProgramId,
    ),
    provider,
  );

  const oracleConfig = await ensureOracleConfig(oracleProgram, authority, disputeWindowSecs);
  const marketConfig = await ensureMarketConfig(clobProgram, authority);
  const freezeOracleTx = freeze ? await maybeFreezeOracle(oracleProgram, authority, oracleConfig) : null;
  const freezeMarketTx = freeze ? await maybeFreezeMarket(clobProgram, authority, marketConfig) : null;

  const oracleAccount = await oracleProgram.account.oracleConfig.fetch(oracleConfig);
  const marketAccount = await clobProgram.account.marketConfig.fetch(marketConfig);

  const summary = {
    cluster,
    rpcUrl,
    authority: authority.publicKey.toBase58(),
    oracleProgramId: oracleProgramId.toBase58(),
    goldClobProgramId: clobProgramId.toBase58(),
    oracleConfig: oracleConfig.toBase58(),
    marketConfig: marketConfig.toBase58(),
    freezeRequested: freeze,
    freezeOracleTx,
    freezeMarketTx,
    oracleState: {
      authority: oracleAccount.authority.toBase58(),
      reporter: oracleAccount.reporter.toBase58(),
      finalizer: oracleAccount.finalizer.toBase58(),
      challenger: oracleAccount.challenger.toBase58(),
      disputeWindowSecs: oracleAccount.disputeWindowSecs.toString(),
      paused: oracleAccount.paused,
      configFrozen: oracleAccount.configFrozen,
    },
    marketState: {
      authority: marketAccount.authority.toBase58(),
      treasury: marketAccount.treasury.toBase58(),
      marketMaker: marketAccount.marketMaker.toBase58(),
      tradeTreasuryFeeBps: marketAccount.tradeTreasuryFeeBps,
      tradeMarketMakerFeeBps: marketAccount.tradeMarketMakerFeeBps,
      winningsMarketMakerFeeBps: marketAccount.winningsMarketMakerFeeBps,
      orderPlacementPaused: marketAccount.orderPlacementPaused,
      marketCreationPaused: marketAccount.marketCreationPaused,
      configFrozen: marketAccount.configFrozen,
    },
  };

  writeSummary(outPath, summary);
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
