/**
 * ChainSelector — Dropdown to pick active chain (Solana / BSC / Base / AVAX).
 */

import { useChain } from "../lib/ChainContext";
import { type ChainId } from "../lib/chainConfig";
import { getLocalizedChainDisplay } from "@hyperbet/ui/tokens";
import { resolveUiLocale } from "@hyperbet/ui/i18n";

export function ChainSelector() {
  const { activeChain, setActiveChain, availableChains } = useChain();
  const locale = resolveUiLocale();

  if (availableChains.length <= 1) {
    const display = getLocalizedChainDisplay(activeChain, locale);
    return (
      <div className="chain-badge">
        <span className="chain-badge-icon">{display.icon}</span>
        <span className="chain-badge-name">{display.shortName}</span>
      </div>
    );
  }

  return (
    <div className="chain-select-wrap">
      <select
        id="chain-selector"
        className="chain-select"
        value={activeChain}
        onChange={(e) => setActiveChain(e.target.value as ChainId)}
      >
        {availableChains.map((chain) => {
          const display = getLocalizedChainDisplay(chain, locale);
          return (
            <option key={chain} value={chain} style={{ background: "#111" }}>
              {display.icon} {display.name}
            </option>
          );
        })}
      </select>
      <span className="chain-select-arrow">▼</span>
    </div>
  );
}
