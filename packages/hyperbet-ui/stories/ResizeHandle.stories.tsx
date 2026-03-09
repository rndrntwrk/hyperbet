import type { Meta, StoryObj } from "@storybook/react";
import { ResizeHandle } from "../src/components/ResizeHandle";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/ResizeHandle",
  component: ResizeHandle,
  render: (args) => (
    <StorySurface width={720}>
      <div
        style={{
          height: 280,
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ background: "rgba(255,255,255,0.04)" }} />
        <ResizeHandle {...args} />
        <div style={{ background: "rgba(229,184,74,0.08)" }} />
      </div>
    </StorySurface>
  ),
  args: {
    direction: "h",
    onMouseDown: () => undefined,
  },
} satisfies Meta<typeof ResizeHandle>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
