// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {GovernanceAccessLib} from "../libraries/GovernanceAccessLib.sol";

/**
 * @title LiquidityMiningGauge
 * @notice DAO-funded **liquidity mining** for a single LP token: contributors stake LP, earn a
 *         **competition epoch** reward stream proportional to time-weighted stake (no privileged mint).
 * @dev Fits the fixed **21M AGS** model: rewards are **transferred in** by governance (treasury / flywheel),
 *      never minted. Each `notifyRewardAmount` starts a fresh emission window; frontends can label
 *      `competitionId` as weekly/monthly seasons. Optional pause for emergencies.
 *
 *      **Phase-B stealth routing (wallet separation, not ZK):** `withdrawTo`, `getRewardTo`, and `exitTo`
 *      let the staker send LP and/or AGS rewards to a different address (cold wallet, deposit helper,
 *      or protocol entry point). On-chain amounts and timing remain visible; this only breaks the
 *      “same EOA receives stake and yield” link when users choose it.
 */
contract LiquidityMiningGauge is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable STAKE_TOKEN;
    IERC20 public immutable REWARD_TOKEN;

    address public governanceContract;
    address public timelockController;
    /// @notice `AegisExecutionRelay` — sole caller for `stakeFor` / `getRewardFor` / `withdrawFor`.
    address public executionRelay;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    event GovernanceUpdated(address indexed previousGovernance, address indexed newGovernance);
    event ExecutionRelayUpdated(address indexed previousRelay, address indexed newRelay);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    /// @notice LP withdrawn by `user` but sent to `recipient` (stealth routing).
    event WithdrawnTo(address indexed user, address indexed recipient, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);
    /// @notice Rewards claimed by `user` but sent to `recipient` (stealth routing).
    event RewardPaidTo(address indexed user, address indexed recipient, uint256 reward);
    event RewardAdded(uint256 indexed competitionId, uint256 reward, uint256 periodFinish);
    event Recovered(address indexed token, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error UnauthorizedAccess();
    error InsufficientRewardBalance();

    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    modifier onlyExecutionRelay() {
        if (msg.sender != executionRelay) revert UnauthorizedAccess();
        _;
    }

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    /// @notice Monotonic counter incremented whenever governance seeds a new reward window.
    uint256 public competitionId;

    constructor(address initialOwner, address stakeToken_, address rewardToken_) Ownable(initialOwner) {
        if (stakeToken_ == address(0) || rewardToken_ == address(0)) revert ZeroAddress();
        STAKE_TOKEN = IERC20(stakeToken_);
        REWARD_TOKEN = IERC20(rewardToken_);
    }

    function setGovernance(address g) external onlyOwner {
        if (g == address(0)) revert ZeroAddress();
        emit GovernanceUpdated(governanceContract, g);
        governanceContract = g;
    }

    function setTimelockController(address t) external onlyGovernance {
        emit TimelockControllerUpdated(timelockController, t);
        timelockController = t;
    }

    function setPaused(bool v) external onlyGovernance {
        if (v) _pause();
        else _unpause();
    }

    function setExecutionRelay(address relay) external {
        if (
            msg.sender != owner()
                && !GovernanceAccessLib.isGovernanceTimelockOrCore(
                    governanceContract, timelockController, msg.sender
                )
        ) {
            revert UnauthorizedAccess();
        }
        emit ExecutionRelayUpdated(executionRelay, relay);
        executionRelay = relay;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        uint256 pf = periodFinish;
        return block.timestamp < pf ? block.timestamp : pf;
    }

    function rewardPerToken() public view returns (uint256) {
        uint256 supply = _totalSupply;
        if (supply == 0) {
            return rewardPerTokenStored;
        }
        return rewardPerTokenStored
            + (rewardRate * (lastTimeRewardApplicable() - lastUpdateTime) * 1e18) / supply;
    }

    function earned(address account) public view returns (uint256) {
        return (_balances[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18 + rewards[account];
    }

    function stake(uint256 amount) external nonReentrant whenNotPaused {
        _stake(msg.sender, amount);
    }

    /// @notice Meta-tx stake via `AegisExecutionRelay` — LP pulled from `user`, balance credited to `user`.
    function stakeFor(address user, uint256 amount) external onlyExecutionRelay nonReentrant whenNotPaused {
        if (user == address(0)) revert ZeroAddress();
        _stake(user, amount);
    }

    function _stake(address user, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        _updateReward(user);
        _totalSupply += amount;
        _balances[user] += amount;
        STAKE_TOKEN.safeTransferFrom(user, address(this), amount);
        emit Staked(user, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        _withdrawTo(msg.sender, msg.sender, amount);
    }

    /// @notice Meta-tx withdraw via `AegisExecutionRelay`.
    function withdrawFor(address user, uint256 amount) external onlyExecutionRelay nonReentrant {
        if (user == address(0)) revert ZeroAddress();
        _withdrawTo(user, user, amount);
    }

    /**
     * @notice Withdraw staked LP to `recipient` (e.g. cold wallet). Caller must still be the staker.
     */
    function withdrawTo(address recipient, uint256 amount) external nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        _withdrawTo(msg.sender, recipient, amount);
    }

    function getReward() external nonReentrant {
        _payReward(msg.sender, msg.sender);
    }

    /// @notice Meta-tx reward claim via `AegisExecutionRelay`.
    function getRewardFor(address user) external onlyExecutionRelay nonReentrant {
        if (user == address(0)) revert ZeroAddress();
        _payReward(user, user);
    }

    /**
     * @notice Claim accrued rewards to `recipient` instead of msg.sender (e.g. shielded deposit path).
     */
    function getRewardTo(address recipient) external nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        _payReward(msg.sender, recipient);
    }

    /// @notice Leave the gauge and claim rewards in one call (gas convenience).
    function exit() external nonReentrant {
        _exitTo(msg.sender, msg.sender, msg.sender);
    }

    /**
     * @notice Exit stake to `stakeRecipient` and rewards to `rewardRecipient` (wallet separation).
     */
    function exitTo(address stakeRecipient, address rewardRecipient) external nonReentrant {
        if (stakeRecipient == address(0) || rewardRecipient == address(0)) revert ZeroAddress();
        _exitTo(msg.sender, stakeRecipient, rewardRecipient);
    }

    function _withdrawTo(address account, address recipient, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        _updateReward(account);
        _totalSupply -= amount;
        _balances[account] -= amount;
        STAKE_TOKEN.safeTransfer(recipient, amount);
        if (recipient == account) {
            emit Withdrawn(account, amount);
        } else {
            emit WithdrawnTo(account, recipient, amount);
        }
    }

    function _payReward(address account, address recipient) internal {
        _updateReward(account);
        uint256 reward = rewards[account];
        if (reward > 0) {
            rewards[account] = 0;
            REWARD_TOKEN.safeTransfer(recipient, reward);
            if (recipient == account) {
                emit RewardPaid(account, reward);
            } else {
                emit RewardPaidTo(account, recipient, reward);
            }
        }
    }

    function _exitTo(address account, address stakeRecipient, address rewardRecipient) internal {
        _updateReward(account);
        uint256 amount = _balances[account];
        if (amount > 0) {
            _totalSupply -= amount;
            _balances[account] = 0;
            STAKE_TOKEN.safeTransfer(stakeRecipient, amount);
            if (stakeRecipient == account) {
                emit Withdrawn(account, amount);
            } else {
                emit WithdrawnTo(account, stakeRecipient, amount);
            }
        }
        uint256 reward = rewards[account];
        if (reward > 0) {
            rewards[account] = 0;
            REWARD_TOKEN.safeTransfer(rewardRecipient, reward);
            if (rewardRecipient == account) {
                emit RewardPaid(account, reward);
            } else {
                emit RewardPaidTo(account, rewardRecipient, reward);
            }
        }
    }

    /**
     * @notice Governance (or timelock) funds the next emission window. Increments `competitionId`.
     * @param reward Total reward token amount to emit over `duration` seconds (pro-rata to LP stake).
     */
    function notifyRewardAmount(uint256 reward, uint256 duration) external onlyGovernance nonReentrant {
        if (reward == 0 || duration == 0) revert ZeroAmount();
        _updateReward(address(0));
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / duration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / duration;
        }
        uint256 balance = REWARD_TOKEN.balanceOf(address(this));
        if (balance < reward) revert InsufficientRewardBalance();
        if (rewardRate == 0) revert ZeroAmount();

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        unchecked {
            ++competitionId;
        }
        emit RewardAdded(competitionId, reward, periodFinish);
    }

    function recoverERC20(address tokenAddress, uint256 amount) external onlyGovernance {
        if (tokenAddress == address(STAKE_TOKEN)) revert("LiquidityMiningGauge: cannot recover stake token");
        IERC20(tokenAddress).safeTransfer(msg.sender, amount);
        emit Recovered(tokenAddress, amount);
    }

    function _updateReward(address account) internal {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
    }
}
