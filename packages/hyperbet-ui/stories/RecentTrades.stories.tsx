import type { Meta, StoryObj } from "@storybook/react";
import { RecentTrades } from "../src/components/RecentTrades";
import { StorySurface, ThemeMatrix, sampleTrades } from "./storySupport";

const meta = {
  title: "Components/RecentTrades",
  component: RecentTrades,
  parameters: {
    locale: "zh",
  },
  render: (args) => (
    <StorySurface width={360}>
      <div
        style={{
          padding: 16,
          borderRadius: 16,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <RecentTrades {...args} />
      </div>
    </StorySurface>
  ),
  args: {
    yesPot: 145.2,
    noPot: 112.4,
    totalPot: 257.6,
    goldPriceUsd: 0.0712,
    locale: "zh",
    assetSymbol: "AVAX",
    trades: sampleTrades,
  },
} satisfies Meta<typeof RecentTrades>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThemeMatrixStory: Story = {
  render: (args) => (
    <ThemeMatrix columns="repeat(auto-fit, minmax(280px, 1fr))">
      {(theme) => (
        <StorySurface width={320}>
          <div
            style={{
              padding: 16,
              borderRadius: 16,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <RecentTrades {...args} theme={theme} />
          </div>
        </StorySurface>
      )}
    </ThemeMatrix>
  ),
};
