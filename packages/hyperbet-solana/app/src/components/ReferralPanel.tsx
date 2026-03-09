import { useCallback, useEffect, useState } from "react";
import { buildArenaWriteHeaders, GAME_API_URL } from "../lib/config";

type PointsSnapshot = {
  wallet: string;
  pointsScope?: "WALLET";
  totalPoints: number;
  selfPoints: number;
  winPoints: number;
  referralPoints: number;
  stakingPoints: number;
  invitedWalletCount: number;
  referredBy: { wallet: string; code: string } | null;
};

type InviteSummary = {
  wallet: string;
  platformView: string;
  inviteCode: string;
  invitedWalletCount: number;
  invitedWallets: string[];
  invitedWalletsTruncated: boolean;
  pointsFromReferrals: number;
  feeShareFromReferralsGold: string;
  treasuryFeesFromReferredBetsGold: string;
  referredByWallet: string | null;
  referredByCode: string | null;
  activeReferralCount: number;
  pendingSignupBonuses: number;
  totalReferralWinPoints: number;
};

const LOCAL_INVITE_ORIGIN = "http://localhost:4179";
const WEBSITE_INVITE_ORIGIN = "https://hyperscape.bet";

function shortWallet(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function extractInviteCode(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!trimmed.includes("://")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    return parsed.searchParams.get("invite")?.trim() ?? "";
  } catch {
    return "";
  }
}

function buildInviteShareLink(inviteCode: string): string {
  if (typeof window === "undefined") {
    return `${WEBSITE_INVITE_ORIGIN}/?invite=${encodeURIComponent(inviteCode)}`;
  }
  const isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const shareOrigin = isLocalHost ? LOCAL_INVITE_ORIGIN : WEBSITE_INVITE_ORIGIN;
  const url = new URL(window.location.pathname, `${shareOrigin}/`);
  url.searchParams.set("invite", inviteCode);
  return url.toString();
}

