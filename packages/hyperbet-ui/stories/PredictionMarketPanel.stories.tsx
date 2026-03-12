import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { PredictionMarketPanel } from "../src/components/PredictionMarketPanel";
import {
  StorySurface,
  ThemeMatrix,
  sampleAsks,
  sampleBids,
  sampleChartData,
  sampleTrades,
} from "./storySupport";
import type { HyperbetThemeId } from "../src/lib/theme";

function PredictionMarketPanelThemePreview({
  args,
  theme,
}: {
  args: React.ComponentProps<typeof PredictionMarketPanel>;
  theme: HyperbetThemeId;
}) {
  const [side, setSide] = React.useState<"YES" | "NO">("YES");
  const [amountInput, setAmountInput] = React.useState("2.5");

  return (
    <StorySurface width={560}>
      <PredictionMarketPanel
        {...args}
        side={side}
        setSide={setSide}
        amountInput={amountInput}
        setAmountInput={setAmountInput}
        theme={theme}
      />
    </StorySurface>
  );
}

const meta = {
  title: "Components/PredictionMarketPanel",
  component: PredictionMarketPanel,
  parameters: {
    locale: "zh",
  },
  render: (args) => {
    const [side, setSide] = React.useState<"YES" | "NO">("YES");
    const [amountInput, setAmountInput] = React.useState("2.5");

    return (
      <StorySurface width={1180}>
        <PredictionMarketPanel
          {...args}
          side={side}
          setSide={setSide}
          amountInput={amountInput}
          setAmountInput={setAmountInput}
        />
      </StorySurface>
    );
  },
  args: {
    yesPercent: 56,
    noPercent: 44,
    yesPool: "145.2 AVAX",
    noPool: "112.4 AVAX",
    side: "YES",
    setSide: () => undefined,
    amountInput: "2.5",
    setAmountInput: () => undefined,
    onPlaceBet: () => undefined,
    isWalletReady: true,
    programsReady: true,
    agent1Name: "StormWarden",
    agent2Name: "JadePhoenix",
    isEvm: true,
    supportsSell: true,
    chartData: sampleChartData,
    bids: sampleBids,
    asks: sampleAsks,
    recentTrades: sampleTrades,
    goldPriceUsd: 0.0712,
    currencySymbol: "AVAX",
    locale: "zh",
    marketAssetSymbol: "AVAX",
    children: (
      <button
        type="button"
        style={{
          width: "100%",
          marginTop: 8,
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.06)",
          color: "#fff",
          fontWeight: 700,
        }}
      >
        Close Position
      </button>
    ),
  },
} satisfies Meta<typeof PredictionMarketPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThemeMatrixStory: Story = {
  render: (args) => (
    <ThemeMatrix columns="repeat(auto-fit, minmax(520px, 1fr))">
      {(theme) => <PredictionMarketPanelThemePreview args={args} theme={theme} />}
    </ThemeMatrix>
  ),
};
