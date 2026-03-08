// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./SkillOracle.sol";

/**
 * @title AgentPerpEngineNative
 * @notice Perpetual futures engine using NATIVE chain currency (ETH on Base, BNB on BSC)
 *         as the margin/collateral token instead of an ERC-20.
 *
 *         Margin is held as ETH/BNB in this contract. All P&L and settlements are sent
 *         as native value via `call{value: ...}`. This makes it chain-agnostic for any
 *         EVM network that uses its native coin as the primary medium of exchange.
 *
 * @dev Decimal convention: all sizes/margins use 18 decimals (1 ETH = 1e18 wei / 1 BNB = 1e18 wei).
 *      Index prices from the oracle are also expected to be 18-decimal fixed-point.
 */
contract AgentPerpEngineNative is Ownable, ReentrancyGuard {
    using Math for uint256;

    SkillOracle public immutable oracle;

    struct MarketState {
        uint256 totalLongOI; // sum of all long position sizes (18 dec)
        uint256 totalShortOI; // sum of all short position sizes
        int256 currentFundingRate; // rate per second (scaled by 1e18)
        uint256 lastUpdateTimestamp;
    }

    struct Position {
        int256 size; // positive = Long, negative = Short (18 dec)
        uint256 margin; // native wei held for this position
        uint256 entryPrice; // skew-adjusted entry price (18 dec)
        int256 lastFundingRate;
    }

    mapping(bytes32 => MarketState) public markets;
    mapping(bytes32 => mapping(address => Position)) public positions;

    uint256 public skewScale; // e.g. 1e6 * 1e18 = 1e24
    uint256 public fundingVelocity; // per-second drift scale

    uint256 public constant ONE = 1e18;
    uint256 public maxLeverage = 5 * ONE; // 5x

    // Insurance fund (native) – seized from liquidated positions
    uint256 public insuranceFund;

    event PositionOpened(
        bytes32 indexed agentId,
        address indexed trader,
        int256 sizeDelta,
        uint256 execPrice,
        int256 newSize,
        uint256 margin
    );
    event PositionClosed(bytes32 indexed agentId, address indexed trader, int256 size, uint256 execPrice, int256 pnl);
    event PositionLiquidated(bytes32 indexed agentId, address indexed trader, int256 size, uint256 liquidationPrice);
    event MarginWithdrawn(bytes32 indexed agentId, address indexed trader, uint256 amount);
    event InsuranceFundWithdrawn(address indexed to, uint256 amount);
    event SkewScaleUpdated(uint256 newSkewScale);
    event FundingVelocityUpdated(uint256 newFundingVelocity);
    event MaxLeverageUpdated(uint256 newMaxLeverage);

    constructor(SkillOracle _oracle, uint256 _skewScale) Ownable(msg.sender) {
        require(address(_oracle) != address(0), "Invalid oracle");
        require(_skewScale > 0, "Invalid skew scale");
        oracle = _oracle;
        skewScale = _skewScale;
        fundingVelocity = 1e12; // Modest drift per second
    }

    receive() external payable {}

    // ─────────────────────────────────────────── Internal helpers ──

    // slither-disable-next-line timestamp
    function _updateFunding(bytes32 agentId) internal {
        MarketState storage market = markets[agentId];
        uint256 timeDelta = block.timestamp - market.lastUpdateTimestamp;
        if (timeDelta != 0) {
            int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
            market.currentFundingRate += (skew * int256(fundingVelocity) * int256(timeDelta)) / int256(skewScale);
            market.lastUpdateTimestamp = block.timestamp;
        }
    }

    // slither-disable-next-line timestamp
    function _getExecutionPrice(bytes32 agentId, int256 sizeDelta) internal view returns (uint256) {
        uint256 indexPrice = oracle.getIndexPrice(agentId);
        MarketState memory market = markets[agentId];

        int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
        // premium = (skew + sizeDelta/2) / skewScale, scaled by ONE
        int256 premium = ((skew + sizeDelta / 2) * int256(ONE)) / int256(skewScale);

        uint256 execPrice;
        if (premium >= 0) {
            execPrice = indexPrice + (indexPrice * uint256(premium)) / ONE;
        } else {
            uint256 absPremium = uint256(-premium);
            if (absPremium >= ONE) {
                execPrice = indexPrice / 10; // Floor at 10%
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
    ) internal returns (int256 realizedPnl) {
        uint256 oldAbs = _abs(oldSize);
        uint256 deltaAbs = _abs(sizeDelta);
        uint256 closeSize = oldAbs < deltaAbs ? oldAbs : deltaAbs;
        realizedPnl = _realizePnl(oldSize, oldEntryPrice, execPrice, closeSize);

        if (realizedPnl > 0) {
            pos.margin += uint256(realizedPnl);
        } else {
            uint256 loss = uint256(-realizedPnl);
            require(pos.margin >= loss, "Underwater: margin < loss");
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
        returns (int256 realizedPnl)
    {
        if (sizeDelta == 0) {
            return 0;
        }

        if (oldSize == 0) {
            pos.size = sizeDelta;
            pos.entryPrice = execPrice;
            return 0;
        }

        if ((oldSize > 0 && sizeDelta > 0) || (oldSize < 0 && sizeDelta < 0)) {
            _increasePosition(pos, oldSize, oldEntryPrice, sizeDelta, execPrice);
            return 0;
        }

        return _reduceOrFlipPosition(pos, oldSize, oldEntryPrice, sizeDelta, execPrice);
    }

    // slither-disable-next-line timestamp
    function _assertLeverage(bytes32 agentId, int256 size, uint256 margin) internal view {
        if (size == 0) {
            return;
        }

        require(margin > 0, "Position undercollateralized");
        uint256 absSize = size > 0 ? uint256(size) : uint256(-size);
        uint256 execPrice = _getExecutionPrice(agentId, 0);
        require(Math.mulDiv(absSize, execPrice, margin) <= maxLeverage, "Max leverage exceeded");
    }

    // ─────────────────────────────────────────── Public interface ──

    /**
     * @notice Open or modify a position using native ETH/BNB as margin.
     * @param agentId  keccak256 agent identifier (matches SkillOracle key)
     * @param sizeDelta Positive = more long, Negative = more short (18-dec)
     *
     * Callers MUST send ETH/BNB with this call if they want to deposit margin.
     * If sizeDelta reduces/closes a position, the released margin is refunded.
     */
    function modifyPosition(bytes32 agentId, int256 sizeDelta) external payable nonReentrant {
        _updateFunding(agentId);

        uint256 marginDeposited = msg.value; // native coin deposited this call

        uint256 execPrice = _getExecutionPrice(agentId, sizeDelta);
        Position storage pos = positions[agentId][msg.sender];
        MarketState storage market = markets[agentId];
        int256 oldSize = pos.size;
        uint256 oldEntryPrice = pos.entryPrice;

        // ─── Reduce OI for existing position ───
        _removeOpenInterest(market, oldSize);

        // ─── Apply size change with correct partial-close accounting ───
        int256 realizedPnl = _applySizeDelta(pos, oldSize, oldEntryPrice, sizeDelta, execPrice);

        pos.margin += marginDeposited;

        // ─── Update OI ───
        _addOpenInterest(market, pos.size);

        // ─── Leverage check ───
        _assertLeverage(agentId, pos.size, pos.margin);

        // ─── Full close: refund remaining margin ───
        if (pos.size == 0 && pos.margin > 0) {
            uint256 payout = pos.margin;
            pos.margin = 0;
            emit PositionClosed(agentId, msg.sender, oldSize, execPrice, realizedPnl);
            _sendNative(payable(msg.sender), payout);
        } else {
            emit PositionOpened(agentId, msg.sender, sizeDelta, execPrice, pos.size, pos.margin);
        }
    }

    /**
     * @notice Withdraw margin from an open position (partial deleverage / margin withdrawal).
     */
    function withdrawMargin(bytes32 agentId, uint256 amount) external nonReentrant {
        Position storage pos = positions[agentId][msg.sender];
        require(pos.margin >= amount, "Insufficient margin");
        uint256 remainingMargin = pos.margin - amount;
        _assertLeverage(agentId, pos.size, remainingMargin);
        pos.margin = remainingMargin;
        emit MarginWithdrawn(agentId, msg.sender, amount);
        _sendNative(payable(msg.sender), amount);
    }

    /**
     * @notice Liquidate an undercollateralized position.
     *         Liquidators receive a 1% incentive from the seized margin.
     */
    // slither-disable-next-line timestamp
    function liquidate(bytes32 agentId, address trader) external nonReentrant {
        _updateFunding(agentId);

        Position storage pos = positions[agentId][trader];
        require(pos.size != 0, "No position");
        int256 liquidatedSize = pos.size;

        MarketState storage market = markets[agentId];

        uint256 execPrice = _getExecutionPrice(agentId, pos.size > 0 ? -pos.size : pos.size);

        int256 pnl;
        if (pos.size > 0) {
            pnl = (int256(execPrice) - int256(pos.entryPrice)) * pos.size / int256(ONE);
        } else {
            pnl = (int256(pos.entryPrice) - int256(execPrice)) * (-pos.size) / int256(ONE);
        }

        int256 equity = int256(pos.margin) + pnl;
        int256 maintenanceMargin = int256(pos.margin) / 10; // 10% of initial margin

        require(equity < maintenanceMargin, "Not liquidatable");

        // Remove OI
        _removeOpenInterest(market, pos.size);

        uint256 seizedMargin = pos.margin;
        pos.size = 0;
        pos.margin = 0;
        pos.entryPrice = 0;

        // 1% to liquidator, rest to insurance fund
        uint256 liquidatorBonus = seizedMargin / 100;
        insuranceFund += seizedMargin - liquidatorBonus;
        emit PositionLiquidated(agentId, trader, liquidatedSize, execPrice);
        _sendNative(payable(msg.sender), liquidatorBonus);
    }

    /**
     * @notice Admin: withdraw from insurance fund to treasury.
     */
    function withdrawInsuranceFund(address payable to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid recipient");
        require(insuranceFund >= amount, "Insufficient insurance fund");
        insuranceFund -= amount;
        emit InsuranceFundWithdrawn(to, amount);
        _sendNative(to, amount);
    }

    function setSkewScale(uint256 newSkewScale) external onlyOwner {
        require(newSkewScale > 0, "Invalid skew scale");
        skewScale = newSkewScale;
        emit SkewScaleUpdated(newSkewScale);
    }

    function setFundingVelocity(uint256 newFundingVelocity) external onlyOwner {
        fundingVelocity = newFundingVelocity;
        emit FundingVelocityUpdated(newFundingVelocity);
    }

    function setMaxLeverage(uint256 newMaxLeverage) external onlyOwner {
        require(newMaxLeverage > 0, "Invalid max leverage");
        maxLeverage = newMaxLeverage;
        emit MaxLeverageUpdated(newMaxLeverage);
    }

    function _sendNative(address payable to, uint256 amount) internal {
        Address.sendValue(to, amount);
    }
}
