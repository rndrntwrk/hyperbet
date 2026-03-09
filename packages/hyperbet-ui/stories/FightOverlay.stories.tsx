import type { Meta, StoryObj } from "@storybook/react";
import { FightOverlay } from "../src/components/FightOverlay";
import { sampleFightAgent1, sampleFightAgent2 } from "./storySupport";

const meta = {
  title: "Components/FightOverlay",
  component: FightOverlay,
  render: (args) => (
    <div
      style={{
        position: "relative",
        height: 720,
        borderRadius: 18,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.08)",
        background:
          "radial-gradient(circle at center, rgba(229,184,74,0.14), transparent 38%), #05070d",
      }}
    >
      <FightOverlay {...args} />
    </div>
  ),
  args: {
    phase: "FIGHTING",
    agent1: sampleFightAgent1,
    agent2: sampleFightAgent2,
    countdown: 12,
    timeRemaining: 82,
    winnerId: null,
    winnerName: null,
    winReason: null,
  },
} satisfies Meta<typeof FightOverlay>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
