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
  const label = locale === "zh" ? "语言" : "Language";

  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: compact ? 6 : 8,
        color: "rgba(255,255,255,0.72)",
        fontSize: compact ? 11 : 12,
        fontWeight: 600,
      }}
    >
      <span>{label}</span>
      <select
        aria-label={label}
        data-testid="locale-selector"
        value={locale}
        onChange={(event) => onChange(event.target.value as UiLocale)}
        style={{
          minWidth: compact ? 88 : 104,
          padding: compact ? "5px 8px" : "6px 10px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(0,0,0,0.35)",
          color: "#fff",
          fontSize: compact ? 11 : 12,
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="en">English</option>
        <option value="zh">中文</option>
      </select>
    </label>
  );
}
