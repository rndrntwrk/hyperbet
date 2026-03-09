import type { Meta, StoryObj } from "@storybook/react";
import { AgentStats } from "../src/components/AgentStats";
import { StorySurface, sampleAgent } from "./storySupport";

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
