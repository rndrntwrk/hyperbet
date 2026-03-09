import type { Preview } from "@storybook/react";
import React, { useEffect } from "react";
import { Buffer } from "buffer";
import { Toaster } from "sonner";
import { ChainProvider, useChain } from "../src/lib/ChainContext";
import { setStoredUiLocale, type UiLocale } from "../src/i18n";
import "../src/styles.css";

type ChainId = "solana" | "bsc" | "base" | "avax";

const SELECTED_CHAIN_STORAGE_KEY = "goldArena_selectedChain";
const STORYBOOK_WALLET = "9YQ6U3b1i3Qxb38nSxrdbidKdvUSsfx8bVsgcuyo6edS";
const STORYBOOK_EVM_WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const STORYBOOK_TIME = new Date("2026-03-09T18:20:00.000Z").getTime();
const mockStreamingState = {
  type: "STREAMING_STATE_UPDATE",
  seq: 42,
  emittedAt: STORYBOOK_TIME,
  cameraTarget: null,
  cycle: {
    cycleId: "cycle-42",
    duelId: "duel-42",
    duelKeyHex:
      "1f1e1d1c1b1a19181716151413121110f1e2d3c4b5a697887766554433221100",
    phase: "ANNOUNCEMENT",
    betCloseTime: STORYBOOK_TIME + 5 * 60_000,
    winnerName: null,
    winReason: null,
    agent1: {
      id: "YES",
      name: "StormWarden",
      provider: "OpenAI",
      model: "gpt-5",
      hp: 82,
      maxHp: 100,
      wins: 42,
      losses: 12,
      combatLevel: 94,
      damageDealtThisFight: 311,
      inventory: [],
      monologues: [],
    },
    agent2: {
      id: "NO",
      name: "JadePhoenix",
      provider: "Anthropic",
      model: "claude-sonnet",
      hp: 67,
      maxHp: 100,
      wins: 38,
      losses: 15,
      combatLevel: 89,
      damageDealtThisFight: 287,
      inventory: [],
      monologues: [],
    },
  },
  leaderboard: [
    {
      rank: 1,
      name: "StormWarden",
      provider: "OpenAI",
      wins: 42,
      losses: 12,
      winRate: 77.7,
      currentStreak: 6,
    },
    {
      rank: 2,
      name: "JadePhoenix",
      provider: "Anthropic",
      wins: 38,
      losses: 15,
      winRate: 71.6,
      currentStreak: 3,
    },
  ],
};

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });
}

