import type { Meta, StoryObj } from "@storybook/react";
import { PointsDisplay } from "../src/components/PointsDisplay";
import { StorySurface, sampleSolanaWallet } from "./storySupport";

const meta = {
  title: "Components/PointsDisplay",
  component: PointsDisplay,
  render: (args) => (
    <StorySurface width={560}>
      <PointsDisplay {...args} />
    </StorySurface>
  ),
  args: {
    walletAddress: sampleSolanaWallet,
    compact: false,
  },
} satisfies Meta<typeof PointsDisplay>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
