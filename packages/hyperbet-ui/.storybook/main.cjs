const { resolve } = require("node:path");
const { mergeConfig } = require("vite");

const packageRoot = resolve(__dirname, "..");
const uiSrc = resolve(packageRoot, "./src");
const uiSrcNormalized = `${uiSrc.split("\\").join("/")}/`;

function createScopedMockPlugin() {
  const overrides = new Map([
    [
      "../spectator/useStreamingState",
      resolve(__dirname, "./mocks/useStreamingState.ts"),
    ],
    ["../lib/evmClient", resolve(__dirname, "./mocks/evmClient.ts")],
    ["../lib/programs", resolve(__dirname, "./mocks/programs.ts")],
  ]);

  return {
    name: "hyperbet-storybook-scoped-mocks",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer) return null;
      const normalizedImporter = importer.split("\\").join("/");
      if (!normalizedImporter.startsWith(uiSrcNormalized)) {
        return null;
      }
      return overrides.get(source) ?? null;
    },
  };
}

/** @type {import('@storybook/react-vite').StorybookConfig} */
module.exports = {
  stories: ["../stories/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-interactions",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: [resolve(packageRoot, "./public")],
  async viteFinal(baseConfig) {
    return mergeConfig(baseConfig, {
      plugins: [createScopedMockPlugin()],
      resolve: {
        alias: [
          {
            find: "@hyperbet/ui/i18n",
            replacement: resolve(packageRoot, "./src/i18n.ts"),
          },
          {
            find: "@hyperbet/ui/tokens",
            replacement: resolve(packageRoot, "./src/tokens.ts"),
          },
          {
            find: /^@hyperbet\/ui\/(.*)$/,
            replacement: resolve(packageRoot, "./src/$1"),
          },
          {
            find: "@hyperbet/ui",
            replacement: resolve(packageRoot, "./src/index.ts"),
          },
          {
            find: "@solana/wallet-adapter-react",
            replacement: resolve(
              __dirname,
              "./mocks/solanaWalletAdapterReact.tsx",
            ),
          },
          {
            find: "@solana/wallet-adapter-react-ui",
            replacement: resolve(
              __dirname,
              "./mocks/solanaWalletAdapterReactUi.tsx",
            ),
          },
          {
            find: /^wagmi$/,
            replacement: resolve(__dirname, "./mocks/wagmi.ts"),
          },
        ],
      },
      define: {
        "import.meta.env.VITE_BSC_GOLD_CLOB_ADDRESS": JSON.stringify(
          "0x00000000000000000000000000000000000000b1",
        ),
        "import.meta.env.VITE_BASE_GOLD_CLOB_ADDRESS": JSON.stringify(
          "0x00000000000000000000000000000000000000b2",
        ),
        "import.meta.env.VITE_AVAX_GOLD_CLOB_ADDRESS": JSON.stringify(
          "0x00000000000000000000000000000000000000b3",
        ),
        "import.meta.env.VITE_BSC_GOLD_TOKEN_ADDRESS": JSON.stringify(
          "0x00000000000000000000000000000000000000c1",
        ),
        "import.meta.env.VITE_BASE_GOLD_TOKEN_ADDRESS": JSON.stringify(
          "0x00000000000000000000000000000000000000c2",
        ),
        "import.meta.env.VITE_AVAX_GOLD_TOKEN_ADDRESS": JSON.stringify(
          "0x00000000000000000000000000000000000000c3",
        ),
      },
    });
  },
};
