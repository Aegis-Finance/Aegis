// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICommonErrors} from "./interfaces/ICommonErrors.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {GovernanceAccessLib} from "./libraries/GovernanceAccessLib.sol";

/// @title Allocation-compatible token interface
/// @author Aegis Protocol Team
/// @notice Minimal interface for tokens that expose the allocationTransfer hook.
interface IAllocationToken {
    /// @notice Transfers tokens using the allocation hook.
    /// @param to Recipient of the allocation.
    /// @param amount Amount of tokens to transfer.
    /// @return handled True when the allocation hook completed successfully.
    function allocationTransfer(address to, uint256 amount) external returns (bool handled);
}

/**
 * @title TokenAllocation
 * @author Aegis Protocol Team
 * @notice Manages the initial token allocation for the privacy token ecosystem with complete decentralization
 * @dev Manages the initial token allocation for the privacy token ecosystem
 * 
 * Fully Decentralized Allocation Structure (No Team/Founder Privileges):
 * - Public Sale: 50% (10.5M tokens) - Governance-controlled allocation
 *   - 9.5M tokens for auction sale
 *   - 1.0M tokens reserved for liquidity deployment
 *   - **Lifecycle:** this tranche stays on `PrivateTokenContract` / under `TokenAllocation` control until **after**
 *     core protocol + ceremony + verifier infra are live; then governance (or owner before `governanceContract` is set)
 *     calls `setPublicSaleContract` + `allocatePublicTokens()` to fund the TGE contract. The auction `activate()` window is a separate operator decision.
 * - Ecosystem Rewards: 30% (6.3M tokens) - Governance-controlled allocation
 * - Development: 20% (4.2M tokens) - Owner-controlled treasury address (multisig **or** EOA — operational choice via `setTreasuryWallet`)
 * 
 * Total: 21M tokens (100% of max supply)
 * 
 * DAO Governance Model:
 * - All allocations except treasury (20%) are controlled by governance
 * - Treasury allocation is the only exception, going to the configured `treasuryWallet` for development (multisig or EOA)
 * - Once governance is set, only governance can manage public/ecosystem allocations
 * - Owner retains control only for initial setup and treasury allocation
 * 
 * Austrian Economic Principle: Complete decentralization from launch
 * No special allocations for team/founders - they participate as equals
 */
