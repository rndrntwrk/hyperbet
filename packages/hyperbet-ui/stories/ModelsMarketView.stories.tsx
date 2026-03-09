import type { Meta, StoryObj } from "@storybook/react";
import { ModelsMarketView } from "../src/components/ModelsMarketView";

const meta = {
  title: "Components/ModelsMarketView",
  component: ModelsMarketView,
  parameters: {
    chain: "solana",
  },
  render: (args) => <ModelsMarketView {...args} />,
  args: {
    activeMatchup: "StormWarden vs JadePhoenix",
  },
} satisfies Meta<typeof ModelsMarketView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
