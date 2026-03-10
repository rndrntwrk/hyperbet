import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { StreamPlayer } from "../src/components/StreamPlayer";
import { PredictionMarketPanel } from "../src/components/PredictionMarketPanel";
import { FightOverlay } from "../src/components/FightOverlay";
import { Sidebar } from "../src/components/Sidebar";
import { PointsDisplay } from "../src/components/PointsDisplay";
import { ModelsMarketView } from "../src/components/ModelsMarketView";
import {
    StorySurface,
    sampleAsks,
    sampleBids,
    sampleChartData,
    sampleFightAgent1,
    sampleFightAgent2,
    sampleTrades,
    sampleSolanaWallet,
} from "./storySupport";

function FullAppLayout() {
    const [side, setSide] = useState<"YES" | "NO">("YES");
    const [amountInput, setAmountInput] = useState("2.5");

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "1fr 360px",
                gridTemplateRows: "1fr auto",
                height: "100vh",
                gap: 0,
                overflow: "hidden",
            }}
        >
            {/* Main content area */}
            <div style={{ position: "relative", overflow: "hidden" }}>
                {/* Stream player background */}
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        background:
                            "radial-gradient(circle at center, rgba(229,184,74,0.14), transparent 38%), #05070d",
                    }}
                >
                    <StreamPlayer
                        streamUrl="https://www.youtube.com/watch?v=aqz-KE-bpKQ"
                        muted
                        autoPlay={false}
                    />
                </div>

                {/* Fight overlay */}
                <FightOverlay
                    phase="FIGHTING"
                    agent1={sampleFightAgent1}
                    agent2={sampleFightAgent2}
                    countdown={12}
                    timeRemaining={82}
                    winnerId={null}
                    winnerName={null}
                    winReason={null}
                />
            </div>

            {/* Right sidebar */}
            <Sidebar side="right" width={360} defaultExpanded>
                <div style={{ display: "grid", gap: 12, padding: 8 }}>
                    <PointsDisplay walletAddress={sampleSolanaWallet} />
                    <ModelsMarketView
                        activeMatchup="StormWarden vs JadePhoenix"
                    />
                </div>
            </Sidebar>

            {/* Bottom prediction panel */}
            <div
                style={{
                    gridColumn: "1 / -1",
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(13,16,22,0.96)",
                    padding: "12px 16px",
                }}
            >
                <StorySurface width="100%">
                    <PredictionMarketPanel
                        yesPercent={56}
                        noPercent={44}
                        yesPool="145.2 GOLD"
                        noPool="112.4 GOLD"
                        side={side}
                        setSide={setSide}
                        amountInput={amountInput}
                        setAmountInput={setAmountInput}
                        onPlaceBet={() => undefined}
                        isWalletReady
                        programsReady
                        agent1Name="StormWarden"
                        agent2Name="JadePhoenix"
                        isEvm={false}
                        chartData={sampleChartData}
                        bids={sampleBids}
                        asks={sampleAsks}
                        recentTrades={sampleTrades}
                    />
                </StorySurface>
            </div>
        </div>
    );
}

const meta = {
    title: "Frames/FullAppLayout",
    component: FullAppLayout,
    parameters: {
        layout: "fullscreen",
    },
} satisfies Meta<typeof FullAppLayout>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
