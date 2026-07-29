// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {PoolPriceValidator} from "../liquidity/PoolPriceValidator.sol";
import {IPublicLiquidityPool} from "../liquidity/IPublicLiquidityPool.sol";

/**
 * @title TreasuryLiquidityAllocator
 * @notice Governance-controlled router that allocates treasury balances into public liquidity pools.
 *         Supports both native SONIC and ERC-20 quote pools, wraps/unwinds native liquidity as needed,
 *         and centralises custody of LP tokens for downstream governance decisions.
 */
contract TreasuryLiquidityAllocator is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Address for address payable;

    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    IERC20 public immutable agsToken;
    IERC20 public immutable wrappedNativeToken;
    
    /// @notice Optional price validator for oracle-based validation (can be address(0))
    PoolPriceValidator public priceValidator;

    /// @notice Emitted when liquidity is seeded into a public pool
    event PublicLiquiditySeeded(
        address indexed pool,
        address indexed quoteToken,
        bool quoteIsNative,
        uint256 agsAmount,
        uint256 quoteAmount,
        address lpRecipient,
        uint256 minShares
    );

    /// @notice Emitted when governance rescues tokens from the allocator
    event TreasuryRescue(address indexed token, address indexed recipient, uint256 amount);

    /// @notice Emitted when native SONIC is received directly
    event NativeReceived(address indexed sender, uint256 amount);

    /// @notice Emitted when native SONIC is wrapped into wS
    event NativeWrapped(uint256 amount);

    /// @notice Emitted when wS is unwrapped into native SONIC
    event NativeUnwrapped(uint256 amount, address indexed recipient);

    struct Allocation {
        address pool;
        uint256 agsAmount;
        uint256 quoteAmount;
        uint256 minShares;
        address lpRecipient;
    }

    constructor(
        address admin,
        address agsToken_,
        address wrappedNative_,
        address priceValidator_
    ) {
        require(admin != address(0), "allocator: admin required");
        require(agsToken_ != address(0), "allocator: ags token required");
        require(wrappedNative_ != address(0), "allocator: wrapped token required");

        agsToken = IERC20(agsToken_);
        wrappedNativeToken = IERC20(wrappedNative_);
        priceValidator = PoolPriceValidator(priceValidator_); // Can be address(0) for no validation

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
    }

    /**
     * @notice Set price validator address (can be set to address(0) to disable)
     * @param validator Address of PoolPriceValidator contract
     */
    function setPriceValidator(address validator) external onlyRole(GOVERNANCE_ROLE) {
        priceValidator = PoolPriceValidator(validator);
    }

    receive() external payable {
        emit NativeReceived(msg.sender, msg.value);
    }

    /**
     * @notice Wrap native SONIC held by the allocator into wS.
     * @param amount The amount of native SONIC (in wei) to wrap.
     * @dev SECURITY: Only governance can call this. Destination is immutable wrapped native contract.
     *      Slither warning about "arbitrary destination" is false positive - destination is fixed and trusted.
     */
    function wrapNative(uint256 amount) external onlyRole(GOVERNANCE_ROLE) nonReentrant {
        require(amount > 0, "allocator: zero amount");
        require(address(this).balance >= amount, "allocator: insufficient native");
        // slither-disable-next-line arbitrary-send-eth
        // False positive: wrappedNativeToken is immutable and trusted (set at construction)
        _wrappedNative().deposit{value: amount}();
        emit NativeWrapped(amount);
    }

    /**
     * @notice Unwrap wS held by the allocator back into native SONIC.
     * @param amount The amount of wS to unwrap.
     * @param recipient The address that should receive the native SONIC.
     */
    function unwrapNative(uint256 amount, address payable recipient) external onlyRole(GOVERNANCE_ROLE) nonReentrant {
        require(amount > 0, "allocator: zero amount");
        require(recipient != address(0), "allocator: invalid recipient");

        _wrappedNative().withdraw(amount);

        recipient.sendValue(amount);
        emit NativeUnwrapped(amount, recipient);
    }

    /**
     * @notice Seed one or more public liquidity pools using treasury balances.
     * @param allocations Array of allocation instructions.
     */
    function seedPublicPools(Allocation[] calldata allocations) external onlyRole(GOVERNANCE_ROLE) nonReentrant {
        require(allocations.length > 0, "allocator: no allocations");

        for (uint256 i = 0; i < allocations.length; i++) {
            _seedSinglePool(allocations[i]);
        }
    }

    /**
     * @notice Rescue ERC-20 tokens (including LP tokens) to a governance recipient.
     * @param token The ERC-20 token address.
     * @param recipient Destination address.
     * @param amount Amount to transfer.
     */
    function rescueToken(address token, address recipient, uint256 amount) external onlyRole(GOVERNANCE_ROLE) {
        require(token != address(0), "allocator: token required");
        require(recipient != address(0), "allocator: recipient required");
        require(amount > 0, "allocator: zero amount");

        IERC20(token).safeTransfer(recipient, amount);
        emit TreasuryRescue(token, recipient, amount);
    }

    /**
     * @notice Rescue native SONIC to a governance recipient.
     * @param recipient Address that should receive the native funds.
     * @param amount Amount of native SONIC (wei) to transfer.
     */
    function rescueNative(address payable recipient, uint256 amount) external onlyRole(GOVERNANCE_ROLE) nonReentrant {
        require(recipient != address(0), "allocator: recipient required");
        require(amount > 0, "allocator: zero amount");
        require(address(this).balance >= amount, "allocator: insufficient native");

        recipient.sendValue(amount);
        emit TreasuryRescue(address(0), recipient, amount);
    }

    function _seedSinglePool(Allocation calldata allocation) internal {
        require(allocation.pool != address(0), "allocator: pool required");
        require(allocation.agsAmount > 0, "allocator: ags required");
        require(allocation.quoteAmount > 0, "allocator: quote required");

        // Validate price against oracle if validator is configured
        if (address(priceValidator) != address(0)) {
            try priceValidator.validateSeedingPrice(
                allocation.pool,
                allocation.agsAmount,
                allocation.quoteAmount
            ) {
                // Validation passed, continue
            } catch {
                // Validation failed, revert with clear error
                revert("allocator: price deviation too high");
            }
        }

        IPublicLiquidityPool pool = IPublicLiquidityPool(allocation.pool);
        address recipient = allocation.lpRecipient == address(0) ? address(this) : allocation.lpRecipient;

        // Prepare AGS allowance
        uint256 currentAgsAllowance = agsToken.allowance(address(this), allocation.pool);
        if (currentAgsAllowance > 0) {
            agsToken.safeDecreaseAllowance(allocation.pool, currentAgsAllowance);
        }
        agsToken.safeIncreaseAllowance(allocation.pool, allocation.agsAmount);

        bool quoteIsNative = pool.quoteIsNative();
        address quoteTokenAddress = pool.quoteToken();

        if (quoteIsNative) {
            _ensureNativeLiquidity(allocation.quoteAmount);
            // slither-disable-next-line arbitrary-send-eth
            // False positive: pool address is validated, only governance can call, recipient is validated
            pool.addLiquidity{value: allocation.quoteAmount}(
                allocation.agsAmount,
                allocation.quoteAmount,
                allocation.minShares,
                recipient
            );
        } else {
            IERC20 quoteToken = IERC20(quoteTokenAddress);
            uint256 currentQuoteAllowance = quoteToken.allowance(address(this), allocation.pool);
            if (currentQuoteAllowance > 0) {
                quoteToken.safeDecreaseAllowance(allocation.pool, currentQuoteAllowance);
            }
            quoteToken.safeIncreaseAllowance(allocation.pool, allocation.quoteAmount);

            pool.addLiquidity(
                allocation.agsAmount,
                allocation.quoteAmount,
                allocation.minShares,
                recipient
            );

            uint256 remainingQuoteAllowance = quoteToken.allowance(address(this), allocation.pool);
            if (remainingQuoteAllowance > 0) {
                quoteToken.safeDecreaseAllowance(allocation.pool, remainingQuoteAllowance);
            }
        }

        // Reset AGS allowance for safety
        uint256 remainingAgsAllowance = agsToken.allowance(address(this), allocation.pool);
        if (remainingAgsAllowance > 0) {
            agsToken.safeDecreaseAllowance(allocation.pool, remainingAgsAllowance);
        }

        emit PublicLiquiditySeeded(
            allocation.pool,
            quoteTokenAddress,
            quoteIsNative,
            allocation.agsAmount,
            allocation.quoteAmount,
            recipient,
            allocation.minShares
        );
    }

    function _ensureNativeLiquidity(uint256 required) internal {
        if (address(this).balance >= required) {
            return;
        }

        uint256 shortfall = required - address(this).balance;
        require(wrappedNativeToken.balanceOf(address(this)) >= shortfall, "allocator: insufficient native liquidity");
        _wrappedNative().withdraw(shortfall);
    }

    function         _wrappedNative() internal view returns (IWrappedNative) {
        return IWrappedNative(address(wrappedNativeToken));
    }
}

interface IWrappedNative {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

