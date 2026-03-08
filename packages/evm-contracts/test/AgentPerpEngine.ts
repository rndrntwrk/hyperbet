import { expect } from "chai";
import { ethers } from "hardhat";
import {
  deployAgentPerpEngine,
  deployMockErc20,
  deploySkillOracle,
} from "../typed-contracts";

describe("AgentPerpEngine — security regressions", function () {
  async function deployFixture() {
    const [owner, trader, liquidator] = await ethers.getSigners();
    const agentId = ethers.encodeBytes32String("MODEL_A");
    const otherAgentId = ethers.encodeBytes32String("MODEL_B");

    const oracle = await deploySkillOracle(ethers.parseEther("100"), owner);
    await oracle.waitForDeployment();

    await oracle.connect(owner).updateAgentSkill(agentId, 1500, 0);
    await oracle.connect(owner).updateAgentSkill(otherAgentId, 1500, 0);

    const marginToken = await deployMockErc20("USDC", "USDC", owner);
    await marginToken.waitForDeployment();

    const engine = await deployAgentPerpEngine(
      await oracle.getAddress(),
      await marginToken.getAddress(),
      ethers.parseEther("1000000000000"),
      owner,
    );
    await engine.waitForDeployment();

    await marginToken
      .connect(owner)
      .mint(trader.address, ethers.parseEther("1000"));
    await marginToken
      .connect(trader)
      .approve(await engine.getAddress(), ethers.MaxUint256);

    return {
      owner,
      trader,
      liquidator,
      agentId,
      otherAgentId,
      oracle,
      marginToken,
      engine,
    };
  }

  it("realizes PnL only for the size that was actually closed", async function () {
    const { owner, trader, agentId, oracle, engine } = await deployFixture();

    await engine
      .connect(trader)
      .modifyPosition(agentId, ethers.parseEther("30"), ethers.parseEther("1"));
    const initialPosition = await engine.positions(agentId, trader.address);

    await oracle.connect(owner).updateAgentSkill(agentId, 1750, 0);

    await engine
      .connect(trader)
      .modifyPosition(agentId, 0, -ethers.parseEther("0.2"));

    const position = await engine.positions(agentId, trader.address);
    expect(position.size).to.equal(ethers.parseEther("0.8"));
    expect(position.entryPrice).to.equal(initialPosition.entryPrice);
    expect(position.margin).to.be.closeTo(
      ethers.parseEther("35"),
      ethers.parseEther("0.001"),
    );
  });

  it("allows underwater ERC20 positions to be liquidated", async function () {
    const { owner, trader, liquidator, agentId, oracle, marginToken, engine } =
      await deployFixture();

    await engine
      .connect(trader)
      .modifyPosition(agentId, ethers.parseEther("30"), ethers.parseEther("1"));

    await oracle.connect(owner).updateAgentSkill(agentId, 1000, 0);

    const liquidatorBalBefore = await marginToken.balanceOf(liquidator.address);

    await engine.connect(liquidator).liquidate(agentId, trader.address);

    const position = await engine.positions(agentId, trader.address);
    const liquidatorBalAfter = await marginToken.balanceOf(liquidator.address);

    expect(position.size).to.equal(0n);
    expect(position.margin).to.equal(0n);
    expect(liquidatorBalAfter - liquidatorBalBefore).to.equal(
      ethers.parseEther("0.3"),
    );
  });
});
