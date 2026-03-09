import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Tabs } from "../src/components/Tabs";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/Tabs",
  component: Tabs,
  render: (args) => {
    const [activeTab, setActiveTab] = React.useState("overview");
    return (
      <StorySurface width={480}>
        <Tabs {...args} activeTab={activeTab} onChange={setActiveTab} />
      </StorySurface>
    );
  },
  args: {
    tabs: [
      { id: "overview", label: "Overview" },
      { id: "orders", label: "Orders" },
      { id: "history", label: "History" },
    ],
    activeTab: "overview",
    onChange: () => undefined,
  },
} satisfies Meta<typeof Tabs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
