import { expect } from "chai";
import { ethers } from "hardhat";

import {
  deployDuelOutcomeOracle,
  type DuelOutcomeOracleContract,
} from "../typed-contracts";

describe("DuelOutcomeOracle", () => {
  async function deployFixture() {
    const [admin, reporter, other] = await ethers.getSigners();
    const oracle: DuelOutcomeOracleContract = await deployDuelOutcomeOracle(
      admin.address,
      reporter.address,
      admin,
    );
    await oracle.waitForDeployment();
    return { oracle, admin, reporter, other };
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
    const { oracle, other } = await deployFixture();

    await expect(
      oracle
        .connect(other)
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

  it("allows the admin to rotate the reporter", async () => {
    const { oracle, admin, other } = await deployFixture();

    await expect(oracle.connect(admin).setReporter(other.address, true)).to.not
      .be.reverted;

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
});
