import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { LocaleSelector } from "../src/components/LocaleSelector";
import { StorySurface, ThemeMatrix } from "./storySupport";
import type { HyperbetThemeId } from "../src/lib/theme";

function LocaleSelectorThemePreview({
  theme,
  compact,
}: {
  theme: HyperbetThemeId;
  compact: boolean;
}) {
  const [locale, setLocale] = useState<"en" | "zh" | "ko" | "pt" | "es">("en");

  return (
    <StorySurface width={140}>
      <LocaleSelector
        locale={locale}
        onChange={setLocale}
        compact={compact}
        theme={theme}
      />
    </StorySurface>
  );
}

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

export const ThemeMatrixStory: Story = {
  render: (args) => (
    <ThemeMatrix columns="repeat(auto-fit, minmax(140px, 1fr))">
      {(theme) => (
        <LocaleSelectorThemePreview
          theme={theme}
          compact={Boolean(args.compact)}
        />
      )}
    </ThemeMatrix>
  ),
};
