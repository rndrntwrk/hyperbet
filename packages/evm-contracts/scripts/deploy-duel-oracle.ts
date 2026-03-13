import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";

function resolveOutputPath(networkName: string): string {
  return path.resolve(
    __dirname,
    "..",
    "deployments",
    "duel-outcome-oracle",
    `${networkName}.json`,
  );
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeReceipt(
  networkName: string,
  payload: Record<string, string | number | null>,
): void {
  const outputPath = resolveOutputPath(networkName);
  ensureParentDir(outputPath);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\n");
  console.log("Deployment receipt written to:", outputPath);
}

function requireAddress(name: string, fallback: string): string {
  const candidate = process.env[name]?.trim() || fallback;
  if (!ethers.isAddress(candidate)) {
    throw new Error(`Invalid ${name}: ${candidate}`);
  }
  return candidate;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployedNetwork = await ethers.provider.getNetwork();
  const chainId = Number(deployedNetwork.chainId);
  const admin = requireAddress("ORACLE_ADMIN_ADDRESS", deployer.address);
  const reporter = requireAddress("ORACLE_REPORTER_ADDRESS", deployer.address);
  const finalizer = requireAddress("ORACLE_FINALIZER_ADDRESS", reporter);
  const challenger = requireAddress("ORACLE_CHALLENGER_ADDRESS", reporter);

  console.log("Deploying DuelOutcomeOracle with account:", deployer.address);
  console.log("Network:", network.name, `(chainId=${chainId})`);
  console.log("Admin:", admin);
  console.log("Reporter:", reporter);
  console.log("Finalizer:", finalizer);
  console.log("Challenger:", challenger);

  const DuelOutcomeOracle =
    await ethers.getContractFactory("DuelOutcomeOracle");
  const oracle = await DuelOutcomeOracle.deploy(admin, reporter, finalizer, challenger, 3600);
  await oracle.waitForDeployment();

  const contractAddress = await oracle.getAddress();
  const deploymentTxHash = oracle.deploymentTransaction()?.hash ?? null;

  console.log("DuelOutcomeOracle deployed to:", contractAddress);

  writeReceipt(network.name, {
    network: network.name,
    chainId,
    deployer: deployer.address,
    oracleAddress: contractAddress,
    adminAddress: admin,
    reporterAddress: reporter,
    deploymentTxHash,
    deployedAt: new Date().toISOString(),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
