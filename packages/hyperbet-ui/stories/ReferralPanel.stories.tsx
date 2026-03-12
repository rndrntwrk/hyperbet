import type { Meta, StoryObj } from "@storybook/react";
import { ReferralPanel } from "../src/components/ReferralPanel";
import {
  StorySurface,
  ThemeMatrix,
  sampleEvmWallet,
  sampleSolanaWallet,
} from "./storySupport";

const meta = {
  title: "Components/ReferralPanel",
  component: ReferralPanel,
  parameters: {
    chain: "avax",
  },
  render: (args) => (
    <StorySurface width={560}>
      <ReferralPanel {...args} />
    </StorySurface>
  ),
  args: {
    activeChain: "avax",
    solanaWallet: sampleSolanaWallet,
    evmWallet: sampleEvmWallet,
    evmWalletPlatform: "AVAX",
  },
} satisfies Meta<typeof ReferralPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThemeMatrixStory: Story = {
  render: (args) => (
    <ThemeMatrix columns="repeat(auto-fit, minmax(260px, 1fr))">
      {(theme) => (
        <StorySurface width={300}>
          <ReferralPanel {...args} theme={theme} />
        </StorySurface>
      )}
    </ThemeMatrix>
  ),
};
