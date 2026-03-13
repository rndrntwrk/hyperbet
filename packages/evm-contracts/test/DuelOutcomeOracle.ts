import { expect } from "chai";
import { ethers } from "hardhat";

import {
  deployDuelOutcomeOracle,
  type DuelOutcomeOracleContract,
} from "../typed-contracts";

describe("DuelOutcomeOracle", () => {
  async function deployFixture() {
    const [admin, reporter, finalizer, challenger, other] =
      await ethers.getSigners();
    const oracle: DuelOutcomeOracleContract = await deployDuelOutcomeOracle(
      admin.address,
      reporter.address,
      finalizer.address,
      challenger.address,
      3600,
      admin,
    );
    await oracle.waitForDeployment();
    return { oracle, admin, reporter, finalizer, challenger, other };
  }

  async function seedDuel(
    oracle: DuelOutcomeOracleContract,
    reporter: Awaited<ReturnType<typeof deployFixture>>["reporter"],
    duelKey: string,
  ) {
    await oracle.connect(reporter).upsertDuel(
      duelKey,
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      1_000,
      2_000,
      3_000,
      "https://example.com/duels/1",
      3,
    );
  }

  it("requires proposal then finalization after dispute window", async () => {
    const { oracle, reporter, finalizer } = await deployFixture();
    const duelKey =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    await seedDuel(oracle, reporter, duelKey);

    const resultHash =
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    const replayHash =
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const expectedProposalId = await oracle.proposalId(
      duelKey,
      resultHash,
      replayHash,
    );

    await expect(
      oracle
        .connect(reporter)
        .proposeResult(
          duelKey,
          1,
          42,
          replayHash,
          resultHash,
          4_000,
          "https://example.com/duels/1/proposal",
        ),
    )
      .to.emit(oracle, "ResultProposed")
      .withArgs(
        duelKey,
        expectedProposalId,
        1,
        42,
        4_000,
        resultHash,
        replayHash,
        "https://example.com/duels/1/proposal",
      );

    await expect(
      oracle
        .connect(finalizer)
        .finalizeResult(duelKey, "https://example.com/duels/1/final"),
    ).to.be.revertedWithCustomError(oracle, "DisputeWindowActive");

    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      oracle
        .connect(finalizer)
        .finalizeResult(duelKey, "https://example.com/duels/1/final"),
    ).to.emit(oracle, "DuelResolved");

    const duel = await oracle.getDuel(duelKey);
    expect(duel.status).to.equal(6n);
    expect(duel.activeProposalId).to.equal(expectedProposalId);
    expect(duel.winner).to.equal(1n);
  });

  it("blocks finalization for challenged proposals", async () => {
    const { oracle, reporter, finalizer, challenger } = await deployFixture();
    const duelKey =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    await seedDuel(oracle, reporter, duelKey);

    await oracle
      .connect(reporter)
      .proposeResult(
        duelKey,
        2,
        7,
        ethers.keccak256(ethers.toUtf8Bytes("r")),
        ethers.keccak256(ethers.toUtf8Bytes("s")),
        4_000,
        "proposal",
      );

    await expect(oracle.connect(challenger).challengeResult(duelKey, "challenged"))
      .to.emit(oracle, "ResultChallenged");

    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      oracle.connect(finalizer).finalizeResult(duelKey, "final"),
    ).to.be.revertedWithCustomError(oracle, "NotProposed");

    const duel = await oracle.getDuel(duelKey);
    expect(duel.status).to.equal(5n);
  });

  it("prevents unauthorized finalization", async () => {
    const { oracle, reporter, other } = await deployFixture();
    const duelKey =
      "0x3333333333333333333333333333333333333333333333333333333333333333";
    await seedDuel(oracle, reporter, duelKey);

    await oracle
      .connect(reporter)
      .proposeResult(
        duelKey,
        1,
        1,
        ethers.keccak256(ethers.toUtf8Bytes("replay")),
        ethers.keccak256(ethers.toUtf8Bytes("result")),
        5_000,
        "proposal",
      );

    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      oracle.connect(other).finalizeResult(duelKey, "final"),
    ).to.be.reverted;
  });
});
