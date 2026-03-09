import type { Meta, StoryObj } from "@storybook/react";
import { SolanaClobPanel } from "../src/components/SolanaClobPanel";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/SolanaClobPanel",
  component: SolanaClobPanel,
  parameters: {
    chain: "solana",
  },
  render: (args) => (
    <StorySurface width={1180}>
      <SolanaClobPanel {...args} />
    </StorySurface>
  ),
  args: {
    agent1Name: "StormWarden",
    agent2Name: "JadePhoenix",
    compact: false,
  },
} satisfies Meta<typeof SolanaClobPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
