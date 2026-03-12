import type { Meta, StoryObj } from "@storybook/react";
import { PointsHistory } from "../src/components/PointsHistory";
import { StorySurface, ThemeMatrix, sampleSolanaWallet } from "./storySupport";

const meta = {
  title: "Components/PointsHistory",
  component: PointsHistory,
  render: (args) => (
    <StorySurface width={680}>
      <PointsHistory {...args} />
    </StorySurface>
  ),
  args: {
    walletAddress: sampleSolanaWallet,
  },
} satisfies Meta<typeof PointsHistory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThemeMatrixStory: Story = {
  render: (args) => (
    <ThemeMatrix columns="repeat(auto-fit, minmax(320px, 1fr))">
      {(theme) => (
        <StorySurface width={360}>
          <PointsHistory {...args} theme={theme} />
        </StorySurface>
      )}
    </ThemeMatrix>
  ),
};
