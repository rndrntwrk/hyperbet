import type { Meta, StoryObj } from "@storybook/react";
import { PointsLeaderboard } from "../src/components/PointsLeaderboard";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/PointsLeaderboard",
  component: PointsLeaderboard,
  render: () => (
    <StorySurface width={720}>
      <PointsLeaderboard />
    </StorySurface>
  ),
} satisfies Meta<typeof PointsLeaderboard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
