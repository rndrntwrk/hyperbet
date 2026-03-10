import { mountHyperbetApp } from "@hyperbet/ui";

import "./styles.css";
import AppRoot from "./AppRoot";
import { applyStoredTheme } from "./lib/theme";

applyStoredTheme();
mountHyperbetApp(document.getElementById("root")!, AppRoot);
