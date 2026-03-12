// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./SkillOracle.sol";

contract AgentPerpEngine is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant ONE = 1e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant DEFAULT_MAX_LEVERAGE = 5 * ONE;
    uint256 public constant DEFAULT_MAINTENANCE_MARGIN_BPS = 1_000;
    uint256 public constant DEFAULT_LIQUIDATION_REWARD_BPS = 500;
    uint256 public constant DEFAULT_MAX_ORACLE_DELAY = 2 minutes;

    SkillOracle public immutable oracle;
    IERC20 public immutable marginToken;

    enum MarketStatus {
        UNINITIALIZED,
        ACTIVE,
        CLOSE_ONLY,
        ARCHIVED
    }

    struct MarketConfig {
        uint256 skewScale;
        uint256 maxLeverage;
        uint256 maintenanceMarginBps;
        uint256 liquidationRewardBps;
        uint256 maxOracleDelay;
        bool exists;
    }

    struct MarketState {
        uint256 totalLongOI;
        uint256 totalShortOI;
        int256 currentFundingRate;
        int256 cumulativeFundingRate;
        uint256 lastFundingTimestamp;
        uint256 lastOraclePrice;
        int256 lastConservativeSkill;
        uint256 lastOracleTimestamp;
        uint256 vaultBalance;
        uint256 insuranceFund;
        uint256 badDebt;
        MarketStatus status;
    }

    struct Position {
        int256 size;
        uint256 margin;
        uint256 entryPrice;
        int256 lastCumulativeFundingRate;
    }

    struct PositionHealth {
        uint256 markPrice;
        uint256 notional;
        int256 unrealizedPnl;
        int256 equity;
        uint256 maintenanceMargin;
        bool liquidatable;
    }

    error InvalidOracle();
    error InvalidMarginToken();
    error InvalidSkewScale();
    error InvalidMaxLeverage();
    error InvalidMaintenanceMargin();
    error InvalidLiquidationReward();
    error InvalidOracleDelay();
    error MarketAlreadyExists();
    error MarketNotFound();
    error MarketNotTradable();
    error UnknownOracleAgent();
    error StaleOracle();
    error InvalidSizeDelta();
    error CloseOnlyMode();
    error ArchivedMarket();
    error Underwater();
    error Undercollateralized();
    error MaxLeverageExceeded();
    error InsufficientMargin();
    error NoPosition();
    error NotLiquidatable();
    error InvalidRecipient();
    error InsufficientInsuranceFund();
    error InsufficientMarketLiquidity();

    mapping(bytes32 => MarketConfig) public marketConfigs;
    mapping(bytes32 => MarketState) public markets;
    mapping(bytes32 => mapping(address => Position)) public positions;
    bytes32[] public marketIds;

    uint256 public fundingVelocity;
    uint256 public defaultSkewScale;

    event MarketCreated(
        bytes32 indexed agentId,
        uint256 skewScale,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 liquidationRewardBps,
        uint256 maxOracleDelay
    );
    event MarketConfigUpdated(
        bytes32 indexed agentId,
        uint256 skewScale,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 liquidationRewardBps,
        uint256 maxOracleDelay
    );
    event MarketStatusUpdated(bytes32 indexed agentId, MarketStatus indexed status);
    event OracleSynced(
        bytes32 indexed agentId,
        uint256 price,
        int256 conservativeSkill,
        uint256 oracleTimestamp,
        int256 cumulativeFundingRate
    );
    event PositionModified(
        bytes32 indexed agentId,
        address indexed trader,
        int256 sizeDelta,
        int256 newSize,
        uint256 executionPrice,
        int256 marginDelta,
        int256 realizedPnl,
        int256 fundingPayment,
        uint256 marginAfter
    );
    event PositionClosed(
        bytes32 indexed agentId,
        address indexed trader,
        uint256 executionPrice,
        int256 realizedPnl,
        int256 fundingPayment,
        uint256 payout
    );
    event MarginWithdrawn(bytes32 indexed agentId, address indexed trader, uint256 amount, uint256 marginAfter);
    event PositionLiquidated(
        bytes32 indexed agentId,
        address indexed trader,
        address indexed liquidator,
        uint256 liquidationPrice,
        int256 realizedPnl,
        int256 fundingPayment,
        int256 equity,
        uint256 reward,
        uint256 vaultBalance,
        uint256 insuranceFund,
        uint256 badDebt
    );
    event InsuranceFundDeposited(bytes32 indexed agentId, address indexed from, uint256 amount, uint256 insuranceFund);
    event InsuranceFundWithdrawn(bytes32 indexed agentId, address indexed to, uint256 amount, uint256 insuranceFund);
    event FundingVelocityUpdated(uint256 newFundingVelocity);
    event DefaultSkewScaleUpdated(uint256 newDefaultSkewScale);

    constructor(SkillOracle _oracle, IERC20 _marginToken, uint256 _defaultSkewScale) Ownable(msg.sender) {
        if (address(_oracle) == address(0)) revert InvalidOracle();
        if (address(_marginToken) == address(0)) revert InvalidMarginToken();
        if (_defaultSkewScale == 0) revert InvalidSkewScale();
        oracle = _oracle;
        marginToken = _marginToken;
        defaultSkewScale = _defaultSkewScale;
        fundingVelocity = 1e12;
    }

    function marketCount() external view returns (uint256) {
        return marketIds.length;
    }

    function createMarket(bytes32 agentId) external onlyOwner {
        _createMarket(
            agentId,
            defaultSkewScale,
            DEFAULT_MAX_LEVERAGE,
            DEFAULT_MAINTENANCE_MARGIN_BPS,
            DEFAULT_LIQUIDATION_REWARD_BPS,
            DEFAULT_MAX_ORACLE_DELAY
        );
    }

    function createMarket(
        bytes32 agentId,
        uint256 skewScale,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 liquidationRewardBps,
        uint256 maxOracleDelay
    ) external onlyOwner {
        _createMarket(agentId, skewScale, maxLeverage, maintenanceMarginBps, liquidationRewardBps, maxOracleDelay);
    }

    function updateMarketConfig(
        bytes32 agentId,
        uint256 skewScale,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 liquidationRewardBps,
        uint256 maxOracleDelay
    ) external onlyOwner {
        MarketConfig storage config = marketConfigs[agentId];
        if (!config.exists) revert MarketNotFound();
        _validateConfig(skewScale, maxLeverage, maintenanceMarginBps, liquidationRewardBps, maxOracleDelay);
        config.skewScale = skewScale;
        config.maxLeverage = maxLeverage;
        config.maintenanceMarginBps = maintenanceMarginBps;
        config.liquidationRewardBps = liquidationRewardBps;
        config.maxOracleDelay = maxOracleDelay;
        emit MarketConfigUpdated(agentId, skewScale, maxLeverage, maintenanceMarginBps, liquidationRewardBps, maxOracleDelay);
    }

    function setMarketStatus(bytes32 agentId, MarketStatus newStatus) external onlyOwner {
        if (!marketConfigs[agentId].exists) revert MarketNotFound();
        if (newStatus == MarketStatus.UNINITIALIZED) revert MarketNotTradable();
        markets[agentId].status = newStatus;
        emit MarketStatusUpdated(agentId, newStatus);
    }

    function syncOracle(bytes32 agentId) external returns (uint256 price) {
        return _syncOracle(agentId);
    }

    function modifyPosition(bytes32 agentId, int256 marginDelta, int256 sizeDelta) external nonReentrant {
        MarketConfig memory config = _requireMarket(agentId);
        MarketState storage market = markets[agentId];
        Position storage position = positions[agentId][msg.sender];

        _syncOracle(agentId);
        int256 fundingPayment = _settleFunding(position, market, false);

        int256 oldSize = position.size;
        uint256 oldEntryPrice = position.entryPrice;

        _assertStatusAllowsTrade(market.status, oldSize, sizeDelta);

        uint256 executionPrice = _getExecutionPrice(market, config, sizeDelta);

        if (marginDelta > 0) {
            marginToken.safeTransferFrom(msg.sender, address(this), uint256(marginDelta));
        }

        _removeOpenInterest(market, oldSize);
        int256 realizedPnl = _applySizeDelta(market, position, oldSize, oldEntryPrice, sizeDelta, executionPrice);
        _applyMarginDelta(position, marginDelta, msg.sender);
        _addOpenInterest(market, position.size);

        if (position.size == 0) {
            uint256 payout = position.margin;
            position.margin = 0;
            position.entryPrice = 0;
            position.lastCumulativeFundingRate = market.cumulativeFundingRate;
            emit PositionClosed(agentId, msg.sender, executionPrice, realizedPnl, fundingPayment, payout);
            if (payout != 0) {
                marginToken.safeTransfer(msg.sender, payout);
            }
            return;
        }

        _assertPositionHealthy(position, _markPrice(market, config), config);
        position.lastCumulativeFundingRate = market.cumulativeFundingRate;

        emit PositionModified(
            agentId,
            msg.sender,
            sizeDelta,
            position.size,
            executionPrice,
            marginDelta,
            realizedPnl,
            fundingPayment,
            position.margin
        );
    }

    function withdrawMargin(bytes32 agentId, uint256 amount) external nonReentrant {
        MarketConfig memory config = _requireMarket(agentId);
        MarketState storage market = markets[agentId];
        Position storage position = positions[agentId][msg.sender];

        _syncOracle(agentId);
        _settleFunding(position, market, false);

        if (position.margin < amount) revert InsufficientMargin();
        position.margin -= amount;

        if (position.size != 0) {
            _assertPositionHealthy(position, _markPrice(market, config), config);
            position.lastCumulativeFundingRate = market.cumulativeFundingRate;
        }

        emit MarginWithdrawn(agentId, msg.sender, amount, position.margin);
        marginToken.safeTransfer(msg.sender, amount);
    }

    function liquidate(bytes32 agentId, address trader) external nonReentrant {
        MarketConfig memory config = _requireMarket(agentId);
        MarketState storage market = markets[agentId];
        Position storage position = positions[agentId][trader];
        if (position.size == 0) revert NoPosition();

        _syncOracle(agentId);
        int256 fundingPayment = _settleFunding(position, market, true);

        uint256 liquidationPrice = _getExecutionPrice(market, config, -position.size);
        int256 realizedPnl = _realizePnl(position.size, position.entryPrice, liquidationPrice, _abs(position.size));
        int256 equity = int256(position.margin) + realizedPnl;
        uint256 maintenanceMargin = _maintenanceMargin(_abs(position.size), liquidationPrice, config.maintenanceMarginBps);

        if (equity > int256(maintenanceMargin)) revert NotLiquidatable();

        uint256 startingMargin = position.margin;
        if (realizedPnl > 0) {
            _creditMarginFromPool(market, position, uint256(realizedPnl));
        } else if (realizedPnl < 0) {
            _collectTraderLoss(market, position, uint256(-realizedPnl), true);
        }

        _removeOpenInterest(market, position.size);

        uint256 reward = Math.mulDiv(startingMargin, config.liquidationRewardBps, BPS);
        uint256 availableForReward = position.margin + market.insuranceFund;
        if (reward > availableForReward) reward = availableForReward;

        uint256 rewardFromMargin = reward > position.margin ? position.margin : reward;
        uint256 rewardFromInsurance = reward - rewardFromMargin;
        position.margin -= rewardFromMargin;
        if (rewardFromInsurance != 0) {
            market.insuranceFund -= rewardFromInsurance;
        }

        uint256 seizedMargin = position.margin;

        position.size = 0;
        position.margin = 0;
        position.entryPrice = 0;
        position.lastCumulativeFundingRate = market.cumulativeFundingRate;

        market.vaultBalance += seizedMargin;

        emit PositionLiquidated(
            agentId,
            trader,
            msg.sender,
            liquidationPrice,
            realizedPnl,
            fundingPayment,
            equity,
            reward,
            market.vaultBalance,
            market.insuranceFund,
            market.badDebt
        );

        if (reward != 0) {
            marginToken.safeTransfer(msg.sender, reward);
        }
    }

    function depositInsuranceFund(bytes32 agentId, uint256 amount) external onlyOwner nonReentrant {
        if (!marketConfigs[agentId].exists) revert MarketNotFound();
        if (amount == 0) return;
        marginToken.safeTransferFrom(msg.sender, address(this), amount);
        MarketState storage market = markets[agentId];
        uint256 remaining = amount;
        if (market.badDebt != 0) {
            uint256 repaidBadDebt = remaining > market.badDebt ? market.badDebt : remaining;
            market.badDebt -= repaidBadDebt;
            market.vaultBalance += repaidBadDebt;
            remaining -= repaidBadDebt;
        }
        if (remaining != 0) {
            market.insuranceFund += remaining;
        }
        emit InsuranceFundDeposited(agentId, msg.sender, amount, market.insuranceFund);
    }

    function withdrawInsuranceFund(bytes32 agentId, address to, uint256 amount) external onlyOwner nonReentrant {
        if (!marketConfigs[agentId].exists) revert MarketNotFound();
        if (to == address(0)) revert InvalidRecipient();
        MarketState storage market = markets[agentId];
        if (market.insuranceFund < amount) revert InsufficientInsuranceFund();
        market.insuranceFund -= amount;
        emit InsuranceFundWithdrawn(agentId, to, amount, market.insuranceFund);
        marginToken.safeTransfer(to, amount);
    }

    function setFundingVelocity(uint256 newFundingVelocity) external onlyOwner {
        fundingVelocity = newFundingVelocity;
        emit FundingVelocityUpdated(newFundingVelocity);
    }

    function setDefaultSkewScale(uint256 newDefaultSkewScale) external onlyOwner {
        if (newDefaultSkewScale == 0) revert InvalidSkewScale();
        defaultSkewScale = newDefaultSkewScale;
        emit DefaultSkewScaleUpdated(newDefaultSkewScale);
    }

    function getExecutionPrice(bytes32 agentId, int256 sizeDelta) external view returns (uint256) {
        MarketConfig memory config = marketConfigs[agentId];
        if (!config.exists) revert MarketNotFound();
        return _getExecutionPrice(markets[agentId], config, sizeDelta);
    }

    function getMarkPrice(bytes32 agentId) external view returns (uint256) {
        MarketConfig memory config = marketConfigs[agentId];
        if (!config.exists) revert MarketNotFound();
        return _markPrice(markets[agentId], config);
    }

    function getPositionHealth(bytes32 agentId, address trader) external view returns (PositionHealth memory) {
        MarketConfig memory config = marketConfigs[agentId];
        if (!config.exists) revert MarketNotFound();
        MarketState memory market = markets[agentId];
        Position memory position = positions[agentId][trader];
        (, int256 previewCumulativeFundingRate) = _previewFundingState(market, config);
        uint256 markPrice = _markPrice(market, config);
        uint256 notional = _notional(position.size, markPrice);
        int256 unrealizedPnl = _realizePnl(position.size, position.entryPrice, markPrice, _abs(position.size));
        int256 fundingPayment = 0;
        if (position.size != 0) {
            fundingPayment =
                (position.size * (previewCumulativeFundingRate - position.lastCumulativeFundingRate)) / int256(ONE);
        }
        int256 equity = int256(position.margin) + unrealizedPnl - fundingPayment;
        uint256 maintenanceMargin = _maintenanceMargin(_abs(position.size), markPrice, config.maintenanceMarginBps);
        return PositionHealth({
            markPrice: markPrice,
            notional: notional,
            unrealizedPnl: unrealizedPnl,
            equity: equity,
            maintenanceMargin: maintenanceMargin,
            liquidatable: position.size != 0 && equity <= int256(maintenanceMargin)
        });
    }

    function _createMarket(
        bytes32 agentId,
        uint256 skewScale,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 liquidationRewardBps,
        uint256 maxOracleDelay
    ) internal {
        if (marketConfigs[agentId].exists) revert MarketAlreadyExists();
        _validateConfig(skewScale, maxLeverage, maintenanceMarginBps, liquidationRewardBps, maxOracleDelay);

        marketConfigs[agentId] = MarketConfig({
            skewScale: skewScale,
            maxLeverage: maxLeverage,
            maintenanceMarginBps: maintenanceMarginBps,
            liquidationRewardBps: liquidationRewardBps,
            maxOracleDelay: maxOracleDelay,
            exists: true
        });

        markets[agentId].status = MarketStatus.ACTIVE;
        marketIds.push(agentId);

        emit MarketCreated(agentId, skewScale, maxLeverage, maintenanceMarginBps, liquidationRewardBps, maxOracleDelay);
        emit MarketStatusUpdated(agentId, MarketStatus.ACTIVE);

        _syncOracle(agentId);
    }

    function _validateConfig(
        uint256 skewScale,
        uint256 maxLeverage,
        uint256 maintenanceMarginBps,
        uint256 liquidationRewardBps,
        uint256 maxOracleDelay
    ) internal pure {
        if (skewScale == 0) revert InvalidSkewScale();
        if (maxLeverage == 0) revert InvalidMaxLeverage();
        if (maintenanceMarginBps == 0 || maintenanceMarginBps >= BPS) revert InvalidMaintenanceMargin();
        if (liquidationRewardBps == 0 || liquidationRewardBps >= BPS) revert InvalidLiquidationReward();
        if (maxOracleDelay == 0) revert InvalidOracleDelay();
    }

    function _requireMarket(bytes32 agentId) internal view returns (MarketConfig memory config) {
        config = marketConfigs[agentId];
        if (!config.exists) revert MarketNotFound();
    }

    function _syncOracle(bytes32 agentId) internal returns (uint256 price) {
        MarketConfig memory config = _requireMarket(agentId);
        MarketState storage market = markets[agentId];

        (uint256 mu, uint256 sigma, uint256 lastUpdate) = oracle.agentSkills(agentId);
        if (lastUpdate == 0) revert UnknownOracleAgent();
        if (block.timestamp - lastUpdate > config.maxOracleDelay) revert StaleOracle();

        _accrueFunding(market, config);

        int256 conservativeSkill = int256(mu) - int256(3 * sigma);
        price = oracle.getIndexPrice(agentId);
        market.lastOraclePrice = price;
        market.lastConservativeSkill = conservativeSkill;
        market.lastOracleTimestamp = lastUpdate;

        emit OracleSynced(agentId, price, conservativeSkill, lastUpdate, market.cumulativeFundingRate);
    }

    function _accrueFunding(MarketState storage market, MarketConfig memory config) internal {
        uint256 lastTimestamp = market.lastFundingTimestamp;
        if (lastTimestamp == 0) {
            market.lastFundingTimestamp = block.timestamp;
            return;
        }

        uint256 timeDelta = block.timestamp - lastTimestamp;
        if (timeDelta == 0) return;

        int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
        int256 skewRatio = (skew * int256(ONE)) / int256(config.skewScale);
        int256 fundingRateDelta = (skewRatio * int256(fundingVelocity) * int256(timeDelta)) / int256(ONE);

        market.currentFundingRate += fundingRateDelta;
        market.cumulativeFundingRate += fundingRateDelta;
        market.lastFundingTimestamp = block.timestamp;
    }

    function _previewFundingState(MarketState memory market, MarketConfig memory config)
        internal
        view
        returns (int256 previewCurrentFundingRate, int256 previewCumulativeFundingRate)
    {
        previewCurrentFundingRate = market.currentFundingRate;
        previewCumulativeFundingRate = market.cumulativeFundingRate;

        uint256 lastTimestamp = market.lastFundingTimestamp;
        if (lastTimestamp == 0 || block.timestamp <= lastTimestamp) {
            return (previewCurrentFundingRate, previewCumulativeFundingRate);
        }

        uint256 timeDelta = block.timestamp - lastTimestamp;
        int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
        int256 skewRatio = (skew * int256(ONE)) / int256(config.skewScale);
        int256 fundingRateDelta = (skewRatio * int256(fundingVelocity) * int256(timeDelta)) / int256(ONE);

        previewCurrentFundingRate += fundingRateDelta;
        previewCumulativeFundingRate += fundingRateDelta;
    }

    function _settleFunding(Position storage position, MarketState storage market, bool useInsuranceBackstop)
        internal
        returns (int256 fundingPayment)
    {
        if (position.size == 0) {
            position.lastCumulativeFundingRate = market.cumulativeFundingRate;
            return 0;
        }

        int256 rateDelta = market.cumulativeFundingRate - position.lastCumulativeFundingRate;
        if (rateDelta == 0) return 0;

        fundingPayment = (position.size * rateDelta) / int256(ONE);
        if (fundingPayment > 0) {
            _collectTraderLoss(market, position, uint256(fundingPayment), useInsuranceBackstop);
        } else {
            _creditMarginFromPool(market, position, uint256(-fundingPayment));
        }

        position.lastCumulativeFundingRate = market.cumulativeFundingRate;
    }

    function _applySizeDelta(
        MarketState storage market,
        Position storage position,
        int256 oldSize,
        uint256 oldEntryPrice,
        int256 sizeDelta,
        uint256 executionPrice
    ) internal returns (int256 realizedPnl) {
        if (sizeDelta == 0) return 0;

        if (oldSize == 0) {
            position.size = sizeDelta;
            position.entryPrice = executionPrice;
            return 0;
        }

        if ((oldSize > 0 && sizeDelta > 0) || (oldSize < 0 && sizeDelta < 0)) {
            uint256 existingAbs = _abs(oldSize);
            uint256 addAbs = _abs(sizeDelta);
            position.size = oldSize + sizeDelta;
            position.entryPrice = ((oldEntryPrice * existingAbs) + (executionPrice * addAbs)) / (existingAbs + addAbs);
            return 0;
        }

        uint256 oldAbs = _abs(oldSize);
        uint256 deltaAbs = _abs(sizeDelta);
        uint256 closeSize = oldAbs < deltaAbs ? oldAbs : deltaAbs;
        realizedPnl = _realizePnl(oldSize, oldEntryPrice, executionPrice, closeSize);

        if (realizedPnl > 0) {
            _creditMarginFromPool(market, position, uint256(realizedPnl));
        } else if (realizedPnl < 0) {
            _collectTraderLoss(market, position, uint256(-realizedPnl), false);
        }

        position.size = oldSize + sizeDelta;
        if (position.size == 0) {
            position.entryPrice = 0;
        } else if ((oldSize > 0 && position.size > 0) || (oldSize < 0 && position.size < 0)) {
            position.entryPrice = oldEntryPrice;
        } else {
            position.entryPrice = executionPrice;
        }
    }

    function _applyMarginDelta(Position storage position, int256 marginDelta, address trader) internal {
        if (marginDelta < 0) {
            uint256 withdrawAmount = uint256(-marginDelta);
            if (position.margin < withdrawAmount) revert InsufficientMargin();
            position.margin -= withdrawAmount;
            marginToken.safeTransfer(trader, withdrawAmount);
        } else if (marginDelta > 0) {
            position.margin += uint256(marginDelta);
        }
    }

    function _debitMargin(Position storage position, uint256 amount) internal {
        if (amount == 0) return;
        if (amount > position.margin) revert Underwater();
        position.margin -= amount;
    }

    function _creditMarginFromPool(MarketState storage market, Position storage position, uint256 profit) internal {
        if (profit == 0) return;
        uint256 fromVault = profit > market.vaultBalance ? market.vaultBalance : profit;
        uint256 remaining = profit - fromVault;
        if (remaining > market.insuranceFund) revert InsufficientMarketLiquidity();

        market.vaultBalance -= fromVault;
        if (remaining != 0) {
            market.insuranceFund -= remaining;
        }
        position.margin += profit;
    }

    function _collectTraderLoss(
        MarketState storage market,
        Position storage position,
        uint256 amount,
        bool allowBadDebt
    ) internal {
        if (amount == 0) return;
        if (!allowBadDebt && amount > position.margin) revert Underwater();

        uint256 fromMargin = amount > position.margin ? position.margin : amount;
        if (fromMargin != 0) {
            position.margin -= fromMargin;
            market.vaultBalance += fromMargin;
        }

        uint256 deficit = amount - fromMargin;
        if (deficit == 0) return;
        if (!allowBadDebt) revert Underwater();

        uint256 fromInsurance = deficit > market.insuranceFund ? market.insuranceFund : deficit;
        if (fromInsurance != 0) {
            market.insuranceFund -= fromInsurance;
            market.vaultBalance += fromInsurance;
        }

        uint256 residualBadDebt = deficit - fromInsurance;
        if (residualBadDebt != 0) {
            market.badDebt += residualBadDebt;
        }
    }

    function _assertPositionHealthy(Position memory position, uint256 markPrice, MarketConfig memory config) internal pure {
        if (position.size == 0) return;
        if (position.margin == 0) revert Undercollateralized();

        uint256 notional = _notional(position.size, markPrice);
        int256 unrealizedPnl = _realizePnl(position.size, position.entryPrice, markPrice, _abs(position.size));
        int256 equity = int256(position.margin) + unrealizedPnl;
        if (equity <= 0) revert Underwater();

        if (Math.mulDiv(notional, ONE, uint256(equity)) > config.maxLeverage) {
            revert MaxLeverageExceeded();
        }
    }

    function _assertStatusAllowsTrade(MarketStatus status, int256 oldSize, int256 sizeDelta) internal pure {
        if (sizeDelta == 0) return;
        if (status == MarketStatus.ACTIVE) return;
        if (status == MarketStatus.UNINITIALIZED) revert MarketNotFound();
        if (status == MarketStatus.ARCHIVED) revert ArchivedMarket();

        if (oldSize == 0) revert CloseOnlyMode();

        int256 newSize = oldSize + sizeDelta;
        if (newSize == 0) return;
        if ((oldSize > 0 && newSize > 0 && newSize < oldSize) || (oldSize < 0 && newSize < 0 && newSize > oldSize)) {
            return;
        }
        revert CloseOnlyMode();
    }

    function _maintenanceMargin(uint256 absSize, uint256 price, uint256 maintenanceMarginBps) internal pure returns (uint256) {
        return Math.mulDiv(Math.mulDiv(absSize, price, ONE), maintenanceMarginBps, BPS);
    }

    function _markPrice(MarketState memory market, MarketConfig memory config) internal pure returns (uint256) {
        return _getExecutionPrice(market, config, 0);
    }

    function _getExecutionPrice(MarketState memory market, MarketConfig memory config, int256 sizeDelta)
        internal
        pure
        returns (uint256)
    {
        uint256 indexPrice = market.lastOraclePrice;
        if (indexPrice == 0) revert StaleOracle();

        int256 skew = int256(market.totalLongOI) - int256(market.totalShortOI);
        int256 premium = ((skew + sizeDelta / 2) * int256(ONE)) / int256(config.skewScale);

        if (premium >= 0) {
            return indexPrice + Math.mulDiv(indexPrice, uint256(premium), ONE);
        }

        uint256 absPremium = uint256(-premium);
        if (absPremium >= ONE) {
            return indexPrice / 10;
        }
        return indexPrice - Math.mulDiv(indexPrice, absPremium, ONE);
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

    function _realizePnl(int256 existingSize, uint256 entryPrice, uint256 executionPrice, uint256 closeSize)
        internal
        pure
        returns (int256)
    {
        if (existingSize == 0 || closeSize == 0 || entryPrice == 0) return 0;
        if (existingSize > 0) {
            return (int256(executionPrice) - int256(entryPrice)) * int256(closeSize) / int256(ONE);
        }
        return (int256(entryPrice) - int256(executionPrice)) * int256(closeSize) / int256(ONE);
    }

    function _notional(int256 size, uint256 price) internal pure returns (uint256) {
        if (size == 0 || price == 0) return 0;
        return Math.mulDiv(_abs(size), price, ONE);
    }

    function _abs(int256 value) internal pure returns (uint256) {
        return value >= 0 ? uint256(value) : uint256(-value);
    }
}
