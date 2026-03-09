import type { Meta, StoryObj } from "@storybook/react";
import { WalletLinkCard } from "../src/components/WalletLinkCard";
import {
  StorySurface,
  sampleEvmWallet,
  sampleSolanaWallet,
} from "./storySupport";

const meta = {
  title: "Components/WalletLinkCard",
  component: WalletLinkCard,
  parameters: {
    chain: "avax",
  },
  render: (args) => (
    <StorySurface width={520}>
      <WalletLinkCard {...args} />
    </StorySurface>
  ),
  args: {
    activeChain: "avax",
    solanaWallet: sampleSolanaWallet,
    evmWallet: sampleEvmWallet,
    evmWalletPlatform: "AVAX",
  },
} satisfies Meta<typeof WalletLinkCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
