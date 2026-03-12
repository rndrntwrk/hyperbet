import type { Meta, StoryObj } from "@storybook/react";
import { PointsLeaderboard } from "../src/components/PointsLeaderboard";
import { StorySurface, ThemeMatrix } from "./storySupport";

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

export const ThemeMatrixStory: Story = {
  render: () => (
    <ThemeMatrix columns="repeat(auto-fit, minmax(320px, 1fr))">
      {(theme) => (
        <StorySurface width={360}>
          <PointsLeaderboard theme={theme} />
        </StorySurface>
      )}
    </ThemeMatrix>
  ),
};
