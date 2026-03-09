import type { Meta, StoryObj } from "@storybook/react";
import { StreamPlayer } from "../src/components/StreamPlayer";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/StreamPlayer",
  component: StreamPlayer,
  render: (args) => (
    <StorySurface width={960}>
      <div
        style={{
          height: 420,
          borderRadius: 18,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <StreamPlayer {...args} />
      </div>
    </StorySurface>
  ),
  args: {
    streamUrl: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    muted: true,
    autoPlay: false,
  },
} satisfies Meta<typeof StreamPlayer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
