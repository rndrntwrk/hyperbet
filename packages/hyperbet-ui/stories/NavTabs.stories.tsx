import type { Meta, StoryObj } from "@storybook/react";
import { NavTabs } from "../src/components/NavTabs";

const sampleTabs = [
  { id: "fights", label: "⚔️ Fights" },
  { id: "market", label: "📈 Market" },
  { id: "history", label: "📜 History" },
];

const meta = {
  title: "Components/NavTabs",
  component: NavTabs,
  args: {
    tabs: sampleTabs,
    activeTab: "fights",
    onChange: () => {},
    variant: "header",
  },
} satisfies Meta<typeof NavTabs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Header: Story = {};

export const Mobile: Story = {
  args: { variant: "mobile" },
};
