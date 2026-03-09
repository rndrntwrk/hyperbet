import { createHyperbetAppRoot } from "@hyperbet/ui";

import { getRpcUrl, getWsUrl } from "./lib/config";
import { createHeadlessWalletsFromEnv } from "./lib/headlessWallet";
import { ChainProvider } from "./lib/ChainContext";
import { wagmiConfig } from "./lib/wagmiConfig";
import { App } from "./App";
import { StreamUIApp } from "./StreamUIApp";

export default createHyperbetAppRoot({
  getRpcUrl,
  getWsUrl,
  createHeadlessWalletsFromEnv,
  ChainProvider,
  wagmiConfig,
  App,
  StreamUIApp,
});
