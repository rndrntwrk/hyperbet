import { describe, expect, it } from "vitest";

import { resolveForkTargets } from "./fork-harness.js";

describe("fork harness target resolution", () => {
  it("returns undefined targets when no env vars are set", () => {
    const targets = resolveForkTargets({});

    expect(targets).toEqual({
      bscForkRpc: undefined,
      avaxForkRpc: undefined,
      solanaForkRpc: undefined,
    });
  });

  it("reads and trims configured fork rpc targets", () => {
    const targets = resolveForkTargets({
      BSC_FORK_RPC_URL: " http://127.0.0.1:8545 ",
      AVAX_FORK_RPC_URL: "http://127.0.0.1:9650/ext/bc/C/rpc",
      SOLANA_FORK_RPC_URL: " http://127.0.0.1:8899 ",
    });

    expect(targets).toEqual({
      bscForkRpc: "http://127.0.0.1:8545",
      avaxForkRpc: "http://127.0.0.1:9650/ext/bc/C/rpc",
      solanaForkRpc: "http://127.0.0.1:8899",
    });
  });
});
