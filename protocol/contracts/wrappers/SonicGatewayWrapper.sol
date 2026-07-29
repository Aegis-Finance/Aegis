// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PrivateTokenContract} from "../PrivateTokenContract.sol";
import {ICommonErrors} from "../interfaces/ICommonErrors.sol";
import {GovernanceAccessLib} from "../libraries/GovernanceAccessLib.sol";

/**
 * @title SonicGatewayWrapper
 * @author Aegis Protocol Team
 * @notice Wrapper contract that integrates Sonic Gateway with Aegis privacy ecosystem
 * @dev Converts standard tokens bridged via Sonic Gateway into private commitments.
 *
 * **Sonic Gateway (official user flow):** deposit → heartbeat → claim (incl. Fast Lane, fail-safe); see
 * [Sonic Gateway](https://docs.soniclabs.com/sonic/sonic-gateway).
 *
 * **Programmatic integration (canonical contract snippet):** the `ETH_*` and `SONIC_*` addresses below are the same
 * keys as `ETH_CONTRACTS` / `SONIC_CONTRACTS` in Sonic Labs’
 * [Programmatic Gateway](https://docs.soniclabs.com/sonic/build-on-sonic/programmatic-gateway) guide
 * (TokenDeposit, TokenPairs, StateOracle on Ethereum; Bridge, TokenPairs, StateOracle on Sonic)—not guessed.
 * Cross-check the live “Gateway infrastructure” tables in
 * [Contract addresses](https://docs.soniclabs.com/sonic/build-on-sonic/contract-addresses) and on
 * [Sonicscan](https://sonicscan.org/) before changing constants after any Sonic deploy update.
 *
 * FLOW (Aegis layer only):
 * 1. User bridges standard ERC-20 token from Ethereum → Sonic via Sonic Gateway
 * 2. Token arrives on Sonic as standard (non-private) token
 * 3. User calls this wrapper to convert to private commitment
 * 4. Token is shielded into Aegis privacy ecosystem
 *
 * **Governance-gated admin:** token list / fee / governance updates accept either `msg.sender == governanceContract`
 * or `msg.sender == PrivateGovernance(governanceContract).owner()` so deploy tooling can bootstrap before any
 * proposal-driven executor is wired.
 */