contract TokenAllocation is Ownable, ReentrancyGuard , ICommonErrors{
    using SafeERC20 for IERC20;

    /// @notice The ERC20 token contract for allocation
    IERC20 public token;
    /// @notice Flag indicating whether the token contract has been set
    bool public tokenSet;
    /// @notice Address of the governance contract
    address public governanceContract;

    /// @notice Optional `AegisTimelockController` for delayed governance operations.
    address public timelockController;
    // Allocation percentages (in basis points for precision)
    // NO TEAM ALLOCATION - Full decentralization from launch
    /// @notice Public sale allocation percentage in basis points (50%)
    uint256 public constant PUBLIC_ALLOCATION_BP = 5000;    // 50%
    /// @notice Ecosystem rewards allocation percentage in basis points (30%)
    uint256 public constant ECOSYSTEM_ALLOCATION_BP = 3000; // 30%
    /// @notice Treasury allocation percentage in basis points (20%)
    uint256 public constant TREASURY_ALLOCATION_BP = 2000;  // 20%
    /// @notice Total basis points for percentage calculations (100%)
    uint256 public constant TOTAL_BP = 10000;               // 100%
    
    // Total supply to allocate (21M tokens)
    /// @notice Total token allocation amount (21M tokens)
    uint256 public constant TOTAL_ALLOCATION = 21_000_000 * 10**18;
    
    // Calculated allocation amounts (no team allocation)
    /// @notice Amount of tokens allocated to public sale
    uint256 public publicAllocation;
    /// @notice Amount of tokens allocated to ecosystem rewards
    uint256 public ecosystemAllocation;
    /// @notice Amount of tokens allocated to treasury
    uint256 public treasuryAllocation;
    
    // Allocation addresses (no team multisig)
    /// @notice Address of the public sale contract
    address public publicSaleContract;
    /// @notice Address of the ecosystem rewards contract
    address public ecosystemRewardsContract;
    /// @notice Address of the treasury wallet
    address public treasuryWallet;
    
    // Allocation status
    /// @notice Mapping to track completion status of each allocation type
    mapping(bytes32 => bool) private _allocationCompleted;
    bytes32 private constant _PUBLIC_KEY = keccak256("public");
    bytes32 private constant _ECOSYSTEM_KEY = keccak256("ecosystem");
    bytes32 private constant _TREASURY_KEY = keccak256("treasury");
    
    // Events
    /// @notice Emitted when an allocation address is set
    /// @param allocationType The type of allocation (public, ecosystem, treasury)
    /// @param contractAddress The address that was set for this allocation type
    event AllocationAddressSet(string indexed allocationType, address indexed contractAddress);
    /// @notice Emitted when tokens are allocated to a recipient
    /// @param allocationType The type of allocation (public, ecosystem, treasury)
    /// @param recipient The address receiving the tokens
    /// @param amount The amount of tokens allocated
    event TokensAllocated(string allocationType, address indexed recipient, uint256 indexed amount);
    /// @notice Emitted when an allocation is completed
    /// @param allocationType The type of allocation that was completed
    event AllocationCompleted(string indexed allocationType);
    
    /// @notice Emitted when emergency token recovery is performed
    /// @param recipient The address receiving the recovered tokens
    /// @param amount The amount of tokens recovered
    event EmergencyTokenRecovery(address indexed recipient, uint256 indexed amount);
    
    /// @notice Emitted when the governance contract address is updated
    /// @param oldGovernance Previous governance contract address
    /// @param newGovernance New governance contract address
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    // Errors
    error AllocationTransferFailed(bytes revertData);
    error UnknownAllocationType();

    modifier tokenMustBeSet() {
        if (!tokenSet) revert TokenNotSet();
        _;
    }
    
    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }
    
    /**
     * @notice Modifier that allows owner for initial setup, but requires governance once it's set
     * @dev Enables seamless transition from owner control to governance control
     */
    modifier onlyOwnerOrGovernance() {
        // If governance is set, only governance can call
        if (governanceContract != address(0)) {
            if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
                revert UnauthorizedAccess();
            }
        } else {
            // Before governance is set, owner can call for initial setup
            if (msg.sender != owner()) revert UnauthorizedAccess();
        }
        _;
    }

    /// @notice Register the protocol timelock (governance or owner before governance is wired).
    function setTimelockController(address newTimelock) external onlyOwnerOrGovernance {
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }
    
    /**
     * @notice Constructor to initialize the TokenAllocation contract
     * @param _initialOwner The address that will be the initial owner of the contract
     */
    constructor(address _initialOwner) Ownable(_initialOwner) {
        // Calculate allocation amounts (NO TEAM ALLOCATION)
        // 50% = 10.5M (9.5M sale + 1M liquidity)
        publicAllocation = TOTAL_ALLOCATION * PUBLIC_ALLOCATION_BP / TOTAL_BP;
        ecosystemAllocation = TOTAL_ALLOCATION * ECOSYSTEM_ALLOCATION_BP / TOTAL_BP;  // 30% = 6.3M  
        treasuryAllocation = TOTAL_ALLOCATION * TREASURY_ALLOCATION_BP / TOTAL_BP;    // 20% = 4.2M
        
        // Verify total allocation equals expected amount (should be 21M)
        uint256 totalCalculated = publicAllocation + ecosystemAllocation + treasuryAllocation;
        if (totalCalculated != TOTAL_ALLOCATION) revert AllocationMismatch();
    }
    
    /**
     * @notice Set the token contract address (can only be called once)
     * @param _token Address of the token contract
     */
    function setToken(address _token) external onlyOwner {
        if (tokenSet) revert TokenAlreadySet();
        if (_token == address(0)) revert InvalidAddress();
        
        token = IERC20(_token);
        tokenSet = true;
        
        emit AllocationAddressSet("token", _token);
    }
    
    /**
     * @notice Set the public sale contract address (governance-controlled after governance is set)
     * @param _publicSaleContract Address of the public sale contract
     * @dev Owner can set initially, but governance takes control once governance is set
     */
    function setPublicSaleContract(address _publicSaleContract) external onlyOwnerOrGovernance {
        if (_publicSaleContract == address(0)) revert InvalidAddress();
        publicSaleContract = _publicSaleContract;
        emit AllocationAddressSet("public", _publicSaleContract);
    }
    
    /**
     * @notice Set the ecosystem rewards contract address (governance-controlled after governance is set)
     * @param _ecosystemRewardsContract Address of the ecosystem rewards contract
     * @dev Owner can set initially, but governance takes control once governance is set
     */
    function setEcosystemRewardsContract(address _ecosystemRewardsContract) external onlyOwnerOrGovernance {
        if (_ecosystemRewardsContract == address(0)) revert InvalidAddress();
        ecosystemRewardsContract = _ecosystemRewardsContract;
        emit AllocationAddressSet("ecosystem", _ecosystemRewardsContract);
    }
    
    /**
     * @notice Set the treasury wallet address
     * @param _treasuryWallet Address of the treasury wallet
     */
    function setTreasuryWallet(address _treasuryWallet) external onlyOwner {
        if (_treasuryWallet == address(0)) revert InvalidAddress();
        treasuryWallet = _treasuryWallet;
        emit AllocationAddressSet("treasury", _treasuryWallet);
    }
    
    /**
     * @notice Allocate tokens to the public sale contract (governance-controlled)
     * @dev Only governance can allocate public sale tokens after governance is set
     */
    function allocatePublicTokens() external onlyOwnerOrGovernance nonReentrant tokenMustBeSet {
        if (_allocationCompleted[_PUBLIC_KEY]) revert AllocationAlreadyCompleted();
        if (publicSaleContract == address(0)) revert AllocationAddressNotSet();
        
        _allocateTokens("public", publicSaleContract, publicAllocation);
    }
    
    /**
     * @notice Allocate tokens to the ecosystem rewards contract (governance-controlled)
     * @dev Only governance can allocate ecosystem tokens after governance is set
     */
    function allocateEcosystemTokens() external onlyOwnerOrGovernance nonReentrant tokenMustBeSet {
        if (_allocationCompleted[_ECOSYSTEM_KEY]) revert AllocationAlreadyCompleted();
        if (ecosystemRewardsContract == address(0)) revert AllocationAddressNotSet();
        
        _allocateTokens("ecosystem", ecosystemRewardsContract, ecosystemAllocation);
    }
    
    /**
     * @notice Allocate tokens to the treasury wallet (owner-controlled exception)
     * @dev Treasury allocation is the only exception - always owner-controlled for development fund
     */
    function allocateTreasuryTokens() external onlyOwner tokenMustBeSet {
        if (_allocationCompleted[_TREASURY_KEY]) revert AllocationAlreadyCompleted();
        if (treasuryWallet == address(0)) revert AllocationAddressNotSet();
        
        _allocateTokens("treasury", treasuryWallet, treasuryAllocation);
    }
    
    /**
     * @notice Allocate all tokens at once (convenience function)
     * @dev Public and ecosystem allocations are governance-controlled, treasury is owner-controlled
     * @dev Governance can allocate public/ecosystem, owner can allocate treasury
     * @dev CRITICAL: Added nonReentrant to prevent reentrancy attacks
     */
    function allocateAllTokens() external nonReentrant tokenMustBeSet {
        // CRITICAL SECURITY: Apply CEI pattern strictly - batch all state updates before any external calls
        // This prevents reentrancy attacks where state could be read inconsistently between allocations
        
        // Phase 1: CHECKS - Validate all allocations upfront
        bool shouldAllocatePublic = !_allocationCompleted[_PUBLIC_KEY] && publicSaleContract != address(0);
        bool shouldAllocateEcosystem = !_allocationCompleted[_ECOSYSTEM_KEY] && ecosystemRewardsContract != address(0);
        bool shouldAllocateTreasury = !_allocationCompleted[_TREASURY_KEY] && treasuryWallet != address(0);
        
        // Validate access for all allocations
        if (shouldAllocatePublic) {
            if (governanceContract != address(0)) {
                if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
                    revert UnauthorizedAccess();
                }
            } else {
                if (msg.sender != owner()) revert UnauthorizedAccess();
            }
        }
        if (shouldAllocateEcosystem) {
            if (governanceContract != address(0)) {
                if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
                    revert UnauthorizedAccess();
                }
            } else {
                if (msg.sender != owner()) revert UnauthorizedAccess();
            }
        }
        if (shouldAllocateTreasury) {
            if (msg.sender != owner()) revert UnauthorizedAccess();
        }
        
        // Phase 2: EFFECTS - Update all state BEFORE any external interactions
        // This ensures atomic state updates and prevents reentrancy issues
        if (shouldAllocatePublic) {
            _allocationCompleted[_PUBLIC_KEY] = true;
        }
        if (shouldAllocateEcosystem) {
            _allocationCompleted[_ECOSYSTEM_KEY] = true;
        }
        if (shouldAllocateTreasury) {
            _allocationCompleted[_TREASURY_KEY] = true;
        }
        
        // Phase 3: INTERACTIONS - Execute all external calls AFTER state updates
        // If any transfer fails, revert will automatically undo all state changes
        if (shouldAllocatePublic) {
            _executeTransfer(publicSaleContract, publicAllocation, "public");
        }
        if (shouldAllocateEcosystem) {
            _executeTransfer(ecosystemRewardsContract, ecosystemAllocation, "ecosystem");
        }
        if (shouldAllocateTreasury) {
            _executeTransfer(treasuryWallet, treasuryAllocation, "treasury");
        }
    }
    
    /**
     * @notice Internal function to execute token transfer (state already updated in allocateAllTokens)
     * @param recipient Address to receive the tokens
     * @param amount Amount of tokens to allocate
     * @param allocationType Type of allocation (for events)
     * @dev CRITICAL: This function only handles the transfer - state updates happen in allocateAllTokens
     *      This separation ensures strict CEI pattern compliance
     */
    function _executeTransfer(address recipient, uint256 amount, string memory allocationType) internal {
        // CHECKS: Validate inputs
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        
        uint256 contractBalance = token.balanceOf(address(this));
        if (contractBalance < amount) revert InsufficientTokenBalance();
        
        // INTERACTIONS: Execute transfer (state already updated in allocateAllTokens)
        // CRITICAL: If transfer fails, revert will automatically undo all state changes
        _safeTokenTransfer(recipient, amount);
        
        emit TokensAllocated(allocationType, recipient, amount);
        emit AllocationCompleted(allocationType);
    }
    
    /**
     * @notice Internal function to handle token allocation (for individual allocation functions)
     * @param allocationType Type of allocation (team, public, ecosystem, treasury)
     * @param recipient Address to receive the tokens
     * @param amount Amount of tokens to allocate
     * @dev CRITICAL: Follows CEI pattern - Checks, Effects, Interactions
     *      This function is used by individual allocation functions (allocatePublicTokens, etc.)
     */
    function _allocateTokens(string memory allocationType, address recipient, uint256 amount) internal {
        // CHECKS: Validate inputs and state
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        
        uint256 contractBalance = token.balanceOf(address(this));
        if (contractBalance < amount) revert InsufficientTokenBalance();

        bytes32 key = _resolveAllocationKey(allocationType);
        if (_allocationCompleted[key]) revert AllocationAlreadyCompleted();
        
        // EFFECTS: Update state BEFORE external interactions (CEI pattern)
        _allocationCompleted[key] = true;
        
        // INTERACTIONS: External call AFTER state update (CEI pattern)
        // CRITICAL: If transfer fails, revert will automatically undo state change
        _safeTokenTransfer(recipient, amount);
        
        emit TokensAllocated(allocationType, recipient, amount);
        emit AllocationCompleted(allocationType);
    }
    
    /**
     * @notice Get allocation information
     * @return publicAmount Amount allocated to public sale (50% = 10.5M)
     * @return ecosystemAmount Amount allocated to ecosystem rewards (30% = 6.3M)
     * @return treasuryAmount Amount allocated to treasury (20% = 4.2M)
     */
    function getAllocationAmounts() external view returns (
        uint256 publicAmount,
        uint256 ecosystemAmount,
        uint256 treasuryAmount
    ) {
        return (publicAllocation, ecosystemAllocation, treasuryAllocation);
    }
    
    /**
     * @notice Get allocation status
     * @return publicCompleted Whether public allocation is completed
     * @return ecosystemCompleted Whether ecosystem allocation is completed
     * @return treasuryCompleted Whether treasury allocation is completed
     */
    function getAllocationStatus() external view returns (
        bool publicCompleted,
        bool ecosystemCompleted,
        bool treasuryCompleted
    ) {
        return (
            _allocationCompleted[_PUBLIC_KEY],
            _allocationCompleted[_ECOSYSTEM_KEY],
            _allocationCompleted[_TREASURY_KEY]
        );
    }

    /**
     * @notice Returns completion status for a specific allocation tranche.
     * @param allocationType_ The allocation tranche identifier ("public", "ecosystem", or "treasury").
     * @return completed True if the specified allocation has already been distributed.
     */
    function allocationCompleted(string calldata allocationType_) external view returns (bool completed) {
        return _allocationCompleted[_resolveAllocationKey(allocationType_)];
    }
    
    /**
     * @notice Performs a transfer compatible with both allocation-aware tokens and plain ERC20 tokens.
     * @dev Attempts allocationTransfer; if the selector is absent, falls back to transfer.
     * @param recipient Address receiving the tokens.
     * @param amount Amount of tokens to transfer.
     */
    function _safeTokenTransfer(address recipient, uint256 amount) internal {
        try IAllocationToken(address(token)).allocationTransfer(recipient, amount) returns (bool handled) {
            if (!handled) revert TokenTransferFailed();
            return;
        } catch (bytes memory reason) {
            if (reason.length > 0) {
                revert AllocationTransferFailed(reason);
            }
        }

        token.safeTransfer(recipient, amount);
    }
    
    /**
     * @notice Sets the governance contract address
     * @dev Owner can set initially, governance can update after it's set
     * @param _governanceContract Address of the governance contract
     */
    function setGovernanceContract(address _governanceContract) external {
        if (_governanceContract == address(0)) revert InvalidAddress();
        
        // If governance is already set, only governance (facade, core, or timelock) can update it
        if (governanceContract != address(0)) {
            if (!GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, msg.sender)) {
                revert UnauthorizedAccess();
            }
        } else {
            // Initial setup - only owner can set
            if (msg.sender != owner()) revert UnauthorizedAccess();
        }
        
        address oldGovernance = governanceContract;
        governanceContract = _governanceContract;
        emit GovernanceUpdated(oldGovernance, _governanceContract);
    }

    /**
     * @notice Normalizes allocation identifiers to their internal storage key.
     * @param allocationType_ The textual allocation identifier supplied by external callers.
     * @return key The keccak256 hash used internally for allocation tracking.
     */
    function _resolveAllocationKey(string memory allocationType_) private pure returns (bytes32) {
        bytes32 key = keccak256(bytes(allocationType_));
        if (key == _PUBLIC_KEY || key == _ECOSYSTEM_KEY || key == _TREASURY_KEY) {
            return key;
        }
        revert UnknownAllocationType();
    }
    
    /**
     * @notice Emergency function to recover any remaining tokens (governance only)
     * @dev Only governance can recover tokens to maintain decentralization
     * @param recipient Address to receive the remaining tokens
     */
    function emergencyRecoverTokens(address recipient) external onlyGovernance {
        if (recipient == address(0)) revert InvalidAddress();
        
        uint256 remainingBalance = token.balanceOf(address(this));
        if (remainingBalance > 0) {
            token.safeTransfer(recipient, remainingBalance);
            emit EmergencyTokenRecovery(recipient, remainingBalance);
        }
    }
}