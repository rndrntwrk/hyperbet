import type { Meta, StoryObj } from "@storybook/react";
import { ChainSelector } from "../src/components/ChainSelector";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/ChainSelector",
  component: ChainSelector,
  parameters: {
    chain: "avax",
    locale: "zh",
  },
  render: () => (
    <StorySurface width={280}>
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <ChainSelector />
      </div>
    </StorySurface>
  ),
} satisfies Meta<typeof ChainSelector>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
