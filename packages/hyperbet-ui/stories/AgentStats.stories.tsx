import type { Meta, StoryObj } from "@storybook/react";
import { AgentStats } from "../src/components/AgentStats";
import { StorySurface, ThemeMatrix, sampleAgent } from "./storySupport";

const meta = {
  title: "Components/AgentStats",
  component: AgentStats,
  render: (args) => (
    <StorySurface width={440}>
      <AgentStats {...args} />
    </StorySurface>
  ),
  args: {
    agent: sampleAgent,
    side: "left",
  },
} satisfies Meta<typeof AgentStats>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThemeMatrixStory: Story = {
  render: (args) => (
    <ThemeMatrix columns="repeat(auto-fit, minmax(220px, 1fr))">
      {(theme) => (
        <StorySurface width={260}>
          <AgentStats {...args} theme={theme} />
        </StorySurface>
      )}
    </ThemeMatrix>
  ),
};
