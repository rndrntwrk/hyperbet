// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./SkillOracle.sol";

contract AgentPerpEngineNative is Ownable, ReentrancyGuard {
    SkillOracle public immutable oracle;

    error InvalidOracle();
    error InvalidSkewScale();
    error InvalidMaxLeverage();
    error Underwater();
    error Undercollateralized();
    error MaxLeverageExceeded();
    error InsufficientMargin();
    error NoPosition();
    error NotLiquidatable();
    error InvalidRecipient();
    error InsufficientInsuranceFund();

    struct MarketState {
        uint256 totalLongOI;
        uint256 totalShortOI;
        int256 currentFundingRate;
        uint256 lastUpdateTimestamp;
    }

    struct Position {
        int256 size;
        uint256 margin;
        uint256 entryPrice;
    }

    mapping(bytes32 => MarketState) public markets;
    mapping(bytes32 => mapping(address => Position)) public positions;

    uint256 public skewScale;
    uint256 public fundingVelocity;

    uint256 public constant ONE = 1e18;
    uint256 public maxLeverage = 5 * ONE;

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
        if (address(_oracle) == address(0)) revert InvalidOracle();
        if (_skewScale == 0) revert InvalidSkewScale();
        oracle = _oracle;
        skewScale = _skewScale;
        fundingVelocity = 1e12;
    }

    receive() external payable {}

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
        int256 premium = ((skew + sizeDelta / 2) * int256(ONE)) / int256(skewScale);

        if (premium >= 0) {
            return indexPrice + (indexPrice * uint256(premium)) / ONE;
        }

        uint256 absPremium = uint256(-premium);
        if (absPremium >= ONE) {
            return indexPrice / 10;
        }
        return indexPrice - (indexPrice * absPremium) / ONE;
    }

    function _abs(int256 value) internal pure returns (uint256) {
        return value >= 0 ? uint256(value) : uint256(-value);
    }

    function _realizePnl(int256 existingSize, uint256 entryPrice, uint256 execPrice, uint256 closeSize)
        internal
        pure
        returns (int256)
    {
        if (existingSize == 0 || closeSize == 0) return 0;
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
        pos.size = oldSize + sizeDelta;
        pos.entryPrice = ((oldEntryPrice * oldAbs) + (execPrice * addAbs)) / (oldAbs + addAbs);
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
            if (pos.margin < loss) revert Underwater();
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
        if (sizeDelta == 0) return 0;

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
        if (size == 0) return;
        if (margin == 0) revert Undercollateralized();
        uint256 absSize = _abs(size);
        uint256 execPrice = _getExecutionPrice(agentId, 0);
        if (Math.mulDiv(absSize, execPrice, margin) > maxLeverage) revert MaxLeverageExceeded();
    }

    function modifyPosition(bytes32 agentId, int256 sizeDelta) external payable nonReentrant {
        _updateFunding(agentId);

        uint256 execPrice = _getExecutionPrice(agentId, sizeDelta);
        Position storage pos = positions[agentId][msg.sender];
        MarketState storage market = markets[agentId];
        int256 oldSize = pos.size;
        uint256 oldEntryPrice = pos.entryPrice;

        _removeOpenInterest(market, oldSize);
        int256 realizedPnl = _applySizeDelta(pos, oldSize, oldEntryPrice, sizeDelta, execPrice);
        pos.margin += msg.value;
        _addOpenInterest(market, pos.size);
        _assertLeverage(agentId, pos.size, pos.margin);

        if (pos.size == 0 && pos.margin > 0) {
            uint256 payout = pos.margin;
            pos.margin = 0;
            emit PositionClosed(agentId, msg.sender, oldSize, execPrice, realizedPnl);
            Address.sendValue(payable(msg.sender), payout);
        } else {
            emit PositionOpened(agentId, msg.sender, sizeDelta, execPrice, pos.size, pos.margin);
        }
    }

    function withdrawMargin(bytes32 agentId, uint256 amount) external nonReentrant {
        Position storage pos = positions[agentId][msg.sender];
        if (pos.margin < amount) revert InsufficientMargin();
        _assertLeverage(agentId, pos.size, pos.margin - amount);
        pos.margin -= amount;
        emit MarginWithdrawn(agentId, msg.sender, amount);
        Address.sendValue(payable(msg.sender), amount);
    }

    // slither-disable-next-line timestamp
    function liquidate(bytes32 agentId, address trader) external nonReentrant {
        _updateFunding(agentId);

        Position storage pos = positions[agentId][trader];
        if (pos.size == 0) revert NoPosition();
        int256 liquidatedSize = pos.size;

        MarketState storage market = markets[agentId];
        uint256 execPrice = _getExecutionPrice(agentId, -pos.size);
        int256 pnl = _realizePnl(pos.size, pos.entryPrice, execPrice, _abs(pos.size));
        int256 equity = int256(pos.margin) + pnl;

        if (equity >= int256(pos.margin) / 10) revert NotLiquidatable();

        _removeOpenInterest(market, pos.size);

        uint256 seizedMargin = pos.margin;
        pos.size = 0;
        pos.margin = 0;
        pos.entryPrice = 0;

        uint256 liquidatorBonus = seizedMargin / 100;
        insuranceFund += seizedMargin - liquidatorBonus;
        emit PositionLiquidated(agentId, trader, liquidatedSize, execPrice);
        Address.sendValue(payable(msg.sender), liquidatorBonus);
    }

    function withdrawInsuranceFund(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidRecipient();
        if (insuranceFund < amount) revert InsufficientInsuranceFund();
        insuranceFund -= amount;
        emit InsuranceFundWithdrawn(to, amount);
        Address.sendValue(to, amount);
    }

    function setSkewScale(uint256 newSkewScale) external onlyOwner {
        if (newSkewScale == 0) revert InvalidSkewScale();
        skewScale = newSkewScale;
        emit SkewScaleUpdated(newSkewScale);
    }

    function setFundingVelocity(uint256 newFundingVelocity) external onlyOwner {
        fundingVelocity = newFundingVelocity;
        emit FundingVelocityUpdated(newFundingVelocity);
    }

    function setMaxLeverage(uint256 newMaxLeverage) external onlyOwner {
        if (newMaxLeverage == 0) revert InvalidMaxLeverage();
        maxLeverage = newMaxLeverage;
        emit MaxLeverageUpdated(newMaxLeverage);
    }
}
