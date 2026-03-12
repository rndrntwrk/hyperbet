import React from "react";
import { type HyperbetThemeId, useHyperbetThemeSurface } from "../lib/theme";

interface TabsProps {
  tabs: { id: string; label: React.ReactNode }[];
  activeTab: string;
  onChange: (id: string) => void;
  style?: React.CSSProperties;
  theme?: HyperbetThemeId;
}

export function Tabs({ tabs, activeTab, onChange, style, theme }: TabsProps) {
  const { themeStyle, themeAttribute } = useHyperbetThemeSurface(theme);
  return (
    <div
      data-hyperbet-theme={themeAttribute}
      style={{
        ...themeStyle,
        display: "flex",
        background: "var(--hm-surface-elevated)",
        borderRadius: 12,
        padding: 4,
        gap: 4,
        border: "1px solid var(--hm-surface-hover)",
        ...style,
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              padding: "8px 12px",
              background: isActive ? "var(--hm-gold-glow-medium)" : "transparent",
              color: isActive ? "var(--hm-text-primary)" : "var(--hm-text-muted)",
              border: isActive
                ? "1px solid var(--hm-border-light)"
                : "1px solid transparent",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: isActive ? 700 : 500,
              cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: isActive ? "0 2px 8px rgba(0,0,0,0.2)" : "none",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