export function ReferralPanel(props: { solanaWallet: string | null }) {
  const { solanaWallet: wallet } = props;
  const [points, setPoints] = useState<PointsSnapshot | null>(null);
  const [invite, setInvite] = useState<InviteSummary | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshStats = useCallback(async () => {
    if (!wallet) {
      setPoints(null);
      setInvite(null);
      setStatsError("");
      setLoadingStats(false);
      return;
    }

    try {
      setLoadingStats(true);
      setStatsError("");
      const [pointsRes, inviteRes] = await Promise.all([
        fetch(`${GAME_API_URL}/api/arena/points/${wallet}?scope=wallet`, {
          cache: "no-store",
        }),
        fetch(`${GAME_API_URL}/api/arena/invite/${wallet}?platform=solana`, {
          cache: "no-store",
        }),
      ]);

      const errors: string[] = [];
      if (pointsRes.ok) {
        setPoints((await pointsRes.json()) as PointsSnapshot);
      } else {
        setPoints(null);
        errors.push(`points ${pointsRes.status}`);
      }
      if (inviteRes.ok) {
        setInvite((await inviteRes.json()) as InviteSummary);
      } else {
        setInvite(null);
        errors.push(`invite ${inviteRes.status}`);
      }

      setStatsError(errors.length > 0 ? `Stats unavailable (${errors.join(", ")})` : "");
    } catch {
      setPoints(null);
      setInvite(null);
      setStatsError("Stats request failed");
    } finally {
      setLoadingStats(false);
    }
  }, [wallet]);

  useEffect(() => {
    void refreshStats();
    const id = window.setInterval(() => void refreshStats(), 15_000);
    return () => window.clearInterval(id);
  }, [refreshStats]);

  useEffect(() => {
    const inviteFromQuery = new URLSearchParams(window.location.search)
      .get("invite")
      ?.trim();
    if (!inviteFromQuery) return;
    setRedeemCode((current) =>
      current.trim() ? current : inviteFromQuery.toUpperCase(),
    );
  }, []);

  const handleRedeem = useCallback(async () => {
    if (!wallet) {
      setStatus("Connect a Solana wallet to redeem an invite code");
      return;
    }

    const code = extractInviteCode(redeemCode).toUpperCase();
    if (!code) {
      setStatus("Enter an invite code");
      return;
    }

    setBusy(true);
    setStatus("Redeeming invite code...");
    try {
      const response = await fetch(`${GAME_API_URL}/api/arena/invite/redeem`, {
        method: "POST",
        headers: buildArenaWriteHeaders(),
        body: JSON.stringify({ wallet, inviteCode: code }),
      });
      const payload = (await response.json()) as {
        error?: string;
        result?: { signupBonus?: number; alreadyLinked?: boolean };
        signupBonus?: number;
      };
      if (!response.ok) {
        setStatus(payload.error ?? "Invite redeem failed");
        return;
      }
      const bonus = payload.result?.signupBonus ?? payload.signupBonus ?? 0;
      if (payload.result?.alreadyLinked) {
        setStatus("Already linked to this referrer");
      } else if (bonus > 0) {
        setStatus(`Invite code linked! +${bonus} bonus points`);
      } else {
        setStatus("Invite code linked");
      }
      setRedeemCode("");
      await refreshStats();
    } catch {
      setStatus("Invite redeem failed");
    } finally {
      setBusy(false);
    }
  }, [redeemCode, refreshStats, wallet]);

  const shareLink = invite?.inviteCode
    ? buildInviteShareLink(invite.inviteCode)
    : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.56)" }}>
          Active wallet
        </div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>
          {wallet ? shortWallet(wallet) : "Connect SOL wallet"}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.56)" }}>
          Invite code
        </div>
        <div
          data-testid="referral-panel-invite-code"
          style={{ fontSize: 14, fontWeight: 700 }}
        >
          {invite?.inviteCode || "Not available"}
        </div>
        {shareLink ? (
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.52)" }}>
            {shareLink}
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <StatCard label="Total Points" value={String(points?.totalPoints ?? 0)} />
        <StatCard
          label="Referral Points"
          value={String(points?.referralPoints ?? 0)}
        />
        <StatCard
          label="Invited Wallets"
          value={String(invite?.invitedWalletCount ?? 0)}
        />
        <StatCard
          label="Referral Fee Share"
          value={invite?.feeShareFromReferralsGold ?? "0.000000"}
        />
      </div>

      <div
        data-testid="referral-panel-referred-by"
        style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}
      >
        Referred by:{" "}
        {points?.referredBy
          ? `${shortWallet(points.referredBy.wallet)} (${points.referredBy.code})`
          : "None"}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label
          htmlFor="invite-redeem-code"
          style={{ fontSize: 12, color: "rgba(255,255,255,0.56)" }}
        >
          Redeem invite
        </label>
        <input
          id="invite-redeem-code"
          data-testid="referral-panel-redeem-input"
          value={redeemCode}
          onChange={(event) => setRedeemCode(event.target.value)}
          placeholder="INVITE CODE"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "white",
          }}
        />
        <button
          type="button"
          onClick={() => void handleRedeem()}
          disabled={busy || !wallet}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(242,208,138,0.35)",
            background: "rgba(242,208,138,0.12)",
            color: "#f2d08a",
            fontWeight: 700,
            cursor: busy || !wallet ? "not-allowed" : "pointer",
            opacity: busy || !wallet ? 0.6 : 1,
          }}
        >
          Redeem Code
        </button>
      </div>

      {loadingStats ? (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.56)" }}>
          Loading referral stats...
        </div>
      ) : null}
      {statsError ? (
        <div style={{ fontSize: 12, color: "#fda4af" }}>{statsError}</div>
      ) : null}
      {status ? (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.72)" }}>
          {status}
        </div>
      ) : null}
    </div>
  );
}

function StatCard(props: { label: string; value: string }) {
  const { label, value } = props;
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.52)" }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
