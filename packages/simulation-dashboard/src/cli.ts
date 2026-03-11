type ScenarioRunRecord = {
    runId: string;
    scenarioId: string;
    scenarioName: string;
    seed: string;
    ticks: number;
    winner: "A" | "B";
    status: "queued" | "running" | "succeeded" | "failed";
    stage: string | null;
    requestedAt: number;
    startedAt: number | null;
    finishedAt: number | null;
    error: string | null;
    result: unknown | null;
};

const API_BASE_URL = (
    process.env.SIM_API_URL?.trim() || "http://127.0.0.1:3401"
).replace(/\/$/, "");
const POLL_INTERVAL_MS = Number(process.env.SIM_SCENARIO_POLL_MS ?? "1500");
const RUN_TIMEOUT_MS = Number(process.env.SIM_SCENARIO_TIMEOUT_MS ?? "300000");

function usage(): never {
    console.error(
        [
            "Usage:",
            "  bun run --cwd packages/simulation-dashboard scenario list",
            "  bun run --cwd packages/simulation-dashboard scenario latest",
            "  bun run --cwd packages/simulation-dashboard scenario history",
            "  bun run --cwd packages/simulation-dashboard scenario run <scenario-id-or-name> [--seed=...] [--ticks=...] [--winner=A|B]",
        ].join("\n"),
    );
    process.exit(1);
}

async function fetchJson(path: string): Promise<any> {
    const response = await fetch(`${API_BASE_URL}${path}`);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
        throw new Error(payload?.error || `${response.status} ${response.statusText}`);
    }
    return payload;
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

function printJson(value: unknown): void {
    console.log(JSON.stringify(value, null, 2));
}

function getFlagValue(args: string[], flag: string): string | undefined {
    return args
        .find((arg) => arg.startsWith(`${flag}=`))
        ?.slice(flag.length + 1)
        .trim();
}

async function pollRun(runId: string): Promise<ScenarioRunRecord> {
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const payload = await fetchJson(
            `/api/scenarios/results?runId=${encodeURIComponent(runId)}`,
        );
        const run = payload.run as ScenarioRunRecord | null;
        if (!run) {
            throw new Error(`Run not found: ${runId}`);
        }
        if (run.status === "succeeded" || run.status === "failed") {
            return run;
        }
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Scenario run ${runId} timed out after ${RUN_TIMEOUT_MS}ms`);
}

async function main(): Promise<void> {
    const [, , command, ...rest] = process.argv;

    switch (command) {
        case "list": {
            const payload = await fetchJson("/api/scenarios");
            printJson({
                scenarios: payload.scenarios,
                activeRun: payload.activeRun,
                latest: payload.latest,
            });
            return;
        }
        case "latest": {
            const payload = await fetchJson("/api/scenarios/results");
            printJson(payload.results?.[0] ?? null);
            return;
        }
        case "history": {
            const payload = await fetchJson("/api/scenarios/results");
            printJson({
                activeRun: payload.activeRun,
                runs: payload.runs,
                results: payload.results,
            });
            return;
        }
        case "run": {
            const scenario = rest.find((arg) => !arg.startsWith("--"));
            if (!scenario) {
                usage();
            }

            const params = new URLSearchParams({
                name: scenario,
            });
            const seed = getFlagValue(rest, "--seed");
            const ticks = getFlagValue(rest, "--ticks");
            const winner = getFlagValue(rest, "--winner");
            if (seed) params.set("seed", seed);
            if (ticks) params.set("ticks", ticks);
            if (winner) params.set("winner", winner);

            const payload = await fetchJson(
                `/api/scenarios/run?${params.toString()}`,
            );
            const run = payload.run as ScenarioRunRecord | null;
            if (!run) {
                throw new Error("Scenario run was accepted without a run record");
            }
            const completed = await pollRun(run.runId);
            printJson(completed);
            if (completed.status !== "succeeded") {
                process.exit(1);
            }
            return;
        }
        default:
            usage();
    }
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
