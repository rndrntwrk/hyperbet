import { Buffer } from "buffer";

import type {
  Connection,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { ComputeBudgetProgram } from "@solana/web3.js";

interface PriorityFeeResult {
  priorityFeeEstimate?: number;
}

interface JsonRpcFailure {
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JsonRpcSuccess<T> {
  result: T;
}

type JsonRpcResponse<T> = JsonRpcFailure | JsonRpcSuccess<T>;

interface LatestBlockhashResult {
  value: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
}

interface SignatureStatusesResult {
  value: Array<{
    err: unknown;
    confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  } | null>;
}

// Minimum Jito tip in lamports required by Helius Sender (0.0002 SOL).
export const JITO_TIP_LAMPORTS = 200_000;

// Default compute unit budget for user bet transactions.
const DEFAULT_COMPUTE_UNIT_LIMIT = 200_000;

// Jito tip accounts — any one of these can receive the tip.
const JITO_TIP_ACCOUNTS = [
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
  "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
  "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
  "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
  "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
  "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
  "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
  "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
  "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
  "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
] as const;

export function randomJitoTipAccount(): string {
  return (
    JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)] ??
    JITO_TIP_ACCOUNTS[0]
  );
}

function isJsonRpcFailure<T>(
  payload: JsonRpcResponse<T>,
): payload is JsonRpcFailure {
  return "error" in payload;
}

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return /^(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function resolveRpcEndpoint(endpoint: string): string {
  if (
    typeof window !== "undefined" &&
    isLoopbackEndpoint(endpoint) &&
    window.location.hostname
  ) {
    return `${window.location.protocol}//${window.location.host}/__solana/rpc`;
  }
  return endpoint;
}

async function callJsonRpc<T>(
  endpoint: string,
  method: string,
  params: unknown[],
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(resolveRpcEndpoint(endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${method}-${Date.now()}`,
        method,
        params,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${method} fetch failed: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`${method} HTTP ${response.status}`);
  }

  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (isJsonRpcFailure(payload)) {
    throw new Error(`${method} failed: ${payload.error.message}`);
  }
  return payload.result;
}

export async function getLatestBlockhashViaRpc(
  connection: Connection,
): Promise<{
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  try {
    return await connection.getLatestBlockhash("confirmed");
  } catch {
    const result = await callJsonRpc<LatestBlockhashResult>(
      connection.rpcEndpoint,
      "getLatestBlockhash",
      [{ commitment: "confirmed" }],
    );
    return result.value;
  }
}

export async function fetchPriorityFeeEstimate(
  rpcEndpoint: string,
  accountKeys: string[] = [],
): Promise<number> {
  const FALLBACK_FEE = 50_000;
  try {
    const result = await callJsonRpc<PriorityFeeResult>(
      rpcEndpoint,
      "getPriorityFeeEstimate",
      [{ accountKeys, options: { priorityLevel: "High" } }],
    );
    const fee = result?.priorityFeeEstimate;
    if (typeof fee === "number" && fee > 0) return Math.ceil(fee);
    return FALLBACK_FEE;
  } catch {
    return FALLBACK_FEE;
  }
}

export async function buildPriorityFeeInstructions(
  rpcEndpoint: string,
  accountKeys: string[] = [],
  computeUnitLimit = DEFAULT_COMPUTE_UNIT_LIMIT,
): Promise<TransactionInstruction[]> {
  const microLamports = await fetchPriorityFeeEstimate(rpcEndpoint, accountKeys);
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ];
}

async function sendViaKeeperSenderProxy(
  gameApiUrl: string,
  transaction: Transaction | VersionedTransaction,
): Promise<string> {
  const serialized = transaction.serialize();
  const encoded = Buffer.from(serialized).toString("base64");
  const response = await fetch(
    `${gameApiUrl.replace(/\/$/, "")}/api/proxy/solana/sender`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transaction: encoded }),
    },
  );
  if (!response.ok) {
    throw new Error(`Sender proxy HTTP ${response.status}`);
  }
  const body = (await response.json()) as { signature?: string; error?: string };
  if (body.error) {
    throw new Error(`Sender proxy error: ${body.error}`);
  }
  if (!body.signature) {
    throw new Error("Sender proxy returned no signature");
  }
  return body.signature;
}

export async function sendRawTransactionViaRpc(
  connection: Connection,
  transaction: Transaction | VersionedTransaction,
  options: {
    gameApiUrl?: string;
    useHeliusSender?: boolean;
  } = {},
): Promise<string> {
  const { gameApiUrl, useHeliusSender = false } = options;

  if (useHeliusSender && gameApiUrl) {
    try {
      return await sendViaKeeperSenderProxy(gameApiUrl, transaction);
    } catch {
      // Fall through to direct RPC submission if the proxy is unavailable.
    }
  }

  const serialized = transaction.serialize();
  try {
    return await connection.sendRawTransaction(serialized, {
      preflightCommitment: "confirmed",
      skipPreflight: useHeliusSender,
      maxRetries: useHeliusSender ? 0 : 5,
    });
  } catch {
    return callJsonRpc<string>(connection.rpcEndpoint, "sendTransaction", [
      Buffer.from(serialized).toString("base64"),
      {
        encoding: "base64",
        preflightCommitment: "confirmed",
        skipPreflight: useHeliusSender,
        maxRetries: useHeliusSender ? 0 : 5,
      },
    ]);
  }
}

async function getSignatureStatusesViaConnection(
  connection: Connection,
  signature: string,
): Promise<SignatureStatusesResult> {
  try {
    const result = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    return {
      value: result.value.map((status) =>
        status
          ? {
              err: status.err,
              confirmationStatus: status.confirmationStatus ?? null,
            }
          : null,
      ),
    };
  } catch {
    return callJsonRpc<SignatureStatusesResult>(
      connection.rpcEndpoint,
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: true }],
    );
  }
}

export async function confirmSignatureViaRpc(
  connection: Connection,
  signature: string,
  timeoutMs = 30_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await getSignatureStatusesViaConnection(
      connection,
      signature,
    );
    const status = result.value[0];
    if (status?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return;
    }
    await new Promise((resolve) => {
      window.setTimeout(resolve, 500);
    });
  }
  throw new Error(`Transaction ${signature} was not confirmed in time`);
}
