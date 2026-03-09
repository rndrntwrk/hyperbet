import { expect } from "chai";
import { ethers } from "hardhat";

import { deploySkillOracle, type SkillOracleContract } from "../typed-contracts";

describe("SkillOracle", () => {
  async function deployFixture() {
    const [owner] = await ethers.getSigners();
    const oracle: SkillOracleContract = await deploySkillOracle(
      ethers.parseEther("100"),
      owner,
    );
    await oracle.waitForDeployment();
    return { owner, oracle };
  }

  it("updates the global mean incrementally for inserts and overwrites", async () => {
    const { owner, oracle } = await deployFixture();
    const agentA = ethers.encodeBytes32String("MODEL_A");
    const agentB = ethers.encodeBytes32String("MODEL_B");

    await oracle.connect(owner).updateAgentSkill(agentA, 1_000, 50);
    expect(await oracle.globalMeanMu()).to.equal(1_000n);

    await oracle.connect(owner).updateAgentSkill(agentB, 1_400, 50);
    expect(await oracle.globalMeanMu()).to.equal(1_200n);

    await oracle.connect(owner).updateAgentSkill(agentA, 1_600, 50);
    expect(await oracle.globalMeanMu()).to.equal(1_500n);
  });

  it("keeps index prices positive for agents below the mean", async () => {
    const { owner, oracle } = await deployFixture();
    const agentA = ethers.encodeBytes32String("MODEL_A");
    const agentB = ethers.encodeBytes32String("MODEL_B");

    await oracle.connect(owner).updateAgentSkill(agentA, 1_000, 50);
    await oracle.connect(owner).updateAgentSkill(agentB, 1_500, 50);

    const lowerPrice = await oracle.getIndexPrice(agentA);
    const higherPrice = await oracle.getIndexPrice(agentB);

    expect(lowerPrice).to.be.greaterThan(0n);
    expect(higherPrice).to.be.greaterThan(lowerPrice);
  });
});
