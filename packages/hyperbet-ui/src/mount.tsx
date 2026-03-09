import "./styles.css";

import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";

export function mountHyperbetApp(
  rootElement: HTMLElement,
  AppRoot: ComponentType,
): void {
  createRoot(rootElement).render(
    <StrictMode>
      <AppRoot />
    </StrictMode>,
  );
}
