/**
 * ChainSelector — Dropdown to pick active chain (Solana / BSC / Base / AVAX).
 */

import { useChain } from "../lib/ChainContext";
import { type ChainId } from "../lib/chainConfig";
import { getLocalizedChainDisplay } from "@hyperbet/ui/tokens";
import { resolveUiLocale } from "@hyperbet/ui/i18n";
import { type HyperbetThemeId, useHyperbetThemeSurface } from "../lib/theme";

function ChainIcon({
  icon,
  name,
}: {
  icon: string;
  name: string;
}) {
  const isUrl = icon.startsWith("http://") || icon.startsWith("https://");
  if (isUrl) {
    return (
      <img
        src={icon}
        alt={name}
        width={24}
        height={24}
        style={{ display: "block", width: 24, height: 24, objectFit: "contain" }}
      />
    );
  }
  return <>{icon}</>;
}

export function ChainSelector({ theme }: { theme?: HyperbetThemeId } = {}) {
  const { activeChain, setActiveChain, availableChains } = useChain();
  const locale = resolveUiLocale();
  const { themeStyle, themeAttribute } = useHyperbetThemeSurface(theme);

  if (availableChains.length <= 1) {
    const display = getLocalizedChainDisplay(activeChain, locale);
    return (
      <div
        className="chain-badge"
        data-hyperbet-theme={themeAttribute}
        style={themeStyle}
      >
        <span className="chain-badge-icon">
          <ChainIcon icon={display.icon} name={display.name} />
        </span>
        <span className="chain-badge-name">{display.shortName}</span>
      </div>
    );
  }

  return (
    <div
      className="chain-select-wrap"
      data-hyperbet-theme={themeAttribute}
      style={themeStyle}
    >
      <select
        id="chain-selector"
        className="chain-select"
        value={activeChain}
        onChange={(e) => setActiveChain(e.target.value as ChainId)}
      >
        {availableChains.map((chain) => {
          const display = getLocalizedChainDisplay(chain, locale);
          // <option> can't render images — fall back to emoji or short name
          const optionIcon =
            display.icon.startsWith("http://") ||
            display.icon.startsWith("https://")
              ? display.shortName
              : display.icon;
          return (
            <option key={chain} value={chain} style={{ background: "#111" }}>
              {optionIcon} {display.name}
            </option>
          );
        })}
      </select>
      <span className="chain-select-arrow">▼</span>
    </div>
  );
}
