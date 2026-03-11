import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AvaxTheme = "dark" | "light";

export const AVAX_THEME_STORAGE_KEY = "avax-theme";
const DEFAULT_THEME: AvaxTheme = "dark";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function getStoredTheme(): AvaxTheme {
  if (!isBrowser()) return DEFAULT_THEME;
  const stored = window.localStorage.getItem(AVAX_THEME_STORAGE_KEY);
  return stored === "light" ? "light" : DEFAULT_THEME;
}

export function applyTheme(theme: AvaxTheme): void {
  if (!isBrowser()) return;
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(AVAX_THEME_STORAGE_KEY, theme);
}

export function applyStoredTheme(): void {
  applyTheme(getStoredTheme());
}

type ThemeContextValue = {
  theme: AvaxTheme;
  setTheme: (theme: AvaxTheme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AvaxTheme>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((nextTheme: AvaxTheme) => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [setTheme, theme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
