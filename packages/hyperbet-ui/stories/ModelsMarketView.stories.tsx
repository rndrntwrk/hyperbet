import type { Meta, StoryObj } from "@storybook/react";
import { ModelsMarketView } from "../src/components/ModelsMarketView";
import { ThemeMatrix } from "./storySupport";

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

export const ThemeMatrixStory: Story = {
  render: (args) => (
    <ThemeMatrix columns="repeat(auto-fit, minmax(520px, 1fr))">
      {(theme) => <ModelsMarketView {...args} theme={theme} />}
    </ThemeMatrix>
  ),
};
