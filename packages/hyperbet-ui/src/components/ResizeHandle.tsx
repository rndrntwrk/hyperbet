import { type HyperbetThemeId, useHyperbetThemeSurface } from "../lib/theme";

interface ResizeHandleProps {
  /** "h" = vertical bar you drag left/right; "v" = horizontal bar you drag up/down */
  direction: "h" | "v";
  onMouseDown: (e: React.MouseEvent) => void;
  /** Extra class names */
  className?: string;
  theme?: HyperbetThemeId;
}

/**
 * Thin draggable separator between two panels.
 * Visually highlights on hover and shows a gold accent while active.
 */
export function ResizeHandle({
  direction,
  onMouseDown,
  className = "",
  theme,
}: ResizeHandleProps) {
  const { themeStyle, themeAttribute } = useHyperbetThemeSurface(theme);
  return (
    <div
      className={`resize-handle resize-handle--${direction === "h" ? "horizontal" : "vertical"} ${className}`}
      data-hyperbet-theme={themeAttribute}
      style={themeStyle}
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => e.preventDefault()}
      role="separator"
      aria-orientation={direction === "h" ? "vertical" : "horizontal"}
      tabIndex={-1}
    />
  );
}
