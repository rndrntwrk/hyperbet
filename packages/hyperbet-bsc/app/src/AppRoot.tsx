import { createEvmAppRoot } from "@hyperbet/ui/createEvmAppRoot";
import { ChainProvider } from "./lib/ChainContext";
import { wagmiConfig } from "@hyperbet/ui/lib/wagmiConfig";
import { App } from "./App";
import { StreamUIApp } from "./StreamUIApp";

export default createEvmAppRoot({
  ChainProvider,
  wagmiConfig: wagmiConfig as any,
  App,
  StreamUIApp,
  themeId: "bsc",
  themeStorageKey: "bsc-theme",
});
