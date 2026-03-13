// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract DuelOutcomeOracle is AccessControl {
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");
    bytes32 public constant REPORTER_ROLE_ADMIN = keccak256("REPORTER_ROLE_ADMIN");
    address public governanceController;

    error InvalidAdmin();
    error InvalidReporter();
    error InvalidDuelKey();
    error InvalidParticipant();
    error DuplicateParticipants();
    error InvalidStatus();
    error InvalidBettingWindow();
    error InvalidDuelStart();
    error InvalidTransition();
    error DuelMissing();
    error InvalidWinner();
    error InvalidDuelEnd();
    error DuelAlreadyResolved();
    error DuelAlreadyCancelled();
    error InvalidGovernanceController();
    error UnauthorizedGovernanceController();

    enum DuelStatus {
        NULL,
        SCHEDULED,
        BETTING_OPEN,
        LOCKED,
        RESOLVED,
        CANCELLED
    }

    enum Side {
        NONE,
        A,
        B
    }

    struct DuelState {
        bytes32 duelKey;
        bytes32 participantAHash;
        bytes32 participantBHash;
        DuelStatus status;
        Side winner;
        uint64 betOpenTs;
        uint64 betCloseTs;
        uint64 duelStartTs;
        uint64 duelEndTs;
        uint64 seed;
        bytes32 resultHash;
        bytes32 replayHash;
        string metadataUri;
    }

    mapping(bytes32 => DuelState) private duels;

    event DuelUpserted(
        bytes32 indexed duelKey,
        DuelStatus status,
        uint64 betOpenTs,
        uint64 betCloseTs,
        uint64 duelStartTs,
        string metadataUri
    );
    event DuelCancelled(bytes32 indexed duelKey, string metadataUri);
    event DuelResolved(
        bytes32 indexed duelKey,
        Side winner,
        uint64 seed,
        uint64 duelEndTs,
        bytes32 resultHash,
        bytes32 replayHash,
        string metadataUri
    );

    constructor(address admin, address reporter, address governanceController_) {
        if (admin == address(0)) revert InvalidAdmin();
        if (reporter == address(0)) revert InvalidReporter();
        if (governanceController_ == address(0)) revert InvalidGovernanceController();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _setRoleAdmin(REPORTER_ROLE, REPORTER_ROLE_ADMIN);
        _grantRole(REPORTER_ROLE, reporter);
        governanceController = governanceController_;
    }

    modifier onlyGovernanceController() {
        if (msg.sender != governanceController) revert UnauthorizedGovernanceController();
        _;
    }

    function setGovernanceController(address governanceController_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (governanceController_ == address(0)) revert InvalidGovernanceController();
        governanceController = governanceController_;
    }

    function setReporter(address reporter, bool enabled) external onlyGovernanceController {
        if (reporter == address(0)) revert InvalidReporter();
        if (enabled) {
            _grantRole(REPORTER_ROLE, reporter);
        } else {
            _revokeRole(REPORTER_ROLE, reporter);
        }
    }

    function emergencySetReporter(address reporter, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (reporter == address(0)) revert InvalidReporter();
        if (enabled) {
            _grantRole(REPORTER_ROLE, reporter);
        } else {
            _revokeRole(REPORTER_ROLE, reporter);
        }
    }

    function getDuel(bytes32 duelKey) external view returns (DuelState memory) {
        return duels[duelKey];
    }

    function upsertDuel(
        bytes32 duelKey,
        bytes32 participantAHash,
        bytes32 participantBHash,
        uint64 betOpenTs,
        uint64 betCloseTs,
        uint64 duelStartTs,
        string calldata metadataUri,
        DuelStatus status
    ) external onlyRole(REPORTER_ROLE) {
        if (duelKey == bytes32(0)) revert InvalidDuelKey();
        if (participantAHash == bytes32(0)) revert InvalidParticipant();
        if (participantBHash == bytes32(0)) revert InvalidParticipant();
        if (participantAHash == participantBHash) revert DuplicateParticipants();
        if (
            status != DuelStatus.SCHEDULED
                && status != DuelStatus.BETTING_OPEN
                && status != DuelStatus.LOCKED
        ) revert InvalidStatus();
        if (betOpenTs == 0 || betCloseTs <= betOpenTs) revert InvalidBettingWindow();
        if (duelStartTs < betCloseTs) revert InvalidDuelStart();

        DuelState storage duel = duels[duelKey];
        _requireSettleable(duel);
        if (uint8(status) < uint8(duel.status)) revert InvalidTransition();

        duel.duelKey = duelKey;
        duel.participantAHash = participantAHash;
        duel.participantBHash = participantBHash;
        duel.status = status;
        duel.betOpenTs = betOpenTs;
        duel.betCloseTs = betCloseTs;
        duel.duelStartTs = duelStartTs;
        duel.metadataUri = metadataUri;

        emit DuelUpserted(
            duelKey,
            status,
            betOpenTs,
            betCloseTs,
            duelStartTs,
            metadataUri
        );
    }

    function cancelDuel(bytes32 duelKey, string calldata metadataUri) external onlyRole(REPORTER_ROLE) {
        DuelState storage duel = duels[duelKey];
        if (duel.status == DuelStatus.NULL) revert DuelMissing();
        _requireSettleable(duel);
        duel.status = DuelStatus.CANCELLED;
        duel.metadataUri = metadataUri;
        emit DuelCancelled(duelKey, metadataUri);
    }

    function reportResult(
        bytes32 duelKey,
        Side winner,
        uint64 seed,
        bytes32 replayHash,
        bytes32 resultHash,
        uint64 duelEndTs,
        string calldata metadataUri
    ) external onlyRole(REPORTER_ROLE) {
        DuelState storage duel = duels[duelKey];
        if (duel.status == DuelStatus.NULL) revert DuelMissing();
        _requireSettleable(duel);
        if (winner != Side.A && winner != Side.B) revert InvalidWinner();
        if (duelEndTs < duel.betCloseTs) revert InvalidDuelEnd();

        duel.status = DuelStatus.RESOLVED;
        duel.winner = winner;
        duel.seed = seed;
        duel.replayHash = replayHash;
        duel.resultHash = resultHash;
        duel.duelEndTs = duelEndTs;
        duel.metadataUri = metadataUri;

        emit DuelResolved(
            duelKey,
            winner,
            seed,
            duelEndTs,
            resultHash,
            replayHash,
            metadataUri
        );
    }

    function _requireSettleable(DuelState storage duel) private view {
        if (duel.status == DuelStatus.RESOLVED) revert DuelAlreadyResolved();
        if (duel.status == DuelStatus.CANCELLED) revert DuelAlreadyCancelled();
    }

}