function installBrowserMocks() {
  if (typeof window === "undefined") return;

  const nativeFetch = window.fetch.bind(window);
  if (!(window as typeof window & { __hyperbetStoryFetch?: boolean })
    .__hyperbetStoryFetch) {
    const storyFetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const requestUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const url = new URL(requestUrl, window.location.origin);
        const pathname = url.pathname;

        if (pathname.includes("/api/arena/points/leaderboard")) {
          return jsonResponse({
            leaderboard: [
              {
                rank: 1,
                wallet: "0xA11CE000000000000000000000000000000001",
                totalPoints: 48120,
              },
              {
                rank: 2,
                wallet: STORYBOOK_WALLET,
                totalPoints: 35300,
              },
              {
                rank: 3,
                wallet: STORYBOOK_EVM_WALLET,
                totalPoints: 30990,
              },
            ],
          });
        }

        if (pathname.includes("/api/arena/points/history/")) {
          return jsonResponse({
            total: 3,
            entries: [
              {
                id: 101,
                eventType: "BET_WON",
                status: "settled",
                totalPoints: 750,
                referenceType: "match",
                referenceId: "duel-17",
                relatedWallet: null,
                createdAt: STORYBOOK_TIME - 3_600_000,
              },
              {
                id: 102,
                eventType: "REFERRAL_WIN",
                status: "credited",
                totalPoints: 180,
                referenceType: "invite",
                referenceId: "ZH88",
                relatedWallet: STORYBOOK_EVM_WALLET,
                createdAt: STORYBOOK_TIME - 86_400_000,
              },
              {
                id: 103,
                eventType: "WALLET_LINK",
                status: "credited",
                totalPoints: 100,
                referenceType: "wallet_link",
                referenceId: "linked",
                relatedWallet: STORYBOOK_EVM_WALLET,
                createdAt: STORYBOOK_TIME - 172_800_000,
              },
            ],
          });
        }

        if (pathname.includes("/api/arena/points/rank/")) {
          return jsonResponse({
            wallet: STORYBOOK_WALLET,
            rank: 12,
            totalPoints: 35300,
          });
        }

        if (pathname.includes("/api/arena/points/multiplier/")) {
          return jsonResponse({
            wallet: STORYBOOK_WALLET,
            multiplier: 3,
            tier: "GOLD",
            nextTierThreshold: 10000000,
            goldBalance: "1250000",
            goldHoldDays: 16,
          });
        }

        if (
          pathname.includes("/api/arena/points/") &&
          !pathname.includes("/history/") &&
          !pathname.includes("/leaderboard") &&
          !pathname.includes("/rank/") &&
          !pathname.includes("/multiplier/")
        ) {
          return jsonResponse({
            wallet: STORYBOOK_WALLET,
            pointsScope: "LINKED",
            identityWalletCount: 2,
            totalPoints: 35300,
            selfPoints: 9200,
            winPoints: 18000,
            referralPoints: 5100,
            stakingPoints: 3000,
            invitedWalletCount: 4,
            referredBy: {
              wallet: "0xA11CE000000000000000000000000000000001",
              code: "ARENA88",
            },
            multiplier: 3,
            goldBalance: "1250000",
            goldHoldDays: 16,
          });
        }

        if (pathname.includes("/api/arena/invite/redeem")) {
          return jsonResponse({
            result: {
              signupBonus: 25,
              alreadyLinked: false,
            },
          });
        }

        if (pathname.includes("/api/arena/wallet-link")) {
          return jsonResponse({
            result: {
              alreadyLinked: false,
              awardedPoints: 100,
            },
          });
        }

        if (pathname.includes("/api/arena/invite/")) {
          return jsonResponse({
            wallet: STORYBOOK_WALLET,
            platformView: "solana",
            inviteCode: "ARENA88",
            invitedWalletCount: 4,
            invitedWallets: [
              "0xA11CE000000000000000000000000000000001",
              "0xB0B000000000000000000000000000000000002",
              "0xC4R010000000000000000000000000000000003",
            ],
            invitedWalletsTruncated: true,
            pointsFromReferrals: 5100,
            feeShareFromReferralsGold: "182.35",
            treasuryFeesFromReferredBetsGold: "614.12",
            referredByWallet: "0xA11CE000000000000000000000000000000001",
            referredByCode: "ARENA88",
            activeReferralCount: 3,
            pendingSignupBonuses: 1,
            totalReferralWinPoints: 280,
          });
        }

        if (pathname.includes("/api/perps/oracle-history")) {
          const characterId =
            url.searchParams.get("characterId") ?? "stormwarden";
          return jsonResponse({
            characterId,
            marketId: 17,
            updatedAt: STORYBOOK_TIME,
            snapshots: [
              {
                agentId: characterId,
                marketId: 17,
                spotIndex: 138.2,
                conservativeSkill: 25.1,
                mu: 33.4,
                sigma: 2.76,
                recordedAt: STORYBOOK_TIME - 15 * 60_000,
              },
              {
                agentId: characterId,
                marketId: 17,
                spotIndex: 141.4,
                conservativeSkill: 25.9,
                mu: 34.1,
                sigma: 2.73,
                recordedAt: STORYBOOK_TIME - 10 * 60_000,
              },
              {
                agentId: characterId,
                marketId: 17,
                spotIndex: 145.1,
                conservativeSkill: 26.4,
                mu: 34.7,
                sigma: 2.77,
                recordedAt: STORYBOOK_TIME - 5 * 60_000,
              },
            ],
          });
        }

        if (pathname.includes("/api/perps/markets")) {
          return jsonResponse({
            updatedAt: STORYBOOK_TIME,
            markets: [
              {
                rank: 1,
                characterId: "stormwarden",
                marketId: 17,
                name: "StormWarden",
                provider: "OpenAI",
                model: "gpt-5",
                wins: 42,
                losses: 12,
                winRate: 77.7,
                combatLevel: 94,
                currentStreak: 6,
                status: "ACTIVE",
                lastSeenAt: STORYBOOK_TIME - 2_000,
                deprecatedAt: null,
                updatedAt: STORYBOOK_TIME,
              },
              {
                rank: 2,
                characterId: "jadephoenix",
                marketId: 18,
                name: "JadePhoenix",
                provider: "Anthropic",
                model: "claude-sonnet",
                wins: 38,
                losses: 15,
                winRate: 71.6,
                combatLevel: 89,
                currentStreak: 3,
                status: "CLOSE_ONLY",
                lastSeenAt: STORYBOOK_TIME - 4_000,
                deprecatedAt: STORYBOOK_TIME - 86_400_000,
                updatedAt: STORYBOOK_TIME,
              },
            ],
          });
        }

        if (pathname.includes("/api/streaming/state")) {
          return jsonResponse(mockStreamingState);
        }

        if (pathname.includes("/game-assets/manifests/items/")) {
          return jsonResponse([]);
        }

        return nativeFetch(input, init);
      },
      nativeFetch,
    ) as typeof window.fetch;
    window.fetch = storyFetch;
    (window as typeof window & { __hyperbetStoryFetch?: boolean }).__hyperbetStoryFetch =
      true;
  }

  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  if (!window.ResizeObserver) {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverMock;
  }

  if (!window.IntersectionObserver) {
    class IntersectionObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    window.IntersectionObserver =
      IntersectionObserverMock as typeof window.IntersectionObserver;
  }

  class StorybookEventSource {
    onopen: (() => void) | null = null;
    onerror: ((error?: unknown) => void) | null = null;
    #listeners = new Map();

    constructor() {
      window.setTimeout(() => {
        this.onopen?.();
        this.#emit("state", {
          data: JSON.stringify(mockStreamingState),
          lastEventId: "42",
        });
      }, 0);
    }

    addEventListener(
      type: string,
      listener: (event: MessageEvent<string>) => void,
    ) {
      this.#listeners.set(type, listener);
    }

    close() {}

    #emit(type: string, payload: { data: string; lastEventId: string }) {
      const listener = this.#listeners.get(type);
      if (!listener) return;
      listener(payload as unknown as MessageEvent<string>);
    }
  }
  (window as typeof window & { EventSource?: typeof EventSource }).EventSource =
    StorybookEventSource as unknown as typeof EventSource;

  if (!navigator.clipboard) {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => undefined,
      },
      configurable: true,
    });
  }

  const mediaProto = HTMLMediaElement.prototype as HTMLMediaElement & {
    __storybookPatched?: boolean;
  };
  if (!mediaProto.__storybookPatched) {
    mediaProto.play = async () => undefined;
    mediaProto.pause = () => undefined;
    mediaProto.load = () => undefined;
    mediaProto.__storybookPatched = true;
  }

  if (!(window as typeof window & { Buffer?: typeof Buffer }).Buffer) {
    (window as typeof window & { Buffer?: typeof Buffer }).Buffer = Buffer;
  }
  if (!(globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer) {
    (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer =
      Buffer;
  }
}

installBrowserMocks();

function StoryFrame({
  children,
  chain,
  locale,
}: {
  children: React.ReactNode;
  chain: ChainId;
  locale: UiLocale;
}) {
  useEffect(() => {
    setStoredUiLocale(locale);
    window.localStorage.setItem(SELECTED_CHAIN_STORAGE_KEY, chain);
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en-US";
  }, [chain, locale]);

  return (
    <ChainProvider>
      <StoryChainPreset chain={chain}>
        <div
          style={{
            minHeight: "100vh",
            padding: 24,
            background:
              "radial-gradient(circle at top, rgba(229,184,74,0.18), transparent 32%), linear-gradient(180deg, #16181f 0%, #0d1016 100%)",
            color: "#fff",
            boxSizing: "border-box",
          }}
        >
          <Toaster theme="dark" position="bottom-right" />
          {children}
        </div>
      </StoryChainPreset>
    </ChainProvider>
  );
}

function StoryChainPreset({
  chain,
  children,
}: {
  chain: ChainId;
  children: React.ReactNode;
}) {
  const { activeChain, setActiveChain } = useChain();

  useEffect(() => {
    if (activeChain !== chain) {
      setActiveChain(chain);
    }
  }, [activeChain, chain, setActiveChain]);

  return <>{children}</>;
}

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    layout: "fullscreen",
    backgrounds: {
      default: "arena",
      values: [
        { name: "arena", value: "#0d1016" },
      ],
    },
  },
  globalTypes: {
    locale: {
      name: "Locale",
      defaultValue: "en",
      toolbar: {
        icon: "globe",
        items: [
          { value: "en", title: "English" },
          { value: "zh", title: "Chinese" },
        ],
      },
    },
    chain: {
      name: "Chain",
      defaultValue: "solana",
      toolbar: {
        icon: "database",
        items: [
          { value: "solana", title: "Solana" },
          { value: "bsc", title: "BSC" },
          { value: "base", title: "Base" },
          { value: "avax", title: "AVAX" },
        ],
      },
    },
  },
  decorators: [
    (Story, context) => (
      <StoryFrame
        chain={(context.parameters.chain as ChainId | undefined) ?? (context.globals.chain as ChainId)}
        locale={(context.parameters.locale as UiLocale | undefined) ?? (context.globals.locale as UiLocale)}
      >
        <Story />
      </StoryFrame>
    ),
  ],
};

export default preview;
