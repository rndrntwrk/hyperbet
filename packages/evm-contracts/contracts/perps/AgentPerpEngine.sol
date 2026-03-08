// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./SkillOracle.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title AgentPerpEngine
 * @notice A perpetual futures engine driven by Agent TrueSkill instead of public spot markets.
 *         Implements oracle-execution with skew-based price impact and funding.
 */
contract AgentPerpEngine is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant ONE = 1e18;
    uint256 public constant MAX_LEVERAGE = 5 * ONE;

    SkillOracle public immutable oracle;
    IERC20 public immutable marginToken; // e.g. USDC or Gold

    struct MarketState {
        uint256 totalLongOI;
        uint256 totalShortOI;
        int256 currentFundingRate; // rate per second (scaled by 1e18)
        uint256 lastUpdateTimestamp;
    }

    struct Position {
        int256 size; // + for Long, - for Short
        uint256 margin;
        uint256 entryPrice;
        int256 lastFundingRate;
    }

    mapping(bytes32 => MarketState) public markets;
    mapping(bytes32 => mapping(address => Position)) public positions;

    // Parameters mapped to Skew limits
    uint256 public immutable skewScale; // Controls how fast price impact grows (e.g. 1e6)
    uint256 public immutable fundingVelocity; // How fast the funding rate changes based on skew

    uint256 public insuranceFund;

    event PositionOpened(
        bytes32 indexed agentId,
        address indexed trader,
        int256 sizeDelta,
        uint256 executionPrice,
        int256 newSize,
        uint256 margin
    );
    event PositionLiquidated(bytes32 indexed agentId, address indexed trader, int256 size, uint256 liquidationPrice);
    event InsuranceFundWithdrawn(address indexed to, uint256 amount);

    constructor(SkillOracle _oracle, IERC20 _marginToken, uint256 _skewScale) Ownable(msg.sender) {
        require(address(_oracle) != address(0), "Invalid oracle");
        require(address(_marginToken) != address(0), "Invalid margin token");
        require(_skewScale > 0, "Invalid skew scale");
        oracle = _oracle;
        marginToken = _marginToken;
        skewScale = _skewScale;
        fundingVelocity = 1e12; // Modest drift
    }

    // slither-disable-next-line timestamp
    function _updateFunding(bytes32 agentId) internal {
        MarketState storage market = markets[agentId];
        uint256 timeDelta = block.timestamp - market.lastUpdateTimestamp;
        if (timeDelta != 0) {
            int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
            // Funding velocity pushes the premium based on prolonged skew
            market.currentFundingRate += (skew * int256(fundingVelocity) * int256(timeDelta)) / int256(skewScale);
            market.lastUpdateTimestamp = block.timestamp;
        }
    }

    // slither-disable-next-line timestamp
    function getExecutionPrice(bytes32 agentId, int256 sizeDelta) public view returns (uint256) {
        uint256 indexPrice = oracle.getIndexPrice(agentId);
        MarketState memory market = markets[agentId];

        int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);

        // Simulating price impact: execution price = indexPrice * (1 + (skew + sizeDelta/2) / skewScale)
        // Note: sizeDelta is added to simulate the impact of the caller's trade pushing the skew.
        int256 premium = ((skew + sizeDelta / 2) * int256(ONE)) / int256(skewScale);
        uint256 execPrice;

        if (premium >= 0) {
            execPrice = indexPrice + (indexPrice * uint256(premium)) / ONE;
        } else {
            uint256 absPremium = uint256(-premium);
            if (absPremium >= ONE) {
                execPrice = indexPrice / 10; // Floor execution price drop
            } else {
                execPrice = indexPrice - (indexPrice * absPremium) / ONE;
            }
        }
        return execPrice;
    }

    function _abs(int256 value) internal pure returns (uint256) {
        return value >= 0 ? uint256(value) : uint256(-value);
    }

    function _realizePnl(int256 existingSize, uint256 entryPrice, uint256 execPrice, uint256 closeSize)
        internal
        pure
        returns (int256)
    {
        if (existingSize == 0 || closeSize == 0) {
            return 0;
        }

        if (existingSize > 0) {
            return (int256(execPrice) - int256(entryPrice)) * int256(closeSize) / int256(ONE);
        }

        return (int256(entryPrice) - int256(execPrice)) * int256(closeSize) / int256(ONE);
    }

    function _removeOpenInterest(MarketState storage market, int256 size) internal {
        if (size > 0) {
            market.totalLongOI -= uint256(size);
        } else if (size < 0) {
            market.totalShortOI -= uint256(-size);
        }
    }

    function _addOpenInterest(MarketState storage market, int256 size) internal {
        if (size > 0) {
            market.totalLongOI += uint256(size);
        } else if (size < 0) {
            market.totalShortOI += uint256(-size);
        }
    }

    function _increasePosition(Position storage pos, int256 oldSize, uint256 oldEntryPrice, int256 sizeDelta, uint256 execPrice)
        internal
    {
        uint256 oldAbs = _abs(oldSize);
        uint256 addAbs = _abs(sizeDelta);
        uint256 newAbs = oldAbs + addAbs;

        pos.size = oldSize + sizeDelta;
        pos.entryPrice = ((oldEntryPrice * oldAbs) + (execPrice * addAbs)) / newAbs;
    }

    // slither-disable-next-line timestamp
    function _reduceOrFlipPosition(
        Position storage pos,
        int256 oldSize,
        uint256 oldEntryPrice,
        int256 sizeDelta,
        uint256 execPrice
    ) internal {
        uint256 oldAbs = _abs(oldSize);
        uint256 deltaAbs = _abs(sizeDelta);
        uint256 closeSize = oldAbs < deltaAbs ? oldAbs : deltaAbs;
        int256 pnl = _realizePnl(oldSize, oldEntryPrice, execPrice, closeSize);

        if (pnl > 0) {
            pos.margin += uint256(pnl);
        } else {
            uint256 loss = uint256(-pnl);
            require(pos.margin >= loss, "Liquidatable due to PNL");
            pos.margin -= loss;
        }

        pos.size = oldSize + sizeDelta;
        if (pos.size == 0) {
            pos.entryPrice = 0;
        } else if ((oldSize > 0 && pos.size > 0) || (oldSize < 0 && pos.size < 0)) {
            pos.entryPrice = oldEntryPrice;
        } else {
            pos.entryPrice = execPrice;
        }
    }

    function _applySizeDelta(Position storage pos, int256 oldSize, uint256 oldEntryPrice, int256 sizeDelta, uint256 execPrice)
        internal
    {
        if (sizeDelta == 0) {
            return;
        }

        if (oldSize == 0) {
            pos.size = sizeDelta;
            pos.entryPrice = execPrice;
            return;
        }

        if ((oldSize > 0 && sizeDelta > 0) || (oldSize < 0 && sizeDelta < 0)) {
            _increasePosition(pos, oldSize, oldEntryPrice, sizeDelta, execPrice);
            return;
        }

        _reduceOrFlipPosition(pos, oldSize, oldEntryPrice, sizeDelta, execPrice);
    }

    function _applyMarginDelta(Position storage pos, int256 marginDelta, address trader) internal {
        if (marginDelta < 0) {
            uint256 withdrawAmount = uint256(-marginDelta);
            require(pos.margin >= withdrawAmount, "Insufficient margin");
            pos.margin -= withdrawAmount;
            marginToken.safeTransfer(trader, withdrawAmount);
        } else if (marginDelta > 0) {
            pos.margin += uint256(marginDelta);
        }
    }

    // slither-disable-next-line timestamp
    function _assertLeverage(bytes32 agentId, int256 size, uint256 margin) internal view {
        if (size == 0) {
            return;
        }

        require(margin > 0, "Position undercollateralized");
        uint256 absSize = _abs(size);
        uint256 markPrice = getExecutionPrice(agentId, 0);
        require(Math.mulDiv(absSize, markPrice, margin) <= MAX_LEVERAGE, "Max leverage exceeded");
    }

    /**
     * @notice Open or modify a position
     * @param agentId The underlying asset (Agent ID)
     * @param marginDelta >0 deposits margin, <0 withdraws
     * @param sizeDelta + for Long, - for Short
     */
    function modifyPosition(bytes32 agentId, int256 marginDelta, int256 sizeDelta) external {
        _updateFunding(agentId);

        if (marginDelta > 0) {
            marginToken.safeTransferFrom(msg.sender, address(this), uint256(marginDelta));
        }

        uint256 execPrice = getExecutionPrice(agentId, sizeDelta);
        Position storage pos = positions[agentId][msg.sender];
        MarketState storage market = markets[agentId];
        int256 oldSize = pos.size;
        uint256 oldEntryPrice = pos.entryPrice;

        // Realize funding (skipped complex per-position accumulator for simulation simplicity)
        _removeOpenInterest(market, oldSize);
        _applySizeDelta(pos, oldSize, oldEntryPrice, sizeDelta, execPrice);
        _applyMarginDelta(pos, marginDelta, msg.sender);
        _addOpenInterest(market, pos.size);

        _assertLeverage(agentId, pos.size, pos.margin);

        emit PositionOpened(agentId, msg.sender, sizeDelta, execPrice, pos.size, pos.margin);
    }

    // slither-disable-next-line timestamp
    function liquidate(bytes32 agentId, address trader) external {
        _updateFunding(agentId);

        Position storage pos = positions[agentId][trader];
        require(pos.size != 0, "No position");

        MarketState storage market = markets[agentId];
        uint256 execPrice = getExecutionPrice(agentId, pos.size > 0 ? -pos.size : pos.size);
        int256 pnl = _realizePnl(pos.size, pos.entryPrice, execPrice, _abs(pos.size));
        int256 equity = int256(pos.margin) + pnl;
        int256 maintenanceMargin = int256(pos.margin) / 10;

        require(equity < maintenanceMargin, "Not liquidatable");

        _removeOpenInterest(market, pos.size);

        uint256 seizedMargin = pos.margin;
        pos.size = 0;
        pos.margin = 0;
        pos.entryPrice = 0;

        uint256 liquidatorBonus = seizedMargin / 100;
        insuranceFund += seizedMargin - liquidatorBonus;
        marginToken.safeTransfer(msg.sender, liquidatorBonus);

        emit PositionLiquidated(agentId, trader, 0, execPrice);
    }

    function withdrawInsuranceFund(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(insuranceFund >= amount, "Insufficient insurance fund");
        insuranceFund -= amount;
        marginToken.safeTransfer(to, amount);
        emit InsuranceFundWithdrawn(to, amount);
    }
}
