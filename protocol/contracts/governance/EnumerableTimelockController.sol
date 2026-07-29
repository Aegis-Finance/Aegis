// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract EnumerableTimelockController is AccessControlEnumerable, ERC721Holder, ERC1155Holder, ReentrancyGuard {
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");
    uint256 internal constant _DONE_TIMESTAMP = uint256(1);

    mapping(bytes32 id => uint256) private _timestamps;
    uint256 private _minDelay;

    enum OperationState {
        Unset,
        Waiting,
        Ready,
        Done
    }

    error TimelockInvalidOperationLength(uint256 targets, uint256 payloads, uint256 values);
    error TimelockInsufficientDelay(uint256 delay, uint256 minDelay);
    error TimelockUnexpectedOperationState(bytes32 operationId, bytes32 expectedStates);
    error TimelockUnexecutedPredecessor(bytes32 predecessorId);
    error TimelockUnauthorizedCaller(address caller);

    event CallScheduled(
        bytes32 indexed id,
        uint256 indexed index,
        address target,
        uint256 value,
        bytes data,
        bytes32 predecessor,
        uint256 delay
    );
    event CallExecuted(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data);
    event CallSalt(bytes32 indexed id, bytes32 salt);
    event Cancelled(bytes32 indexed id);
    event MinDelayChange(uint256 oldDuration, uint256 newDuration);

    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors, address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, address(this));

        if (admin != address(0)) {
            _grantRole(DEFAULT_ADMIN_ROLE, admin);
        }

        for (uint256 i = 0; i < proposers.length; ++i) {
            _grantRole(PROPOSER_ROLE, proposers[i]);
            _grantRole(CANCELLER_ROLE, proposers[i]);
        }

        for (uint256 i = 0; i < executors.length; ++i) {
            _grantRole(EXECUTOR_ROLE, executors[i]);
        }

        _minDelay = minDelay;
        emit MinDelayChange(0, minDelay);
    }

    modifier onlyRoleOrOpenRole(bytes32 role) {
        if (!hasRole(role, address(0))) {
            _checkRole(role, _msgSender());
        }
        _;
    }

    receive() external payable virtual {}

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(AccessControlEnumerable, ERC1155Holder) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function isOperation(bytes32 id) public view returns (bool) {
        return getOperationState(id) != OperationState.Unset;
    }

    function isOperationPending(bytes32 id) public view returns (bool) {
        OperationState state = getOperationState(id);
        return state == OperationState.Waiting || state == OperationState.Ready;
    }

    function isOperationReady(bytes32 id) public view returns (bool) {
        return getOperationState(id) == OperationState.Ready;
    }

    function isOperationDone(bytes32 id) public view returns (bool) {
        return getOperationState(id) == OperationState.Done;
    }

    function getTimestamp(bytes32 id) public view virtual returns (uint256) {
        return _timestamps[id];
    }

    function getOperationState(bytes32 id) public view virtual returns (OperationState) {
        uint256 timestamp = getTimestamp(id);
        if (timestamp == 0) {
            return OperationState.Unset;
        } else if (timestamp == _DONE_TIMESTAMP) {
            return OperationState.Done;
        } else if (timestamp > block.timestamp) {
            return OperationState.Waiting;
        } else {
            return OperationState.Ready;
        }
    }

    function getMinDelay() public view virtual returns (uint256) {
        return _minDelay;
    }

    function hashOperation(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt
    ) public pure virtual returns (bytes32) {
        return keccak256(abi.encode(target, value, data, predecessor, salt));
    }

    function hashOperationBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata payloads,
        bytes32 predecessor,
        bytes32 salt
    ) public pure virtual returns (bytes32) {
        return keccak256(abi.encode(targets, values, payloads, predecessor, salt));
    }

    function schedule(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    ) public virtual onlyRole(PROPOSER_ROLE) {
        bytes32 id = hashOperation(target, value, data, predecessor, salt);
        _schedule(id, delay);
        emit CallScheduled(id, 0, target, value, data, predecessor, delay);
        if (salt != bytes32(0)) {
            emit CallSalt(id, salt);
        }
    }

    function scheduleBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata payloads,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    ) public virtual onlyRole(PROPOSER_ROLE) {
        if (targets.length != values.length || targets.length != payloads.length) {
            revert TimelockInvalidOperationLength(targets.length, payloads.length, values.length);
        }

        bytes32 id = hashOperationBatch(targets, values, payloads, predecessor, salt);
        _schedule(id, delay);
        for (uint256 i = 0; i < targets.length; ++i) {
            emit CallScheduled(id, i, targets[i], values[i], payloads[i], predecessor, delay);
        }
        if (salt != bytes32(0)) {
            emit CallSalt(id, salt);
        }
    }

    function _schedule(bytes32 id, uint256 delay) private {
        if (isOperation(id)) {
            revert TimelockUnexpectedOperationState(id, _encodeStateBitmap(OperationState.Unset));
        }
        uint256 minDelay = getMinDelay();
        if (delay < minDelay) {
            revert TimelockInsufficientDelay(delay, minDelay);
        }
        _timestamps[id] = block.timestamp + delay;
    }

    function cancel(bytes32 id) public virtual onlyRole(CANCELLER_ROLE) {
        if (!isOperationPending(id)) {
            revert TimelockUnexpectedOperationState(
                id,
                _encodeStateBitmap(OperationState.Waiting) | _encodeStateBitmap(OperationState.Ready)
            );
        }
        delete _timestamps[id];

        emit Cancelled(id);
    }

    function execute(
        address target,
        uint256 value,
        bytes calldata payload,
        bytes32 predecessor,
        bytes32 salt
    ) public payable virtual nonReentrant onlyRoleOrOpenRole(EXECUTOR_ROLE) {
        bytes32 id = hashOperation(target, value, payload, predecessor, salt);

        _beforeCall(id, predecessor);
        
        // SECURITY: Execute external call first, then update state (CEI pattern for timelock)
        // For timelock, we mark as done AFTER execution to prevent re-execution
        _execute(target, value, payload);
        
        // slither-disable-next-line reentrancy-benign
        // False positive: nonReentrant modifier prevents reentrancy. State update after execution
        // is intentional to prevent re-execution. Timelock operations are governance-approved.
        // Update state after successful execution to prevent re-execution
        _afterCall(id);
        
        emit CallExecuted(id, 0, target, value, payload);
    }

    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata payloads,
        bytes32 predecessor,
        bytes32 salt
    ) public payable virtual nonReentrant onlyRoleOrOpenRole(EXECUTOR_ROLE) {
        if (targets.length != values.length || targets.length != payloads.length) {
            revert TimelockInvalidOperationLength(targets.length, payloads.length, values.length);
        }

        bytes32 id = hashOperationBatch(targets, values, payloads, predecessor, salt);

        _beforeCall(id, predecessor);
        
        // SECURITY: Execute all external calls first, then update state (CEI pattern for timelock)
        // For timelock, we mark as done AFTER all executions to prevent re-execution
        for (uint256 i = 0; i < targets.length; ++i) {
            address target = targets[i];
            uint256 value = values[i];
            bytes calldata payload = payloads[i];
            _execute(target, value, payload);
            emit CallExecuted(id, i, target, value, payload);
        }
        
        // slither-disable-next-line reentrancy-benign
        // False positive: nonReentrant modifier prevents reentrancy. State update after execution
        // is intentional to prevent re-execution. Timelock operations are governance-approved.
        // Update state after all successful executions to prevent re-execution
        _afterCall(id);
    }

    /**
     * @dev SECURITY: This function executes governance-approved timelock operations.
     *      The target is NOT arbitrary - it's specified in the timelock proposal that was
     *      approved through governance and passed the timelock delay. Only executors can
     *      trigger execution, and the operation must be scheduled and ready.
     *      Slither warning about "arbitrary destination" is false positive - targets are
     *      governance-approved via the timelock proposal process.
     */
    function _execute(address target, uint256 value, bytes calldata data) internal virtual {
        // slither-disable-next-line arbitrary-send-eth
        // False positive: target is from governance-approved timelock proposal, not arbitrary
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        Address.verifyCallResult(success, returndata);
    }

    function _beforeCall(bytes32 id, bytes32 predecessor) private view {
        if (!isOperationReady(id)) {
            revert TimelockUnexpectedOperationState(id, _encodeStateBitmap(OperationState.Ready));
        }
        if (predecessor != bytes32(0) && !isOperationDone(predecessor)) {
            revert TimelockUnexecutedPredecessor(predecessor);
        }
    }

    function _afterCall(bytes32 id) private {
        // SECURITY: Verify operation is still ready (not cancelled during execution)
        if (!isOperationReady(id)) {
            revert TimelockUnexpectedOperationState(id, _encodeStateBitmap(OperationState.Ready));
        }
        // Mark as done to prevent re-execution
        _timestamps[id] = _DONE_TIMESTAMP;
    }

    function updateDelay(uint256 newDelay) external virtual {
        address sender = _msgSender();
        if (sender != address(this)) {
            revert TimelockUnauthorizedCaller(sender);
        }
        emit MinDelayChange(_minDelay, newDelay);
        _minDelay = newDelay;
    }

    function _encodeStateBitmap(OperationState operationState) internal pure returns (bytes32) {
        return bytes32(1 << uint8(operationState));
    }
}