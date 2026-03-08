// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract DuelOutcomeOracle is AccessControl {
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");

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

    constructor(address admin, address reporter) {
        require(admin != address(0), "invalid admin");
        require(reporter != address(0), "invalid reporter");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REPORTER_ROLE, reporter);
    }

    function setReporter(address reporter, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(reporter != address(0), "invalid reporter");
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
        require(duelKey != bytes32(0), "invalid duel key");
        require(participantAHash != bytes32(0), "invalid participant A");
        require(participantBHash != bytes32(0), "invalid participant B");
        require(participantAHash != participantBHash, "duplicate participants");
        require(
            status == DuelStatus.SCHEDULED
                || status == DuelStatus.BETTING_OPEN
                || status == DuelStatus.LOCKED,
            "invalid status"
        );
        require(betOpenTs > 0 && betCloseTs > betOpenTs, "invalid betting window");
        require(duelStartTs >= betCloseTs, "invalid duel start");

        DuelState storage duel = duels[duelKey];
        require(duel.status != DuelStatus.RESOLVED, "duel resolved");
        require(duel.status != DuelStatus.CANCELLED, "duel cancelled");
        require(_statusRank(status) >= _statusRank(duel.status), "invalid transition");

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
        require(duel.status != DuelStatus.NULL, "duel missing");
        require(duel.status != DuelStatus.RESOLVED, "duel resolved");
        require(duel.status != DuelStatus.CANCELLED, "duel cancelled");
        duel.status = DuelStatus.CANCELLED;
        duel.winner = Side.NONE;
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
        require(duel.status != DuelStatus.NULL, "duel missing");
        require(duel.status != DuelStatus.RESOLVED, "duel resolved");
        require(duel.status != DuelStatus.CANCELLED, "duel cancelled");
        require(winner == Side.A || winner == Side.B, "invalid winner");
        require(duelEndTs >= duel.betCloseTs, "invalid duel end");

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

    function _statusRank(DuelStatus status) private pure returns (uint8) {
        if (status == DuelStatus.NULL) return 0;
        if (status == DuelStatus.SCHEDULED) return 1;
        if (status == DuelStatus.BETTING_OPEN) return 2;
        if (status == DuelStatus.LOCKED) return 3;
        if (status == DuelStatus.RESOLVED) return 4;
        return 5;
    }
}
