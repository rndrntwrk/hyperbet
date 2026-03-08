// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./DuelOutcomeOracle.sol";

contract GoldClob is AccessControl, ReentrancyGuard {
    using Address for address payable;

    bytes32 public constant MARKET_OPERATOR_ROLE = keccak256("MARKET_OPERATOR_ROLE");

    uint8 public constant MARKET_KIND_DUEL_WINNER = 0;
    uint8 private constant BUY_SIDE = 1;
    uint8 private constant SELL_SIDE = 2;
    uint256 public constant MAX_FEE_BPS = 10_000;

    DuelOutcomeOracle public duelOracle;
    address public treasury;
    address public marketMaker;
    uint256 public tradeTreasuryFeeBps;
    uint256 public tradeMarketMakerFeeBps;
    uint256 public winningsMarketMakerFeeBps;

    enum MarketStatus {
        NULL,
        OPEN,
        LOCKED,
        RESOLVED,
        CANCELLED
    }

    enum Side {
        NONE,
        A,
        B
    }

    struct Market {
        bool exists;
        bytes32 duelKey;
        uint8 marketKind;
        MarketStatus status;
        Side winner;
        uint64 nextOrderId;
        uint16 bestBid;
        uint16 bestAsk;
        uint128 totalAShares;
        uint128 totalBShares;
    }

    struct Order {
        uint64 id;
        uint8 side;
        uint16 price;
        address maker;
        uint128 amount;
        uint128 filled;
        uint64 prevOrderId;
        uint64 nextOrderId;
        bool active;
    }

    struct Position {
        uint128 aShares;
        uint128 bShares;
        uint128 aStake;
        uint128 bStake;
    }

    struct PriceLevel {
        uint64 headOrderId;
        uint64 tailOrderId;
        uint128 totalOpen;
    }

    struct OrderQuote {
        uint256 cost;
        uint256 tradeTreasuryFee;
        uint256 tradeMarketMakerFee;
        uint256 totalRequired;
        uint256 excess;
    }

    struct MatchProgress {
        uint256 remainingAmount;
        uint16 boundaryPrice;
        uint256 matchesCount;
        uint256 totalImprovement;
    }

    mapping(bytes32 => Market) private markets;
    mapping(bytes32 => mapping(address => Position)) public positions;
    mapping(bytes32 => mapping(uint64 => Order)) public orders;
    mapping(bytes32 => mapping(uint8 => mapping(uint16 => PriceLevel))) private priceLevels;

    event MarketCreated(bytes32 indexed duelKey, bytes32 indexed marketKey, uint8 marketKind);
    event MarketSynced(bytes32 indexed duelKey, bytes32 indexed marketKey, MarketStatus status, Side winner);
    event OrderPlaced(
        bytes32 indexed marketKey,
        uint64 indexed orderId,
        address indexed maker,
        uint8 side,
        uint16 price,
        uint256 amount
    );
    event OrderMatched(
        bytes32 indexed marketKey,
        uint64 makerOrderId,
        uint64 takerOrderId,
        uint256 matchedAmount,
        uint16 price
    );
    event OrderCancelled(bytes32 indexed marketKey, uint64 indexed orderId);
    event FeeConfigUpdated(
        uint256 tradeTreasuryFeeBps,
        uint256 tradeMarketMakerFeeBps,
        uint256 winningsMarketMakerFeeBps
    );
    event TreasuryUpdated(address treasury);
    event MarketMakerUpdated(address marketMaker);
    event OracleUpdated(address oracle);

    constructor(
        address admin,
        address marketOperator,
        address oracle,
        address treasury_,
        address marketMaker_
    ) {
        require(admin != address(0), "invalid admin");
        require(marketOperator != address(0), "invalid operator");
        require(oracle != address(0), "invalid oracle");
        require(treasury_ != address(0), "invalid treasury");
        require(marketMaker_ != address(0), "invalid market maker");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MARKET_OPERATOR_ROLE, marketOperator);

        duelOracle = DuelOutcomeOracle(oracle);
        treasury = treasury_;
        marketMaker = marketMaker_;
        _setFeeConfig(100, 100, 200);
    }

    function marketKey(bytes32 duelKey, uint8 marketKind) public pure returns (bytes32) {
        return keccak256(abi.encode(duelKey, marketKind));
    }

    function getMarket(bytes32 duelKey, uint8 marketKind) external view returns (Market memory) {
        return markets[marketKey(duelKey, marketKind)];
    }

    function getPriceLevel(
        bytes32 duelKey,
        uint8 marketKind,
        uint8 side,
        uint16 price
    ) external view returns (uint64 headOrderId, uint64 tailOrderId, uint128 totalOpen) {
        PriceLevel storage level = priceLevels[marketKey(duelKey, marketKind)][side][price];
        return (level.headOrderId, level.tailOrderId, level.totalOpen);
    }

    function orderQueues(
        bytes32 duelKey,
        uint8 marketKind,
        uint8 side,
        uint16 price
    ) external view returns (uint64 headOrderId, uint64 tailOrderId, uint128 totalOpen) {
        PriceLevel storage level = priceLevels[marketKey(duelKey, marketKind)][side][price];
        return (level.headOrderId, level.tailOrderId, level.totalOpen);
    }

    function setOracle(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(oracle != address(0), "invalid oracle");
        duelOracle = DuelOutcomeOracle(oracle);
        emit OracleUpdated(oracle);
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(treasury_ != address(0), "invalid treasury");
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setMarketMaker(address marketMaker_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(marketMaker_ != address(0), "invalid market maker");
        marketMaker = marketMaker_;
        emit MarketMakerUpdated(marketMaker_);
    }

    function setFeeConfig(
        uint256 tradeTreasuryFeeBps_,
        uint256 tradeMarketMakerFeeBps_,
        uint256 winningsMarketMakerFeeBps_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setFeeConfig(
            tradeTreasuryFeeBps_,
            tradeMarketMakerFeeBps_,
            winningsMarketMakerFeeBps_
        );
    }

    function feeBps() external view returns (uint256) {
        return tradeTreasuryFeeBps + tradeMarketMakerFeeBps;
    }

    function createMarketForDuel(bytes32 duelKey, uint8 marketKind)
        external
        onlyRole(MARKET_OPERATOR_ROLE)
        returns (bytes32 key)
    {
        require(marketKind == MARKET_KIND_DUEL_WINNER, "invalid market kind");
        key = marketKey(duelKey, marketKind);
        Market storage market = markets[key];
        require(!market.exists, "market exists");

        DuelOutcomeOracle.DuelState memory duel = duelOracle.getDuel(duelKey);
        require(
            duel.status == DuelOutcomeOracle.DuelStatus.BETTING_OPEN
                || duel.status == DuelOutcomeOracle.DuelStatus.LOCKED,
            "duel not marketable"
        );

        market.exists = true;
        market.duelKey = duelKey;
        market.marketKind = marketKind;
        market.status = _mapDuelStatus(duel.status);
        market.winner = Side.NONE;
        market.nextOrderId = 1;
        market.bestBid = 0;
        market.bestAsk = 1000;

        emit MarketCreated(duelKey, key, marketKind);
    }

    function syncMarketFromOracle(bytes32 duelKey, uint8 marketKind) public returns (MarketStatus) {
        bytes32 key = marketKey(duelKey, marketKind);
        Market storage market = markets[key];
        require(market.exists, "market missing");

        DuelOutcomeOracle.DuelState memory duel = duelOracle.getDuel(duelKey);
        market.status = _mapDuelStatus(duel.status);
        if (duel.status == DuelOutcomeOracle.DuelStatus.RESOLVED) {
            market.winner = _mapWinner(duel.winner);
        } else if (duel.status == DuelOutcomeOracle.DuelStatus.CANCELLED) {
            market.winner = Side.NONE;
        }

        emit MarketSynced(duelKey, key, market.status, market.winner);
        return market.status;
    }

    function placeOrder(
        bytes32 duelKey,
        uint8 marketKind,
        uint8 side,
        uint16 price,
        uint128 amount
    ) external payable nonReentrant {
        require(side == BUY_SIDE || side == SELL_SIDE, "invalid side");
        require(price > 0 && price < 1000, "invalid price");
        require(amount > 0, "invalid amount");

        bytes32 key = marketKey(duelKey, marketKind);
        Market storage market = markets[key];
        require(market.exists, "market missing");
        require(syncMarketFromOracle(duelKey, marketKind) == MarketStatus.OPEN, "market not open");

        DuelOutcomeOracle.DuelState memory duel = duelOracle.getDuel(duelKey);
        require(block.timestamp < duel.betCloseTs, "betting closed");

        uint64 takerOrderId = market.nextOrderId;
        market.nextOrderId += 1;

        OrderQuote memory quote = _quoteOrder(side, price, amount, msg.value);
        MatchProgress memory progress = side == BUY_SIDE
            ? _matchBuyOrder(key, market, price, amount, takerOrderId)
            : _matchSellOrder(key, market, price, amount, takerOrderId);

        if (progress.remainingAmount > 0) {
            _restOrder(key, market, side, price, uint128(progress.remainingAmount), takerOrderId);
        } else {
            orders[key][takerOrderId] = Order({
                id: takerOrderId,
                side: side,
                price: price,
                maker: msg.sender,
                amount: amount,
                filled: amount,
                prevOrderId: 0,
                nextOrderId: 0,
                active: false
            });
        }

        _settleOrderValue(quote, progress.totalImprovement);
    }

    function cancelOrder(bytes32 duelKey, uint8 marketKind, uint64 orderId) external nonReentrant {
        bytes32 key = marketKey(duelKey, marketKind);
        Market storage market = markets[key];
        require(market.exists, "market missing");
        require(syncMarketFromOracle(duelKey, marketKind) == MarketStatus.OPEN, "market not open");

        Order storage order = orders[key][orderId];
        require(order.maker == msg.sender, "not maker");
        require(order.active, "order inactive");
        require(order.filled < order.amount, "already filled");

        uint128 remaining = order.amount - order.filled;
        PriceLevel storage level = priceLevels[key][order.side][order.price];

        _unlinkOrder(key, market, level, order, remaining);

        uint256 refund = _quoteCost(order.side, order.price, remaining);
        order.filled = order.amount;
        order.active = false;
        order.prevOrderId = 0;
        order.nextOrderId = 0;

        if (refund > 0) {
            payable(msg.sender).sendValue(refund);
        }

        emit OrderCancelled(key, orderId);
    }

    function claim(bytes32 duelKey, uint8 marketKind) external nonReentrant {
        bytes32 key = marketKey(duelKey, marketKind);
        Market storage market = markets[key];
        require(market.exists, "market missing");

        MarketStatus status = syncMarketFromOracle(duelKey, marketKind);
        Position storage position = positions[key][msg.sender];

        uint256 payout;
        if (status == MarketStatus.RESOLVED) {
            uint256 winningShares;
            if (market.winner == Side.A) {
                winningShares = position.aShares;
            } else if (market.winner == Side.B) {
                winningShares = position.bShares;
            }
            require(winningShares > 0, "nothing to claim");

            uint256 fee = (winningShares * winningsMarketMakerFeeBps) / MAX_FEE_BPS;
            payout = winningShares - fee;
            position.aShares = 0;
            position.bShares = 0;
            position.aStake = 0;
            position.bStake = 0;

            if (fee > 0) {
                payable(marketMaker).sendValue(fee);
            }
        } else if (status == MarketStatus.CANCELLED) {
            payout = uint256(position.aStake) + uint256(position.bStake);
            require(payout > 0, "nothing to claim");
            position.aShares = 0;
            position.bShares = 0;
            position.aStake = 0;
            position.bStake = 0;
        } else {
            revert("market not settled");
        }

        payable(msg.sender).sendValue(payout);
    }

    function _setFeeConfig(
        uint256 tradeTreasuryFeeBps_,
        uint256 tradeMarketMakerFeeBps_,
        uint256 winningsMarketMakerFeeBps_
    ) internal {
        require(tradeTreasuryFeeBps_ <= MAX_FEE_BPS, "treasury fee too high");
        require(tradeMarketMakerFeeBps_ <= MAX_FEE_BPS, "mm fee too high");
        require(
            tradeTreasuryFeeBps_ + tradeMarketMakerFeeBps_ <= MAX_FEE_BPS,
            "total trade fee too high"
        );
        require(winningsMarketMakerFeeBps_ <= MAX_FEE_BPS, "winnings fee too high");

        tradeTreasuryFeeBps = tradeTreasuryFeeBps_;
        tradeMarketMakerFeeBps = tradeMarketMakerFeeBps_;
        winningsMarketMakerFeeBps = winningsMarketMakerFeeBps_;

        emit FeeConfigUpdated(
            tradeTreasuryFeeBps_,
            tradeMarketMakerFeeBps_,
            winningsMarketMakerFeeBps_
        );
    }

    function _quoteOrder(uint8 side, uint16 price, uint128 amount, uint256 value)
        internal
        view
        returns (OrderQuote memory quote)
    {
        quote.cost = _quoteCost(side, price, amount);
        quote.tradeTreasuryFee = (quote.cost * tradeTreasuryFeeBps) / MAX_FEE_BPS;
        quote.tradeMarketMakerFee = (quote.cost * tradeMarketMakerFeeBps) / MAX_FEE_BPS;
        quote.totalRequired = quote.cost + quote.tradeTreasuryFee + quote.tradeMarketMakerFee;
        require(value >= quote.totalRequired, "insufficient native value");
        quote.excess = value - quote.totalRequired;
    }

    function _quoteCost(uint8 side, uint16 price, uint128 amount) internal pure returns (uint256) {
        uint256 priceComponent = side == BUY_SIDE ? price : 1000 - price;
        uint256 quoteValue = uint256(amount) * priceComponent;
        require(quoteValue % 1000 == 0, "precision error");
        uint256 cost = quoteValue / 1000;
        require(cost > 0, "cost too low");
        return cost;
    }

    function _matchBuyOrder(
        bytes32 key,
        Market storage market,
        uint16 limitPrice,
        uint128 amount,
        uint64 takerOrderId
    ) internal returns (MatchProgress memory progress) {
        progress.remainingAmount = amount;
        progress.boundaryPrice = market.bestAsk;

        while (
            progress.remainingAmount > 0
                && progress.boundaryPrice <= limitPrice
                && progress.boundaryPrice < 1000
                && progress.matchesCount < 100
        ) {
            PriceLevel storage level = priceLevels[key][SELL_SIDE][progress.boundaryPrice];
            if (level.headOrderId == 0 || level.totalOpen == 0) {
                _deactivatePrice(market, SELL_SIDE, progress.boundaryPrice);
                progress.boundaryPrice = market.bestAsk;
                progress.matchesCount += 1;
                continue;
            }

            Order storage makerOrder = orders[key][level.headOrderId];
            uint128 makerRemaining = makerOrder.amount - makerOrder.filled;
            if (!makerOrder.active || makerRemaining == 0) {
                _popHead(key, market, SELL_SIDE, progress.boundaryPrice);
                progress.boundaryPrice = market.bestAsk;
                progress.matchesCount += 1;
                continue;
            }

            uint128 fillAmount = progress.remainingAmount > makerRemaining
                ? makerRemaining
                : uint128(progress.remainingAmount);

            makerOrder.filled += fillAmount;
            progress.remainingAmount -= fillAmount;
            level.totalOpen -= fillAmount;

            Position storage makerPosition = positions[key][makerOrder.maker];
            Position storage takerPosition = positions[key][msg.sender];
            makerPosition.bShares += fillAmount;
            makerPosition.bStake += uint128(_quoteCost(SELL_SIDE, progress.boundaryPrice, fillAmount));
            takerPosition.aShares += fillAmount;
            takerPosition.aStake += uint128(_quoteCost(BUY_SIDE, progress.boundaryPrice, fillAmount));
            market.totalAShares += fillAmount;
            market.totalBShares += fillAmount;

            if (limitPrice > progress.boundaryPrice) {
                progress.totalImprovement +=
                    (uint256(fillAmount) * (limitPrice - progress.boundaryPrice)) /
                    1000;
            }

            emit OrderMatched(key, makerOrder.id, takerOrderId, fillAmount, progress.boundaryPrice);

            if (makerOrder.filled == makerOrder.amount) {
                _popHead(key, market, SELL_SIDE, progress.boundaryPrice);
            }

            progress.boundaryPrice = market.bestAsk;
            progress.matchesCount += 1;
        }
    }

    function _matchSellOrder(
        bytes32 key,
        Market storage market,
        uint16 limitPrice,
        uint128 amount,
        uint64 takerOrderId
    ) internal returns (MatchProgress memory progress) {
        progress.remainingAmount = amount;
        progress.boundaryPrice = market.bestBid;

        while (
            progress.remainingAmount > 0
                && progress.boundaryPrice >= limitPrice
                && progress.boundaryPrice > 0
                && progress.matchesCount < 100
        ) {
            PriceLevel storage level = priceLevels[key][BUY_SIDE][progress.boundaryPrice];
            if (level.headOrderId == 0 || level.totalOpen == 0) {
                _deactivatePrice(market, BUY_SIDE, progress.boundaryPrice);
                progress.boundaryPrice = market.bestBid;
                progress.matchesCount += 1;
                continue;
            }

            Order storage makerOrder = orders[key][level.headOrderId];
            uint128 makerRemaining = makerOrder.amount - makerOrder.filled;
            if (!makerOrder.active || makerRemaining == 0) {
                _popHead(key, market, BUY_SIDE, progress.boundaryPrice);
                progress.boundaryPrice = market.bestBid;
                progress.matchesCount += 1;
                continue;
            }

            uint128 fillAmount = progress.remainingAmount > makerRemaining
                ? makerRemaining
                : uint128(progress.remainingAmount);

            makerOrder.filled += fillAmount;
            progress.remainingAmount -= fillAmount;
            level.totalOpen -= fillAmount;

            Position storage makerPosition = positions[key][makerOrder.maker];
            Position storage takerPosition = positions[key][msg.sender];
            makerPosition.aShares += fillAmount;
            makerPosition.aStake += uint128(_quoteCost(BUY_SIDE, progress.boundaryPrice, fillAmount));
            takerPosition.bShares += fillAmount;
            takerPosition.bStake += uint128(_quoteCost(SELL_SIDE, progress.boundaryPrice, fillAmount));
            market.totalAShares += fillAmount;
            market.totalBShares += fillAmount;

            if (progress.boundaryPrice > limitPrice) {
                progress.totalImprovement +=
                    (uint256(fillAmount) * (progress.boundaryPrice - limitPrice)) /
                    1000;
            }

            emit OrderMatched(key, makerOrder.id, takerOrderId, fillAmount, progress.boundaryPrice);

            if (makerOrder.filled == makerOrder.amount) {
                _popHead(key, market, BUY_SIDE, progress.boundaryPrice);
            }

            progress.boundaryPrice = market.bestBid;
            progress.matchesCount += 1;
        }
    }

    function _restOrder(
        bytes32 key,
        Market storage market,
        uint8 side,
        uint16 price,
        uint128 amount,
        uint64 orderId
    ) internal {
        Order storage newOrder = orders[key][orderId];
        PriceLevel storage level = priceLevels[key][side][price];

        newOrder.id = orderId;
        newOrder.side = side;
        newOrder.price = price;
        newOrder.maker = msg.sender;
        newOrder.amount = amount;
        newOrder.filled = 0;
        newOrder.prevOrderId = level.tailOrderId;
        newOrder.nextOrderId = 0;
        newOrder.active = true;

        if (level.tailOrderId != 0) {
            orders[key][level.tailOrderId].nextOrderId = orderId;
        } else {
            level.headOrderId = orderId;
        }
        level.tailOrderId = orderId;
        level.totalOpen += amount;

        _activatePrice(market, side, price);
        emit OrderPlaced(key, orderId, msg.sender, side, price, amount);
    }

    function _settleOrderValue(OrderQuote memory quote, uint256 totalImprovement) internal {
        if (quote.tradeTreasuryFee > 0) {
            payable(treasury).sendValue(quote.tradeTreasuryFee);
        }
        if (quote.tradeMarketMakerFee > 0) {
            payable(marketMaker).sendValue(quote.tradeMarketMakerFee);
        }
        if (totalImprovement > 0) {
            payable(msg.sender).sendValue(totalImprovement);
        }
        if (quote.excess > 0) {
            payable(msg.sender).sendValue(quote.excess);
        }
    }

    function _popHead(bytes32 key, Market storage market, uint8 side, uint16 price) internal {
        PriceLevel storage level = priceLevels[key][side][price];
        uint64 headOrderId = level.headOrderId;
        Order storage head = orders[key][headOrderId];

        level.headOrderId = head.nextOrderId;
        if (level.headOrderId == 0) {
            level.tailOrderId = 0;
            level.totalOpen = 0;
            _deactivatePrice(market, side, price);
        }

        head.active = false;
        head.prevOrderId = 0;
        head.nextOrderId = 0;
    }

    function _unlinkOrder(
        bytes32 key,
        Market storage market,
        PriceLevel storage level,
        Order storage order,
        uint128 remaining
    ) internal {
        if (order.prevOrderId == 0) {
            level.headOrderId = order.nextOrderId;
        } else {
            orders[key][order.prevOrderId].nextOrderId = order.nextOrderId;
        }

        if (order.nextOrderId == 0) {
            level.tailOrderId = order.prevOrderId;
        } else {
            orders[key][order.nextOrderId].prevOrderId = order.prevOrderId;
        }

        level.totalOpen -= remaining;
        if (level.headOrderId == 0 || level.totalOpen == 0) {
            level.headOrderId = 0;
            level.tailOrderId = 0;
            level.totalOpen = 0;
            _deactivatePrice(market, order.side, order.price);
        } else {
            _refreshBestPrices(market);
        }
    }

    function _activatePrice(Market storage market, uint8 side, uint16 price) internal {
        if (side == BUY_SIDE) {
            if (price > market.bestBid) {
                market.bestBid = price;
            }
        } else if (price < market.bestAsk) {
            market.bestAsk = price;
        }
    }

    function _deactivatePrice(Market storage market, uint8 side, uint16 price) internal {
        delete priceLevels[marketKey(market.duelKey, market.marketKind)][side][price];
        _refreshBestPrices(market);
    }

    function _refreshBestPrices(Market storage market) internal {
        bytes32 key = marketKey(market.duelKey, market.marketKind);
        market.bestBid = 0;
        for (uint16 price = 999; price > 0; price--) {
            PriceLevel storage level = priceLevels[key][BUY_SIDE][price];
            if (level.headOrderId != 0 && level.totalOpen > 0) {
                market.bestBid = price;
                break;
            }
        }

        market.bestAsk = 1000;
        for (uint16 price = 1; price < 1000; price++) {
            PriceLevel storage level = priceLevels[key][SELL_SIDE][price];
            if (level.headOrderId != 0 && level.totalOpen > 0) {
                market.bestAsk = price;
                break;
            }
        }
    }

    function _mapDuelStatus(DuelOutcomeOracle.DuelStatus status) internal pure returns (MarketStatus) {
        if (status == DuelOutcomeOracle.DuelStatus.BETTING_OPEN) return MarketStatus.OPEN;
        if (status == DuelOutcomeOracle.DuelStatus.LOCKED) return MarketStatus.LOCKED;
        if (status == DuelOutcomeOracle.DuelStatus.RESOLVED) return MarketStatus.RESOLVED;
        if (status == DuelOutcomeOracle.DuelStatus.CANCELLED) return MarketStatus.CANCELLED;
        return MarketStatus.LOCKED;
    }

    function _mapWinner(DuelOutcomeOracle.Side winner) internal pure returns (Side) {
        if (winner == DuelOutcomeOracle.Side.A) return Side.A;
        if (winner == DuelOutcomeOracle.Side.B) return Side.B;
        return Side.NONE;
    }

    receive() external payable {}
}
