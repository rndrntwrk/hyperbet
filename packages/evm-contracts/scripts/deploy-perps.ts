import fs from "node:fs";
import path from "node:path";

import { ethers, network } from "hardhat";

type BootstrapMarketStatus = "ACTIVE" | "CLOSE_ONLY" | "ARCHIVED";

type BootstrapMarketConfig = {
  agentId: string;
  mu: string | number;
  sigma: string | number;
  insuranceFund?: string | number;
  status?: BootstrapMarketStatus;
  skewScale?: string | number;
  maxLeverage?: string | number;
  maintenanceMarginBps?: number;
  liquidationRewardBps?: number;
  maxOracleDelay?: number;
};

const MANIFEST_NETWORK_KEYS = new Map<string, string>([
  ["bscTestnet", "bscTestnet"],
  ["bsc", "bsc"],
  ["baseSepolia", "baseSepolia"],
  ["base", "base"],
  ["avaxFuji", "avaxFuji"],
  ["avax", "avax"],
]);

function resolveDeploymentOutputPath(networkName: string): string {
  return path.resolve(
    __dirname,
    "..",
    "deployments",
    `${networkName}.perps.json`,
  );
}

function ensureDir(filepath: string): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
}

function writeDeploymentReceipt(
  networkName: string,
  payload: Record<string, string | number | null>,
): void {
  const outputPath = resolveDeploymentOutputPath(networkName);
  ensureDir(outputPath);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  console.log("Perps deployment receipt written to:", outputPath);
}

function resolveManifestPaths(): string[] {
  return [
    path.resolve(
      __dirname,
      "..",
      "..",
      "hyperbet-deployments",
      "contracts.json",
    ),
  ];
}

function updatePerpsManifest(
  networkName: string,
  skillOracleAddress: string,
  perpEngineAddress: string,
  perpMarginTokenAddress: string,
): void {
  const manifestKey = MANIFEST_NETWORK_KEYS.get(networkName);
  if (!manifestKey) return;
  if (process.env.SKIP_BETTING_MANIFEST_UPDATE === "true") {
    console.log("Skipping betting manifest update");
    return;
  }

  for (const manifestPath of resolveManifestPaths()) {
    if (!fs.existsSync(manifestPath)) {
      console.warn("Skipping missing betting manifest:", manifestPath);
      continue;
    }

    const rawManifest = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(rawManifest) as {
      evm?: Record<
        string,
        {
          skillOracleAddress?: string;
          perpEngineAddress?: string;
          perpMarginTokenAddress?: string;
          deploymentVersion?: string;
        }
      >;
    };

    if (!manifest.evm || !manifest.evm[manifestKey]) {
      console.warn(
        `Skipping manifest without evm entry '${manifestKey}': ${manifestPath}`,
      );
      continue;
    }

    manifest.evm[manifestKey] = {
      ...manifest.evm[manifestKey],
      skillOracleAddress,
      perpEngineAddress,
      perpMarginTokenAddress,
      deploymentVersion: "v2",
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log("Updated perps manifest:", manifestPath);
  }
}

function parseUnitsValue(value: string | number, decimals = 18): bigint {
  return ethers.parseUnits(String(value).trim(), decimals);
}

function parseAgentId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("0x")) {
    if (trimmed.length !== 66) {
      throw new Error(`Invalid hex agentId '${trimmed}'`);
    }
    return trimmed;
  }
  return ethers.encodeBytes32String(trimmed);
}

function parseMarketStatus(value: BootstrapMarketStatus | undefined): number | null {
  if (!value) return null;
  switch (value) {
    case "ACTIVE":
      return 1;
    case "CLOSE_ONLY":
      return 2;
    case "ARCHIVED":
      return 3;
    default:
      return null;
  }
}

