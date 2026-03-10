import { createHyperbetAppRoot } from "@hyperbet/ui";

import { getRpcUrl, getWsUrl } from "./lib/config";
import { createHeadlessWalletsFromEnv } from "@hyperbet/ui/lib/evmHeadlessWallet";
import { ChainProvider } from "./lib/ChainContext";
import { wagmiConfig } from "@hyperbet/ui/lib/wagmiConfig";
import { App } from "./App";
import { StreamUIApp } from "./StreamUIApp";

export default createHyperbetAppRoot({
  getRpcUrl,
  getWsUrl: getWsUrl as any,
  createHeadlessWalletsFromEnv,
  ChainProvider: ChainProvider as any,
  // Cast needed: lockfile resolves two viem versions (local 2.46 vs hoisted 2.47)
  // causing deep chain-type structural incompatibility. Identical at runtime.
  wagmiConfig: wagmiConfig as any,
  App,
  StreamUIApp,
});
