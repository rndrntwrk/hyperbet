import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const EXPECTED_COMPONENTS = [
  "AgentStats",
  "ChainSelector",
  "EvmBettingPanel",
  "FightOverlay",
  "LocaleSelector",
  "ModelsMarketView",
  "OrderBook",
  "PointsDisplay",
  "PointsHistory",
  "PointsLeaderboard",
  "PredictionMarketPanel",
  "RecentTrades",
  "ReferralPanel",
  "ResizeHandle",
  "Sidebar",
  "SolanaClobPanel",
  "StreamPlayer",
  "Tabs",
  "WalletLinkCard",
];

const baseUrl = "http://127.0.0.1:6006";
const outputDir = path.resolve(process.cwd(), "storybook-artifacts");

function readPngSize(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Screenshot is not a PNG");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

console.log("loading story index");
const indexResponse = await fetch(`${baseUrl}/index.json`);
if (!indexResponse.ok) {
  throw new Error(`Failed to load Storybook index (${indexResponse.status})`);
}

const index = await indexResponse.json();
const componentStories = Object.values(index.entries)
  .filter((entry) => entry.type === "story" && entry.title.startsWith("Components/"))
  .sort((left, right) => left.title.localeCompare(right.title));

const renderedComponents = componentStories.map((entry) =>
  entry.title.replace("Components/", ""),
);

if (JSON.stringify(renderedComponents) !== JSON.stringify(EXPECTED_COMPONENTS)) {
  throw new Error(
    `Component story coverage mismatch.\nexpected: ${EXPECTED_COMPONENTS.join(", ")}\nactual: ${renderedComponents.join(", ")}`,
  );
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });

console.log("launching browser");
const browser = await chromium.launch({
  headless: true,
  args: ["--disable-dev-shm-usage"],
});

for (const entry of componentStories) {
  const page = await browser.newPage({
    viewport: {
      width: 1440,
      height: 1200,
    },
  });
  const storyErrors = [];
  const handleConsole = (message) => {
    if (message.type() === "error") {
      storyErrors.push(message.text());
    }
  };
  const handlePageError = (error) => {
    storyErrors.push(error.message);
  };
  page.on("console", handleConsole);
  page.on("pageerror", handlePageError);

  const url = `${baseUrl}/iframe.html?id=${entry.id}&viewMode=story`;
  process.stdout.write(`capturing ${entry.title} ... `);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(400);
  const root = page.locator("#storybook-root > *").first();
  await root.waitFor({
    state: "visible",
    timeout: 15_000,
  });
  const box = await root.boundingBox();
  if (!box || box.width < 120 || box.height < 120) {
    throw new Error(`Story rendered too small to verify: ${entry.title}`);
  }

  const bodyText = (await page.locator("body").innerText()).trim();
  if (/No Preview|ReferenceError|TypeError|Failed to fetch/i.test(bodyText)) {
    throw new Error(`Story failed to render cleanly: ${entry.title}`);
  }

  const safeTitle = entry.title.replace("Components/", "");
  const safeName = entry.name.toLowerCase().replace(/\s+/g, "-");
  await page.screenshot({
    path: path.join(outputDir, `${safeTitle}-${safeName}.png`),
    fullPage: true,
  });
  const screenshotBuffer = await fs.readFile(
    path.join(outputDir, `${safeTitle}-${safeName}.png`),
  );
  const { width, height } = readPngSize(screenshotBuffer);
  if (width < 120 || height < 120) {
    throw new Error(
      `Screenshot dimensions too small for ${entry.title}: ${width}x${height}`,
    );
  }
  if (storyErrors.length > 0) {
    throw new Error(
      `Story emitted console/page errors: ${entry.title}\n${storyErrors.join("\n")}`,
    );
  }

  await page.close();

  process.stdout.write("ok\n");
}

await browser.close();