function parseBootstrapMarkets(): BootstrapMarketConfig[] {
  const raw = process.env.PERPS_BOOTSTRAP_MARKETS_JSON?.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("PERPS_BOOTSTRAP_MARKETS_JSON must be a JSON array");
  }
  return parsed as BootstrapMarketConfig[];
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const initialBasePrice = ethers.parseUnits(
    process.env.PERPS_INITIAL_BASE_PRICE?.trim() || "100",
    18,
  );
  const defaultSkewScale = ethers.parseUnits(
    process.env.PERPS_DEFAULT_SKEW_SCALE?.trim() || "1000000",
    18,
  );
  const fundingVelocity = process.env.PERPS_FUNDING_VELOCITY?.trim();
  const marginTokenAddress = process.env.PERPS_MARGIN_TOKEN_ADDRESS?.trim() || "";
  const ownerAddress = process.env.PERPS_OWNER_ADDRESS?.trim() || "";
  const reporterAddress = process.env.PERPS_REPORTER_ADDRESS?.trim() || "";
  const bootstrapMarkets = parseBootstrapMarkets();

  if (!marginTokenAddress || !ethers.isAddress(marginTokenAddress)) {
    throw new Error("PERPS_MARGIN_TOKEN_ADDRESS must be set to a valid ERC20 collateral token");
  }
  if (ownerAddress && !ethers.isAddress(ownerAddress)) {
    throw new Error("PERPS_OWNER_ADDRESS must be a valid EVM address when set");
  }
  if (reporterAddress && !ethers.isAddress(reporterAddress)) {
    throw new Error("PERPS_REPORTER_ADDRESS must be a valid EVM address when set");
  }

  console.log("Deploying perps contracts with account:", deployer.address);
  console.log("Network:", network.name, `(chainId=${chainId})`);
  console.log("Initial base price:", initialBasePrice.toString());
  console.log("Default skew scale:", defaultSkewScale.toString());
  console.log("Margin token:", marginTokenAddress);
  if (fundingVelocity) {
    console.log("Funding velocity override:", fundingVelocity);
  }
  if (bootstrapMarkets.length > 0) {
    console.log("Bootstrap markets:", bootstrapMarkets.length);
  }

  const SkillOracle = await ethers.getContractFactory("SkillOracle");
  const skillOracle = await SkillOracle.deploy(initialBasePrice);
  await skillOracle.waitForDeployment();

  const AgentPerpEngine = await ethers.getContractFactory(
    "AgentPerpEngine",
  );
  const perpEngine = await AgentPerpEngine.deploy(
    await skillOracle.getAddress(),
    marginTokenAddress,
    defaultSkewScale,
  );
  await perpEngine.waitForDeployment();

  if (fundingVelocity) {
    const fundingVelocityValue = parseUnitsValue(fundingVelocity, 0);
    await (await perpEngine.setFundingVelocity(fundingVelocityValue)).wait();
  }

  if (reporterAddress && reporterAddress !== deployer.address) {
    await (await skillOracle.setReporter(reporterAddress, true)).wait();
  }

  const skillOracleAddress = await skillOracle.getAddress();
  const perpEngineAddress = await perpEngine.getAddress();
  const marginToken = await ethers.getContractAt("IERC20", marginTokenAddress);
  const bootstrappedMarkets: Array<Record<string, string | number>> = [];

  for (const market of bootstrapMarkets) {
    const agentId = parseAgentId(market.agentId);
    const mu = parseUnitsValue(market.mu, 0);
    const sigma = parseUnitsValue(market.sigma, 0);
    const insuranceFund = market.insuranceFund
      ? parseUnitsValue(market.insuranceFund, 18)
      : 0n;
    const status = parseMarketStatus(market.status);
    const customConfig =
      market.skewScale !== undefined ||
      market.maxLeverage !== undefined ||
      market.maintenanceMarginBps !== undefined ||
      market.liquidationRewardBps !== undefined ||
      market.maxOracleDelay !== undefined;

    console.log(`Bootstrapping perps market ${market.agentId} (${agentId})`);
    await (await skillOracle.updateAgentSkill(agentId, mu, sigma)).wait();

    if (customConfig) {
      await (
        await perpEngine.createMarket(
          agentId,
          market.skewScale !== undefined
            ? parseUnitsValue(market.skewScale, 18)
            : defaultSkewScale,
          market.maxLeverage !== undefined
            ? parseUnitsValue(market.maxLeverage, 18)
            : ethers.parseUnits("5", 18),
          market.maintenanceMarginBps ?? 1_000,
          market.liquidationRewardBps ?? 500,
          market.maxOracleDelay ?? 120,
        )
      ).wait();
    } else {
      await (await perpEngine.createMarket(agentId)).wait();
    }

    if (insuranceFund > 0n) {
      await (await marginToken.approve(perpEngineAddress, insuranceFund)).wait();
      await (await perpEngine.depositInsuranceFund(agentId, insuranceFund)).wait();
    }

    if (status !== null && status !== 1) {
      await (await perpEngine.setMarketStatus(agentId, status)).wait();
    }

    bootstrappedMarkets.push({
      agentId: market.agentId,
      agentKey: agentId,
      mu: mu.toString(),
      sigma: sigma.toString(),
      insuranceFund: insuranceFund.toString(),
      status: status ?? 1,
    });
  }

  if (ownerAddress) {
    if (ownerAddress !== deployer.address) {
      await (await skillOracle.transferOwnership(ownerAddress)).wait();
      await (await perpEngine.transferOwnership(ownerAddress)).wait();
    }
  }

  console.log("SkillOracle deployed to:", skillOracleAddress);
  console.log("AgentPerpEngine deployed to:", perpEngineAddress);

  writeDeploymentReceipt(network.name, {
    network: network.name,
    chainId,
    deployer: deployer.address,
    skillOracleAddress,
    perpEngineAddress,
    marginTokenAddress,
    initialBasePrice: initialBasePrice.toString(),
    defaultSkewScale: defaultSkewScale.toString(),
    fundingVelocity: fundingVelocity?.trim() || null,
    ownerAddress: ownerAddress || deployer.address,
    reporterAddress: reporterAddress || deployer.address,
    bootstrappedMarkets: JSON.stringify(bootstrappedMarkets),
    deploymentTxHash: perpEngine.deploymentTransaction()?.hash ?? null,
    deployedAt: new Date().toISOString(),
  });

  updatePerpsManifest(
    network.name,
    skillOracleAddress,
    perpEngineAddress,
    marginTokenAddress,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
