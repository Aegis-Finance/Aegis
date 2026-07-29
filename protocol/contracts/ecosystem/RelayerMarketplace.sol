// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EcosystemZkBase} from "./libraries/EcosystemZkBase.sol";

/**
 * @title RelayerMarketplace
 * @notice DAO-governed relayer registry: stake AGS, relay gas-paid submissions, slash misbehavior.
 *         Pairs with `PrivacyEntryRouter` — any registered relayer may submit relay calldata.
 */
contract RelayerMarketplace is EcosystemZkBase {
    using SafeERC20 for IERC20;

    struct Relayer {
        uint256 staked;
        uint256 registeredAt;
        uint256 relaysCompleted;
        bool active;
    }

    uint256 public minStake;
    uint256 public slashCapBps = 5_000; // max 50% per slash event
    bool public daoAllowlistRequired;

    mapping(address => Relayer) public relayers;
    mapping(address => bool) public daoApprovedRelayers;

    event RelayerRegistered(address indexed relayer, uint256 staked);
    event RelayerStakeIncreased(address indexed relayer, uint256 added, uint256 total);
    event RelayerWithdrawn(address indexed relayer, uint256 amount);
    event RelayerSlashed(address indexed relayer, uint256 amount, bytes32 reasonHash);
    event RelayerRelayRecorded(address indexed relayer);
    event MinStakeUpdated(uint256 previous, uint256 next);
    event DaoAllowlistRequiredUpdated(bool required);
    event DaoRelayerApprovalUpdated(address indexed relayer, bool approved);

    error InsufficientStake();
    error RelayerNotActive();
    error SlashExceedsCap();
    error RelayerNotDaoApproved();

    constructor(address token_, address verifierFactory_, uint256 minStake_) EcosystemZkBase(token_, verifierFactory_) {
        minStake = minStake_;
    }

    function setMinStake(uint256 next) external onlyGovernance {
        emit MinStakeUpdated(minStake, next);
        minStake = next;
    }

    function setDaoAllowlistRequired(bool required) external onlyGovernance {
        daoAllowlistRequired = required;
        emit DaoAllowlistRequiredUpdated(required);
    }

    function setDaoApprovedRelayer(address relayer, bool approved) external onlyGovernance {
        daoApprovedRelayers[relayer] = approved;
        emit DaoRelayerApprovalUpdated(relayer, approved);
    }

    function register(uint256 stakeAmount) external nonReentrant whenNotPaused {
        if (daoAllowlistRequired && !daoApprovedRelayers[msg.sender]) revert RelayerNotDaoApproved();
        if (stakeAmount < minStake) revert InsufficientStake();
        Relayer storage r = relayers[msg.sender];
        if (!r.active) {
            r.registeredAt = block.timestamp;
            r.active = true;
            emit RelayerRegistered(msg.sender, stakeAmount);
        }
        IERC20(address(TOKEN)).safeTransferFrom(msg.sender, address(this), stakeAmount);
        r.staked += stakeAmount;
        emit RelayerStakeIncreased(msg.sender, stakeAmount, r.staked);
    }

    function withdrawStake(uint256 amount) external nonReentrant whenNotPaused {
        Relayer storage r = relayers[msg.sender];
        if (!r.active || r.staked < amount) revert InsufficientStake();
        if (r.staked - amount < minStake && amount != r.staked) revert InsufficientStake();
        r.staked -= amount;
        if (r.staked == 0) r.active = false;
        IERC20(address(TOKEN)).safeTransfer(msg.sender, amount);
        emit RelayerWithdrawn(msg.sender, amount);
    }

    function recordRelay(address relayer) external whenNotPaused {
        if (!isActiveRelayer(relayer)) revert RelayerNotActive();
        relayers[relayer].relaysCompleted += 1;
        emit RelayerRelayRecorded(relayer);
    }

    function slash(address relayer, uint256 amount, bytes32 reasonHash) external onlyGovernance nonReentrant {
        Relayer storage r = relayers[relayer];
        if (!r.active || r.staked < amount) revert InsufficientStake();
        uint256 maxSlash = (r.staked * slashCapBps) / 10_000;
        if (amount > maxSlash) revert SlashExceedsCap();
        r.staked -= amount;
        if (r.staked < minStake) r.active = false;
        IERC20(address(TOKEN)).safeTransfer(governanceContract, amount);
        emit RelayerSlashed(relayer, amount, reasonHash);
    }

    function isActiveRelayer(address relayer) public view returns (bool) {
        Relayer storage r = relayers[relayer];
        return r.active && r.staked >= minStake;
    }
}
