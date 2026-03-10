import type { Meta, StoryObj } from "@storybook/react";
import { StreamUIApp } from "../src/StreamUIApp";

const meta = {
    title: "Frames/StreamUIApp",
    component: StreamUIApp,
    parameters: {
        layout: "fullscreen",
    },
} satisfies Meta<typeof StreamUIApp>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
