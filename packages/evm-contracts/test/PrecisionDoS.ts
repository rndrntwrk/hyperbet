import { expect } from "chai";
import { ethers } from "hardhat";

describe("GoldClob Precision DoS", () => {
    it("should process perfectly valid mixed-quantity matching without precision revert", async () => {
        const signers = await ethers.getSigners();
        const admin = signers[0];
        const maker = signers[1];
        const taker = signers[2];

        // Mocks
        const MockOracle = await ethers.getContractFactory("DuelOutcomeOracle");
        const oracle = await MockOracle.deploy(admin.address, admin.address);

        const GoldClob = await ethers.getContractFactory("GoldClob");
        const clob = await GoldClob.deploy(admin.address, admin.address, await oracle.getAddress(), admin.address, admin.address);
        await clob.setFeeConfig(0, 0, 0);

        const duelKey = ethers.id("duel-123");
        await oracle.upsertDuel(duelKey, ethers.id("p1"), ethers.id("p2"), 1, 2000000000, 2000000001, "m", 2);

        await clob.createMarketForDuel(duelKey, 0);

        // Maker sells 4000 amount at price 250 (requires 4000 * 750 / 1000 = 3000 value)
        await clob.connect(maker).placeOrder(duelKey, 0, 2, 250, 4000, { value: 3000 });

        const expectedMarketKey = await clob.marketKey(duelKey, 0);

        // Taker buys 2000 amount at limit price 500 (requires 2000 * 500 / 1000 = 1000 value)
        // Match fillAmount = 2000 at boundary 250. This must succeed.
        await expect(clob.connect(taker).placeOrder(duelKey, 0, 1, 500, 2000, { value: 1000 }))
          .to.emit(clob, "OrderMatched")
          .withArgs(expectedMarketKey, 1, 2, 2000, 250);
    });
});
