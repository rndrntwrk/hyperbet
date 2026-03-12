import { type UiLocale } from "@hyperbet/ui/i18n";
import { type HyperbetThemeId, useHyperbetThemeSurface } from "../lib/theme";

type LocaleSelectorProps = {
  locale: UiLocale;
  onChange: (locale: UiLocale) => void;
  compact?: boolean;
  theme?: HyperbetThemeId;
};

export function LocaleSelector({
  locale,
  onChange,
  compact = false,
  theme,
}: LocaleSelectorProps) {
  const { themeStyle, themeAttribute } = useHyperbetThemeSurface(theme);
  return (
    <select
      aria-label="Language"
      data-testid="locale-selector"
      data-hyperbet-theme={themeAttribute}
      className={`hm-locale-selector${compact ? " hm-locale-selector--compact" : ""}`}
      style={themeStyle}
      value={locale}
      onChange={(event) => onChange(event.target.value as UiLocale)}
    >
      <option value="en">🇺🇸</option>
      <option value="zh">🇨🇳</option>
      <option value="ko">🇰🇷</option>
      <option value="pt">🇧🇷</option>
      <option value="es">🇪🇸</option>
    </select>
  );
}
