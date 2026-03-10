import { type UiLocale } from "@hyperbet/ui/i18n";

type LocaleSelectorProps = {
  locale: UiLocale;
  onChange: (locale: UiLocale) => void;
  compact?: boolean;
};

export function LocaleSelector({
  locale,
  onChange,
  compact = false,
}: LocaleSelectorProps) {
  return (
    <select
      aria-label="Language"
      data-testid="locale-selector"
      className={`hm-locale-selector${compact ? " hm-locale-selector--compact" : ""}`}
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
