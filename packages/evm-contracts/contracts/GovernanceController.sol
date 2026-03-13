// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract GovernanceController is Ownable {
    uint64 public immutable minDelay;

    struct Operation {
        uint64 executeAfter;
        bool executed;
    }

    mapping(bytes32 => Operation) public operations;

    error InvalidOwner();
    error DelayTooShort();
    error InvalidTarget();
    error OperationAlreadyScheduled();
    error OperationMissing();
    error OperationNotReady();
    error OperationAlreadyExecuted();
    error UnderlyingCallFailed();

    event OperationScheduled(bytes32 indexed opId, address indexed target, uint64 executeAfter);
    event OperationCancelled(bytes32 indexed opId);
    event OperationExecuted(bytes32 indexed opId, address indexed target);

    constructor(address owner_, uint64 minDelay_) Ownable(owner_) {
        if (owner_ == address(0)) revert InvalidOwner();
        minDelay = minDelay_;
    }

    function hashOperation(address target, bytes calldata data, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(target, data, salt));
    }

    function schedule(address target, bytes calldata data, bytes32 salt, uint64 executeAfter)
        external
        onlyOwner
        returns (bytes32 opId)
    {
        if (target == address(0)) revert InvalidTarget();
        if (executeAfter < block.timestamp + minDelay) revert DelayTooShort();
        opId = hashOperation(target, data, salt);
        if (operations[opId].executeAfter != 0) revert OperationAlreadyScheduled();
        operations[opId] = Operation({executeAfter: executeAfter, executed: false});
        emit OperationScheduled(opId, target, executeAfter);
    }

    function cancel(bytes32 opId) external onlyOwner {
        Operation memory op = operations[opId];
        if (op.executeAfter == 0) revert OperationMissing();
        if (op.executed) revert OperationAlreadyExecuted();
        delete operations[opId];
        emit OperationCancelled(opId);
    }

    function execute(address target, bytes calldata data, bytes32 salt) external returns (bytes memory result) {
        bytes32 opId = hashOperation(target, data, salt);
        Operation storage op = operations[opId];
        if (op.executeAfter == 0) revert OperationMissing();
        if (op.executed) revert OperationAlreadyExecuted();
        if (block.timestamp < op.executeAfter) revert OperationNotReady();
        op.executed = true;

        (bool ok, bytes memory returnData) = target.call(data);
        if (!ok) revert UnderlyingCallFailed();
        emit OperationExecuted(opId, target);
        return returnData;
    }
}