contract SonicGatewayWrapper is ReentrancyGuard, ICommonErrors {
    using SafeERC20 for IERC20;

    /// @notice Ethereum mainnet Gateway infrastructure (Sonic docs: “Gateway Infrastructure (on Ethereum)”)
    /// @dev Reference constants for integrators / future proofs; `convertToPrivate` does not call these.
    address private constant ETH_TOKEN_DEPOSIT = 0xa1E2481a9CD0Cb0447EeB1cbc26F1b3fff3bec20;
    address private constant ETH_TOKEN_PAIRS = 0xf2b1510c2709072C88C5b14db90Ec3b6297193e4;
    address private constant ETH_STATE_ORACLE = 0xB7e8CC3F5FeA12443136f0cc13D81F109B2dEd7f;

    /// @notice Sonic mainnet Gateway infrastructure (Sonic docs: “Gateway Infrastructure (on Sonic)”)
    address public constant SONIC_BRIDGE = 0x9Ef7629F9B930168b76283AdD7120777b3c895b3;
    address public constant SONIC_TOKEN_PAIRS = 0x134E4c207aD5A13549DE1eBF8D43c1f49b00ba94;
    address public constant SONIC_STATE_ORACLE = 0x836664B0c0CB29B7877bCcF94159CC996528F2C3;

    /// @notice Core Aegis private token contract
    PrivateTokenContract public immutable PRIVATE_TOKEN;

    /// @notice Governance contract address
    address public governanceContract;

    /// @notice Optional `AegisTimelockController` for delayed gateway admin.
    address public timelockController;

    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);

    /// @notice Mapping of supported ERC-20 tokens that can be bridged and converted
    mapping(address => bool) public supportedTokens;

    /// @notice Mapping to track conversion rates (if needed for token swaps)
    /// @dev For direct AGS conversion, rate is 1:1
    mapping(address => uint256) public conversionRates; // Rate in basis points (10000 = 1:1)

    /// @notice Minimum amount required for conversion
    uint256 public constant MIN_CONVERSION_AMOUNT = 1e18; // 1 token minimum

    /// @notice Maximum amount per conversion (safety limit)
    uint256 public constant MAX_CONVERSION_AMOUNT = 1_000_000e18; // 1M tokens max

    /// @notice Conversion fee in basis points (0.1% default)
    uint256 public conversionFeeBps = 10; // 0.1%

    /// @notice Fee recipient address
    address public feeRecipient;

    // Events
    /// @notice Emitted when a token is converted from standard to private commitment
    /// @param user Address that initiated the conversion
    /// @param token Address of the source token
    /// @param amount Amount converted
    /// @param commitment Private commitment created
    /// @param fee Fee charged for conversion
    event TokenConverted(
        address indexed user,
        address indexed token,
        uint256 indexed amount,
        bytes32 commitment,
        uint256 fee
    );

    /// @notice Emitted when a new token is added to supported list
    /// @param token Address of the token
    /// @param conversionRate Conversion rate in basis points
    event TokenSupported(address indexed token, uint256 conversionRate);

    /// @notice Emitted when a token is removed from supported list
    /// @param token Address of the token
    event TokenRemoved(address indexed token);

    /// @notice Emitted when conversion fee is updated
    /// @param oldFee Old fee in basis points
    /// @param newFee New fee in basis points
    event ConversionFeeUpdated(uint256 indexed oldFee, uint256 indexed newFee);

    /// @notice Emitted when fee recipient is updated
    /// @param oldRecipient Old fee recipient
    /// @param newRecipient New fee recipient
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    /// @notice Emitted when governance is updated
    /// @param oldGovernance Old governance address
    /// @param newGovernance New governance address
    event GovernanceUpdated(address indexed oldGovernance, address indexed newGovernance);

    // Errors (using ICommonErrors for common ones)
    error TokenNotSupported();

    /// @notice Public inputs for `shield` do not match this conversion (commitment, net amount, or depositor)
    error ShieldPublicInputsMismatch();

    /**
     * @notice Who may call governance-gated functions on this wrapper
     * @dev `governanceContract` is the `PrivateGovernance` facade. That contract does not forward arbitrary
     *      admin calls here, so we also allow its **`owner()`** (deployer until ownership is transferred to
     *      timelock/DAO) to run initial `addSupportedToken` / fee wiring from the orchestrator. Once the DAO
     *      owns `PrivateGovernance`, prefer executing changes through governance proposals or a dedicated
     *      executor contract if you set `governanceContract` to that executor.
     */
    function _isGovernanceAuthorized(address account) internal view returns (bool) {
        if (GovernanceAccessLib.isGovernanceTimelockOrCore(governanceContract, timelockController, account)) {
            return true;
        }
        address gov = governanceContract;
        if (gov.code.length == 0) return false;
        (bool ok, bytes memory ret) = gov.staticcall(abi.encodeWithSignature("owner()"));
        if (!ok || ret.length < 32) return false;
        address own = abi.decode(ret, (address));
        return own != address(0) && account == own;
    }

    function setTimelockController(address newTimelock) external {
        if (!_isGovernanceAuthorized(msg.sender)) revert UnauthorizedAccess();
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }

    modifier onlyGovernance() {
        if (!_isGovernanceAuthorized(msg.sender)) revert UnauthorizedAccess();
        _;
    }

    /**
     * @notice Initializes the SonicGatewayWrapper contract
     * @param _privateToken Address of the PrivateTokenContract
     * @param _governance Address of the governance contract
     * @param _feeRecipient Address to receive conversion fees
     */
    constructor(
        address _privateToken,
        address _governance,
        address _feeRecipient
    ) {
        if (_privateToken == address(0)) revert InvalidAddress();
        if (_governance == address(0)) revert InvalidOracleAddress();
        if (_feeRecipient == address(0)) revert InvalidAddress();

        PRIVATE_TOKEN = PrivateTokenContract(_privateToken);
        governanceContract = _governance;
        feeRecipient = _feeRecipient;

        emit GovernanceUpdated(address(0), _governance);
        emit FeeRecipientUpdated(address(0), _feeRecipient);
    }

    /**
     * @notice Converts standard ERC-20 token (bridged via Sonic Gateway) to private commitment
     * @dev User must approve this contract to spend their tokens first. Caller supplies a **mint-optimized** Groth16 proof
     *      whose public inputs match `PrivateTokenContract.shield`: `[depositNullifier, outputCommitment, amount, depositor]`.
     *      Here `depositor` **must** be `address(this)` because tokens are pulled to the wrapper before `shield` debits
     *      the wrapper's transparent balance. `outputCommitment` must equal `commitment`, and `amount` must equal `netAmount`
     *      after rate and fee (client should compute `netAmount` identically to this function).
     * @param token Address of the ERC-20 token to convert
     * @param amount Amount of tokens to convert
     * @param commitment Private commitment hash to receive the shielded tokens
     * @param proof Packed mint-optimized Groth16 proof (8 uint256)
     * @param publicInputs Four public signals for the mint circuit
     * @return success True if conversion succeeded
     */
    function convertToPrivate(
        address token,
        uint256 amount,
        bytes32 commitment,
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant returns (bool success) {
        if (!supportedTokens[token]) revert TokenNotSupported();
        if (amount < MIN_CONVERSION_AMOUNT) revert InvalidAmount();
        if (amount > MAX_CONVERSION_AMOUNT) revert InvalidAmount();
        if (commitment == bytes32(0)) revert InvalidAmount();

        IERC20 tokenContract = IERC20(token);

        // Enforce AGS-only path before any pull — avoids trapping arbitrary supported ERC-20s
        // in this contract if governance ever misconfigured `supportedTokens`.
        if (token != address(PRIVATE_TOKEN)) {
            revert TokenNotSupported();
        }

        // Check user has sufficient balance and allowance
        if (tokenContract.balanceOf(msg.sender) < amount) revert InsufficientBalance();
        if (tokenContract.allowance(msg.sender, address(this)) < amount) revert InsufficientBalance();

        // Calculate conversion amount (apply rate if not 1:1)
        uint256 conversionRate = conversionRates[token];
        uint256 convertedAmount = (amount * conversionRate) / 10000;

        // Calculate fee
        uint256 fee = (convertedAmount * conversionFeeBps) / 10000;
        uint256 netAmount = convertedAmount - fee;

        // Transfer tokens from user to this contract
        tokenContract.safeTransferFrom(msg.sender, address(this), amount);

        if (publicInputs.length != 4) revert InvalidInputLength();
        if (bytes32(publicInputs[1]) != commitment) revert ShieldPublicInputsMismatch();
        if (publicInputs[2] != netAmount) revert ShieldPublicInputsMismatch();
        if (publicInputs[3] != uint256(uint160(address(this)))) revert ShieldPublicInputsMismatch();

        // Shield into private commitment (debits wrapper transparent balance)
        PRIVATE_TOKEN.shield(proof, publicInputs);

        // Transfer fee to fee recipient if any
        if (fee > 0) {
            if (!PRIVATE_TOKEN.transfer(feeRecipient, fee)) {
                revert TokenTransferFailed();
            }
        }

        emit TokenConverted(msg.sender, token, amount, commitment, fee);
        return true;
    }

    /**
     * @notice Adds a new token to the supported list (governance only)
     * @param token Address of the token to support
     * @param conversionRate Conversion rate in basis points (10000 = 1:1)
     */
    function addSupportedToken(address token, uint256 conversionRate) external onlyGovernance {
        if (token == address(0)) revert InvalidAddress();
        if (conversionRate == 0 || conversionRate > 20000) revert InvalidAmount(); // Max 2:1

        supportedTokens[token] = true;
        conversionRates[token] = conversionRate;

        emit TokenSupported(token, conversionRate);
    }

    /**
     * @notice Removes a token from the supported list (governance only)
     * @param token Address of the token to remove
     */
    function removeSupportedToken(address token) external onlyGovernance {
        if (token == address(0)) revert InvalidAddress();

        supportedTokens[token] = false;
        conversionRates[token] = 0;

        emit TokenRemoved(token);
    }

    /**
     * @notice Updates the conversion fee (governance only)
     * @param newFeeBps New fee in basis points (max 100 = 1%)
     */
    function setConversionFee(uint256 newFeeBps) external onlyGovernance {
        if (newFeeBps > 100) revert InvalidAmount(); // Max 1%

        uint256 oldFee = conversionFeeBps;
        conversionFeeBps = newFeeBps;

        emit ConversionFeeUpdated(oldFee, newFeeBps);
    }

    /**
     * @notice Updates the fee recipient address (governance only)
     * @param newRecipient New fee recipient address
     */
    function setFeeRecipient(address newRecipient) external onlyGovernance {
        if (newRecipient == address(0)) revert InvalidAddress();

        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;

        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /**
     * @notice Updates the governance contract address (governance only)
     * @param newGovernance New governance contract address
     */
    function setGovernance(address newGovernance) external onlyGovernance {
        if (newGovernance == address(0)) revert InvalidOracleAddress();

        address oldGovernance = governanceContract;
        governanceContract = newGovernance;

        emit GovernanceUpdated(oldGovernance, newGovernance);
    }

    /**
     * @notice Checks if a token is supported for conversion
     * @param token Address of the token to check
     * @return True if token is supported
     */
    function isTokenSupported(address token) external view returns (bool) {
        return supportedTokens[token];
    }

    /**
     * @notice Gets conversion information for a token
     * @param token Address of the token
     * @return supported Whether token is supported
     * @return rate Conversion rate in basis points
     * @return feeBps Conversion fee in basis points
     */
    function getConversionInfo(address token)
        external
        view
        returns (bool supported, uint256 rate, uint256 feeBps)
    {
        return (supportedTokens[token], conversionRates[token], conversionFeeBps);
    }

    /**
     * @notice Emergency function to recover tokens stuck in contract (governance only)
     * @param token Address of the token to recover
     * @param amount Amount to recover
     * @param to Address to send recovered tokens
     */
    function recoverTokens(address token, uint256 amount, address to) external onlyGovernance {
        if (to == address(0)) revert InvalidAddress();
        
        IERC20(token).safeTransfer(to, amount);
    }
}

