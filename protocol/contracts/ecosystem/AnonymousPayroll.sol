// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title AnonymousPayroll
 * @notice Employers fund payroll vault; employees claim shielded payouts via ZK batch proofs.
 */
contract AnonymousPayroll is EcosystemZkBase {
    using SafeERC20 for IERC20;

    string private constant PAYROLL_CIRCUIT = "payroll";

    mapping(address => uint256) public employerBalances;
    mapping(bytes32 => bool) public spentPayrollNullifiers;

    event PayrollFunded(address indexed employer, uint256 amount);
    event PayrollClaimed(bytes32 indexed nullifierHash, bytes32 indexed employeeCommitment, uint256 periodId);

    error InsufficientPayrollBalance();

    constructor(address token_, address verifierFactory_) EcosystemZkBase(token_, verifierFactory_) {}

    function fundPayroll(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        IERC20(address(TOKEN)).safeTransferFrom(msg.sender, address(this), amount);
        employerBalances[msg.sender] += amount;
        emit PayrollFunded(msg.sender, amount);
    }

    /**
     * @param publicInputs [employerHash, periodId, nullifierHash, employeeCommitment, amount]
     */
    function claimPayroll(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        if (publicInputs.length < 5) revert InvalidPublicInputs();
        bytes32 nullifier = bytes32(publicInputs[2]);
        if (spentPayrollNullifiers[nullifier]) revert NullifierAlreadyUsed();
        address employer = address(uint160(publicInputs[0]));
        uint256 amount = publicInputs[4];
        if (employerBalances[employer] < amount) revert InsufficientPayrollBalance();

        _requireValidProof(PAYROLL_CIRCUIT, proof, publicInputs);
        spentPayrollNullifiers[nullifier] = true;
        employerBalances[employer] -= amount;
        emit PayrollClaimed(nullifier, bytes32(publicInputs[3]), publicInputs[1]);
    }
}
