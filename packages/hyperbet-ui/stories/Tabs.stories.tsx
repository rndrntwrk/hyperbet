import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { Tabs } from "../src/components/Tabs";
import { StorySurface, ThemeMatrix } from "./storySupport";
import type { HyperbetThemeId } from "../src/lib/theme";

function TabsThemePreview({
  args,
  theme,
}: {
  args: React.ComponentProps<typeof Tabs>;
  theme: HyperbetThemeId;
}) {
  const [activeTab, setActiveTab] = React.useState("overview");

  return (
    <StorySurface width={260}>
      <Tabs
        {...args}
        activeTab={activeTab}
        onChange={setActiveTab}
        theme={theme}
      />
    </StorySurface>
  );
}

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

export const ThemeMatrixStory: Story = {
  render: (args) => (
    <ThemeMatrix columns="repeat(auto-fit, minmax(220px, 1fr))">
      {(theme) => <TabsThemePreview args={args} theme={theme} />}
    </ThemeMatrix>
  ),
};
