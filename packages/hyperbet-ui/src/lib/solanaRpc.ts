import { Buffer } from "buffer";

import type {
  Connection,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

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
    throw new Error(`${method} fetch failed: ${message}`, { cause: error });
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

export async function sendRawTransactionViaRpc(
  connection: Connection,
  transaction: Transaction | VersionedTransaction,
): Promise<string> {
  const serialized = transaction.serialize();
  try {
    return await connection.sendRawTransaction(serialized, {
      preflightCommitment: "confirmed",
      skipPreflight: false,
      maxRetries: 5,
    });
  } catch {
    return callJsonRpc<string>(connection.rpcEndpoint, "sendTransaction", [
      Buffer.from(serialized).toString("base64"),
      {
        encoding: "base64",
        preflightCommitment: "confirmed",
        skipPreflight: false,
        maxRetries: 5,
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
