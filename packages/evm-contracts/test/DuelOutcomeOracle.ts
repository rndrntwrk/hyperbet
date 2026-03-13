import { expect } from "chai";
import { ethers } from "hardhat";

import {
  deployDuelOutcomeOracle,
  type DuelOutcomeOracleContract,
} from "../typed-contracts";

describe("DuelOutcomeOracle", () => {
  async function deployFixture() {
    const [admin, reporter, other, outsider] = await ethers.getSigners();
    const governanceFactory = await ethers.getContractFactory("GovernanceController", admin);
    const governance = await governanceFactory.deploy(admin.address, 300);
    await governance.waitForDeployment();

    const oracle: DuelOutcomeOracleContract = await deployDuelOutcomeOracle(
      admin.address,
      reporter.address,
      await governance.getAddress(),
      admin,
    );
    await oracle.waitForDeployment();
    return { oracle, governance, admin, reporter, other, outsider };
  }

  it("allows the reporter to upsert, resolve, and read duel state", async () => {
    const { oracle, reporter } = await deployFixture();
    const duelKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const participantAHash =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const participantBHash =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    await expect(
      oracle
        .connect(reporter)
        .upsertDuel(
          duelKey,
          participantAHash,
          participantBHash,
          1_000,
          2_000,
          3_000,
          "https://example.com/duels/1",
          2,
        ),
    ).to.emit(oracle, "DuelUpserted");

    await expect(
      oracle
        .connect(reporter)
        .reportResult(
          duelKey,
          1,
          42,
          "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          4_000,
          "https://example.com/duels/1",
        ),
    ).to.emit(oracle, "DuelResolved");

    const duel = await oracle.getDuel(duelKey);
    expect(duel.duelKey).to.equal(duelKey);
    expect(duel.status).to.equal(4n);
    expect(duel.winner).to.equal(1n);
    expect(duel.seed).to.equal(42n);
    expect(duel.duelEndTs).to.equal(4_000n);
  });

  it("prevents non-reporters from publishing duel state", async () => {
    const { oracle, outsider } = await deployFixture();

    await expect(
      oracle
        .connect(outsider)
        .upsertDuel(
          "0x2222222222222222222222222222222222222222222222222222222222222222",
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          10,
          20,
          30,
          "https://example.com/duels/2",
          2,
        ),
    ).to.be.reverted;
  });

  it("requires governance flow for non-emergency reporter rotation", async () => {
    const { oracle, governance, admin, other, outsider } = await deployFixture();

    await expect(oracle.connect(admin).setReporter(other.address, true)).to.be.reverted;

    const payload = oracle.interface.encodeFunctionData("setReporter", [other.address, true]);
    const salt = ethers.keccak256(ethers.toUtf8Bytes("rotate-reporter"));
    const latest = await ethers.provider.getBlock("latest");
    const executeAfter = BigInt((latest?.timestamp ?? 0) + 301);

    await governance
      .connect(admin)
      .schedule(await oracle.getAddress(), payload, salt, executeAfter);

    await expect(
      governance.connect(outsider).execute(await oracle.getAddress(), payload, salt),
    ).to.be.reverted;

    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(executeAfter)]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      governance.connect(outsider).execute(await oracle.getAddress(), payload, salt),
    ).to.not.be.reverted;

    await expect(
      oracle
        .connect(other)
        .upsertDuel(
          "0x3333333333333333333333333333333333333333333333333333333333333333",
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          10,
          20,
          30,
          "https://example.com/duels/3",
          2,
        ),
    ).to.emit(oracle, "DuelUpserted");
  });

  it("allows emergency reporter rotation by admin", async () => {
    const { oracle, admin, other } = await deployFixture();
    await expect(oracle.connect(admin).emergencySetReporter(other.address, true)).to.not.be
      .reverted;
  });
});
