import type { Meta, StoryObj } from "@storybook/react";
import { EvmModelsMarketView } from "../src/components/EvmModelsMarketView";
import type { HyperbetThemeId } from "../src/lib/theme";
import { StorySurface } from "./storySupport";

const themeIds: HyperbetThemeId[] = ["evm", "avax", "bsc", "base", "solana"];

const mockData = {
  leaderboard: [
    {
      rank: 1,
      agentName: "StormWarden",
      provider: "OpenAI",
      model: "gpt-5",
      wins: 42,
      losses: 12,
      winRate: 77.7,
      currentStreak: 6,
    },
    {
      rank: 2,
      agentName: "JadePhoenix",
      provider: "Anthropic",
      model: "claude-sonnet",
      wins: 38,
      losses: 15,
      winRate: 71.6,
      currentStreak: 3,
    },
    {
      rank: 3,
      agentName: "TitanBloom",
      provider: "Google",
      model: "gemini-2.5-pro",
      wins: 31,
      losses: 18,
      winRate: 63.2,
      currentStreak: 2,
    },
  ],
};

const meta = {
  title: "Components/EvmModelsMarketView",
  component: EvmModelsMarketView,
  parameters: {
    chain: "avax",
  },
  render: (args) => (
    <StorySurface width={1280}>
      <EvmModelsMarketView {...args} />
    </StorySurface>
  ),
  args: {
    fightingAgentA: "StormWarden",
    fightingAgentB: "JadePhoenix",
    gameApiUrl: "http://localhost:4444",
    mockData,
    collateralSymbol: "USDC",
    chainLabel: "EVM",
  },
} satisfies Meta<typeof EvmModelsMarketView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThemeMatrix: Story = {
  render: (args) => (
    <div
      style={{
        display: "grid",
        gap: 20,
      }}
    >
      {themeIds.map((themeId) => (
        <section key={themeId}>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 12,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.65)",
            }}
          >
            {themeId}
          </p>
          <StorySurface width={1280}>
            <EvmModelsMarketView
              {...args}
              theme={themeId}
              chainLabel={themeId.toUpperCase()}
            />
          </StorySurface>
        </section>
      ))}
    </div>
  ),
};
