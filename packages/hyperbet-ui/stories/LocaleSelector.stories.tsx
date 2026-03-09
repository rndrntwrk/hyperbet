import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { LocaleSelector } from "../src/components/LocaleSelector";
import { StorySurface } from "./storySupport";

const meta = {
  title: "Components/LocaleSelector",
  component: LocaleSelector,
  render: (args) => {
    const [locale, setLocale] = useState(args.locale);

    return (
      <StorySurface width={260}>
        <LocaleSelector {...args} locale={locale} onChange={setLocale} />
      </StorySurface>
    );
  },
  args: {
    locale: "en",
    compact: false,
    onChange: () => undefined,
  },
} satisfies Meta<typeof LocaleSelector>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    locale: "en",
    compact: false,
    onChange: () => undefined,
  },
};
