export type UiLocale = "en" | "zh";

const UI_LOCALE_STORAGE_KEY = "hyperbet_ui_locale";

type UiCopy = {
  stats: string;
  buy: string;
  sell: string;
  connectWallet: string;
  predictionMarket: string;
  orderBook: string;
  recentTrades: string;
  price: string;
  size: string;
  side: string;
  time: string;
  total: string;
  spread: string;
  noTradesYet: string;
  noSellAction: string;
  locked: string;
  yesPool: string;
  noPool: string;
  actionLabel: (action: "buy" | "sell") => string;
  betAmountLabel: (symbol: string) => string;
  sellPanelDescription: (mode: "supported" | "evm" | "disabled") => string;
};

const UI_COPY: Record<UiLocale, UiCopy> = {
  en: {
    stats: "STATS",
    buy: "BUY",
    sell: "SELL",
    connectWallet: "CONNECT WALLET",
    predictionMarket: "PREDICTION MARKET",
    orderBook: "ORDER BOOK",
    recentTrades: "RECENT TRADES",
    price: "Price",
    size: "Size",
    side: "Side",
    time: "Time",
    total: "Total",
    spread: "Spread",
    noTradesYet: "No trades yet",
    noSellAction: "NO SELL ACTION",
    locked: "LOCKED",
    yesPool: "YES Pool",
    noPool: "NO Pool",
    actionLabel: (action) => (action === "buy" ? "BUY" : "SELL"),
    betAmountLabel: (symbol) => `Bet amount in ${symbol}`,
    sellPanelDescription: (mode) => {
      if (mode === "supported") {
        return "Submit sell-side orders with the controls below.";
      }
      if (mode === "evm") {
        return "EVM sell orders supported via the EVM panel.";
      }
      return "Sell disabled until market resolution.";
    },
  },
  zh: {
    stats: "数据",
    buy: "买入",
    sell: "卖出",
    connectWallet: "连接钱包",
    predictionMarket: "预测市场",
    orderBook: "订单簿",
    recentTrades: "最近成交",
    price: "价格",
    size: "数量",
    side: "方向",
    time: "时间",
    total: "总计",
    spread: "价差",
    noTradesYet: "暂无成交",
    noSellAction: "暂无卖出操作",
    locked: "已锁定",
    yesPool: "YES 池",
    noPool: "NO 池",
    actionLabel: (action) => (action === "buy" ? "买入" : "卖出"),
    betAmountLabel: (symbol) => `下注金额（${symbol}）`,
    sellPanelDescription: (mode) => {
      if (mode === "supported") {
        return "可使用下方控件提交卖出订单。";
      }
      if (mode === "evm") {
        return "EVM 卖出订单请在 EVM 面板中操作。";
      }
      return "市场结算前暂不支持卖出。";
    },
  },
};

function readStoredLocale(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(UI_LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readQueryLocale(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("lang");
  } catch {
    return null;
  }
}

function readNavigatorLocale(): string | null {
  if (typeof navigator === "undefined") return null;
  return navigator.languages?.[0] ?? navigator.language ?? null;
}

export function normalizeUiLocale(value: string | null | undefined): UiLocale {
  if (!value) return "en";
  return value.trim().toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function resolveUiLocale(value?: UiLocale | string | null): UiLocale {
  if (value) return normalizeUiLocale(value);
  return normalizeUiLocale(
    readQueryLocale() ?? readStoredLocale() ?? readNavigatorLocale(),
  );
}

export function setStoredUiLocale(locale: UiLocale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore localStorage write failures
  }
}

export function getLocaleTag(locale: UiLocale): string {
  return locale === "zh" ? "zh-CN" : "en-US";
}

export function getUiCopy(locale: UiLocale): UiCopy {
  return UI_COPY[locale];
}

export function formatLocaleNumber(
  value: number,
  locale: UiLocale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(getLocaleTag(locale), options).format(value);
}

export function formatLocaleAmount(value: number, locale: UiLocale): string {
  if (value > 0 && value < 0.000001) return "<0.000001";
  if (value > 0 && value < 1) {
    return value.toFixed(6).replace(/\.?0+$/, "");
  }
  if (locale === "zh") {
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
    if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  } else {
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  }
  if (value >= 1) {
    return formatLocaleNumber(value, locale, { maximumFractionDigits: 4 });
  }
  return "0";
}

export function formatTimeAgoLabel(ts: number, locale: UiLocale): string {
  const ago = Math.floor((Date.now() - ts) / 1000);
  if (ago < 0) return locale === "zh" ? "刚刚" : "just now";
  const mins = Math.floor(ago / 60);
  const secs = ago % 60;
  if (locale === "zh") {
    if (mins > 0) return `${mins}分${secs}秒前`;
    return `${secs}秒前`;
  }
  if (mins > 0) return `${mins}m ${secs}s ago`;
  return `${secs}s ago`;
}
