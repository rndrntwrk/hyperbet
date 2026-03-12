import type { Meta, StoryObj } from "@storybook/react";
import { ChainSelector } from "../src/components/ChainSelector";
import { StorySurface, ThemeMatrix } from "./storySupport";

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

export const ThemeMatrixStory: Story = {
  render: () => (
    <ThemeMatrix columns="repeat(auto-fit, minmax(180px, 1fr))">
      {(theme) => (
        <StorySurface width={180}>
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <ChainSelector theme={theme} />
          </div>
        </StorySurface>
      )}
    </ThemeMatrix>
  ),
};
