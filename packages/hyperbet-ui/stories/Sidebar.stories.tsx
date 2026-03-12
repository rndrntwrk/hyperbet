import type { Meta, StoryObj } from "@storybook/react";
import { Sidebar } from "../src/components/Sidebar";
import { ThemeMatrix } from "./storySupport";

const meta = {
  title: "Components/Sidebar",
  component: Sidebar,
  render: (args) => (
    <div
      style={{
        height: 480,
        borderRadius: 18,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(0,0,0,0.35)",
      }}
    >
      <Sidebar {...args}>
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: "rgba(255,255,255,0.04)",
            }}
          >
            Market controls
          </div>
          <div
            style={{
              height: 220,
              borderRadius: 12,
              background: "rgba(229,184,74,0.08)",
            }}
          />
        </div>
      </Sidebar>
    </div>
  ),
  args: {
    side: "right",
    width: 360,
    defaultExpanded: true,
    children: null,
  },
} satisfies Meta<typeof Sidebar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThemeMatrixStory: Story = {
  render: (args) => (
    <ThemeMatrix columns="repeat(auto-fit, minmax(300px, 1fr))">
      {(theme) => (
        <div
          style={{
            height: 360,
            borderRadius: 18,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(0,0,0,0.35)",
          }}
        >
          <Sidebar {...args} theme={theme}>
            <div style={{ display: "grid", gap: 12 }}>
              <div
                style={{
                  padding: 16,
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                Market controls
              </div>
              <div
                style={{
                  height: 160,
                  borderRadius: 12,
                  background: "rgba(229,184,74,0.08)",
                }}
              />
            </div>
          </Sidebar>
        </div>
      )}
    </ThemeMatrix>
  ),
};
