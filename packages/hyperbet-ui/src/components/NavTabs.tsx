import { startTransition, type ReactNode } from "react";
import { type HyperbetThemeId, useHyperbetThemeSurface } from "../lib/theme";

export interface NavTab {
  id: string;
  label: ReactNode;
  testId?: string;
}

interface NavTabsProps {
  tabs: NavTab[];
  activeTab: string;
  onChange: (id: string) => void;
  variant?: "header" | "mobile";
  theme?: HyperbetThemeId;
}

export function NavTabs({
  tabs,
  activeTab,
  onChange,
  variant = "header",
  theme,
}: NavTabsProps) {
  const { themeStyle, themeAttribute } = useHyperbetThemeSurface(theme);
  return (
    <nav
      className={`hm-nav-tabs hm-nav-tabs--${variant}`}
      aria-label="Navigation"
      data-hyperbet-theme={themeAttribute}
      style={themeStyle}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            data-testid={tab.testId}
            className={`hm-nav-tab${isActive ? " hm-nav-tab--active" : ""}`}
            aria-current={isActive ? "page" : undefined}
            onClick={() => startTransition(() => onChange(tab.id))}
          >
            <span className="hm-nav-tab-label">{tab.label}</span>
            {isActive && <span className="hm-nav-tab-glow" aria-hidden="true" />}
          </button>
        );
      })}
    </nav>
  );
}
