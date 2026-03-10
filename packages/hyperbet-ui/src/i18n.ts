export type UiLocale = "en" | "zh" | "ko" | "pt" | "es";

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
  overall: string;
  headToHead: string;
  damage: string;
  fight: string;
  victory: string;
  wins: string;
  losses: string;
  winRate: string;
  mockWallet: string;
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
    overall: "OVR",
    headToHead: "H2H",
    damage: "DMG",
    fight: "FIGHT!",
    victory: "VICTORY",
    wins: "Wins",
    losses: "Losses",
    winRate: "Win Rate",
    mockWallet: "Mock Wallet",
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
    overall: "总计",
    headToHead: "交手",
    damage: "伤害",
    fight: "战斗！",
    victory: "胜利",
    wins: "胜场",
    losses: "败场",
    winRate: "胜率",
    mockWallet: "模拟钱包",
  },
  ko: {
    stats: "통계",
    buy: "매수",
    sell: "매도",
    connectWallet: "지갑 연결",
    predictionMarket: "예측 마켓",
    orderBook: "호가창",
    recentTrades: "최근 거래",
    price: "가격",
    size: "수량",
    side: "방향",
    time: "시간",
    total: "합계",
    spread: "스프레드",
    noTradesYet: "아직 거래가 없습니다",
    noSellAction: "매도 불가",
    locked: "잠김",
    yesPool: "YES 풀",
    noPool: "NO 풀",
    actionLabel: (action) => (action === "buy" ? "매수" : "매도"),
    betAmountLabel: (symbol) => `${symbol} 베팅 금액`,
    sellPanelDescription: (mode) => {
      if (mode === "supported") return "아래 컨트롤로 매도 주문을 제출하세요.";
      if (mode === "evm") return "EVM 패널에서 매도 주문을 지원합니다.";
      return "시장 정산 전까지 매도가 비활성화됩니다.";
    },
    overall: "종합",
    headToHead: "상대전적",
    damage: "피해",
    fight: "파이트!",
    victory: "승리",
    wins: "승",
    losses: "패",
    winRate: "승률",
    mockWallet: "모의 지갑",
  },
  pt: {
    stats: "ESTATÍSTICAS",
    buy: "COMPRAR",
    sell: "VENDER",
    connectWallet: "CONECTAR CARTEIRA",
    predictionMarket: "MERCADO DE PREVISÃO",
    orderBook: "LIVRO DE ORDENS",
    recentTrades: "NEGOCIAÇÕES RECENTES",
    price: "Preço",
    size: "Quantidade",
    side: "Lado",
    time: "Hora",
    total: "Total",
    spread: "Spread",
    noTradesYet: "Nenhuma negociação ainda",
    noSellAction: "SEM VENDA",
    locked: "BLOQUEADO",
    yesPool: "Pool SIM",
    noPool: "Pool NÃO",
    actionLabel: (action) => (action === "buy" ? "COMPRAR" : "VENDER"),
    betAmountLabel: (symbol) => `Valor da aposta em ${symbol}`,
    sellPanelDescription: (mode) => {
      if (mode === "supported") return "Envie ordens de venda com os controles abaixo.";
      if (mode === "evm") return "Ordens de venda EVM suportadas pelo painel EVM.";
      return "Venda desativada até a resolução do mercado.";
    },
    overall: "GERAL",
    headToHead: "H2H",
    damage: "DANO",
    fight: "LUTA!",
    victory: "VITÓRIA",
    wins: "Vitórias",
    losses: "Derrotas",
    winRate: "Taxa de Vitória",
    mockWallet: "Carteira Simulada",
  },
  es: {
    stats: "ESTADÍSTICAS",
    buy: "COMPRAR",
    sell: "VENDER",
    connectWallet: "CONECTAR BILLETERA",
    predictionMarket: "MERCADO DE PREDICCIÓN",
    orderBook: "LIBRO DE ÓRDENES",
    recentTrades: "OPERACIONES RECIENTES",
    price: "Precio",
    size: "Cantidad",
    side: "Lado",
    time: "Hora",
    total: "Total",
    spread: "Spread",
    noTradesYet: "Sin operaciones aún",
    noSellAction: "SIN VENTA",
    locked: "BLOQUEADO",
    yesPool: "Pool SÍ",
    noPool: "Pool NO",
    actionLabel: (action) => (action === "buy" ? "COMPRAR" : "VENDER"),
    betAmountLabel: (symbol) => `Monto de apuesta en ${symbol}`,
    sellPanelDescription: (mode) => {
      if (mode === "supported") return "Envíe órdenes de venta con los controles de abajo.";
      if (mode === "evm") return "Órdenes de venta EVM soportadas a través del panel EVM.";
      return "Venta deshabilitada hasta la resolución del mercado.";
    },
    overall: "TOTAL",
    headToHead: "H2H",
    damage: "DAÑO",
    fight: "¡PELEA!",
    victory: "VICTORIA",
    wins: "Victorias",
    losses: "Derrotas",
    winRate: "Tasa de Victoria",
    mockWallet: "Billetera Simulada",
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
  const lower = value.trim().toLowerCase();
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("pt")) return "pt";
  if (lower.startsWith("es")) return "es";
  return "en";
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
  const map: Record<UiLocale, string> = {
    en: "en-US",
    zh: "zh-CN",
    ko: "ko-KR",
    pt: "pt-BR",
    es: "es-ES",
  };
  return map[locale];
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
  } else if (locale === "ko") {
    if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억`;
    if (value >= 10_000) return `${(value / 10_000).toFixed(1)}만`;
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
  const mins = Math.floor(Math.max(0, ago) / 60);
  const secs = Math.max(0, ago) % 60;
  if (ago < 0) {
    const nowMap: Record<UiLocale, string> = {
      en: "just now",
      zh: "刚刚",
      ko: "방금",
      pt: "agora mesmo",
      es: "justo ahora",
    };
    return nowMap[locale];
  }
  if (locale === "zh") {
    if (mins > 0) return `${mins}分${secs}秒前`;
    return `${secs}秒前`;
  }
  if (locale === "ko") {
    if (mins > 0) return `${mins}분 ${secs}초 전`;
    return `${secs}초 전`;
  }
  if (locale === "pt") {
    if (mins > 0) return `${mins}m ${secs}s atrás`;
    return `${secs}s atrás`;
  }
  if (locale === "es") {
    if (mins > 0) return `hace ${mins}m ${secs}s`;
    return `hace ${secs}s`;
  }
  if (mins > 0) return `${mins}m ${secs}s ago`;
  return `${secs}s ago`;
}
