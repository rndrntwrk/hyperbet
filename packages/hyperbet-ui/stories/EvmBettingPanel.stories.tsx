import type { Meta, StoryObj } from "@storybook/react";
import { EvmBettingPanel } from "../src/components/EvmBettingPanel";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/EvmBettingPanel",
  component: EvmBettingPanel,
  parameters: {
    chain: "avax",
    locale: "zh",
  },
  render: (args) => (
    <StorySurface width={1180}>
      <EvmBettingPanel {...args} />
    </StorySurface>
  ),
  args: {
    agent1Name: "StormWarden",
    agent2Name: "JadePhoenix",
    compact: false,
  },
} satisfies Meta<typeof EvmBettingPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
