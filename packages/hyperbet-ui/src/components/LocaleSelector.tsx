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
      value={locale}
      onChange={(event) => onChange(event.target.value as UiLocale)}
      style={{
        minWidth: compact ? 44 : 52,
        padding: compact ? "5px 6px" : "6px 8px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(0,0,0,0.35)",
        color: "#fff",
        fontSize: compact ? 14 : 16,
        cursor: "pointer",
        outline: "none",
        textAlign: "center",
      }}
    >
      <option value="en">🇺🇸</option>
      <option value="zh">🇨🇳</option>
    </select>
  );
}
