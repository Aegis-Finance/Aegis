// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {CommitmentLib} from "./libraries/CommitmentLib.sol";
import {ProofLib} from "./libraries/ProofLib.sol";
import {IVerifierFactory} from "./interfaces/IVerifierFactory.sol";
import {ICommonErrors} from "./interfaces/ICommonErrors.sol";
import {GovernanceAccessLib} from "./libraries/GovernanceAccessLib.sol";

// Custom errors for gas optimization

/**
 * @title PrivateTokenContract
 * @author Aegis Protocol Team
 * @notice **ZK-native AGS:** shielded commitments are the **primary** rail for user wealth and protocol semantics; transparent
 *         balances exist only where distribution or a **labeled public compatibility primitive** (e.g. canonical AMM) requires
 *         ERC-20 compatibility. Engineering obligation: **maximize stealth wherever proofs allow**—see monorepo
 *         `docs/AGS_MAXIMUM_STEALTH_MASTER_PLAN.md` (Charter + indexing boundaries).
 * @dev ZK-first posture:
 *      - `publicEntryEnabled`: when `false`, only `authorizedContracts` may call `shield` / `shieldedTransfer` /
 *        transparent exit (`unshield`) (use a trusted privacy entry router, then flip via `setPublicEntryEnabled`). `shield` requires a **mint-optimized** proof.
 *      - `permissionlessTransparentTransfers`: when `false`, only `authorizedContracts` may call `transfer` / `transferFrom`
 *        on transparent balances—blocks casual wallet-to-wallet leaks while still allowing allowlisted routers (e.g. Uniswap
 *        `SwapRouter`) to move liquidity. **Authorize every protocol contract that pays users or pools in transparent AGS**
 *        before disabling permissionless transfers.
 *      - **`shield` semantics:** transparent → commitment via **`mint-optimized`** proof with **`depositor` as a public signal** (see `circuits/mint-optimized.circom`) — **not** wallet-anonymous to global observers; the identifier is API-stable **shield**. Product copy: **shield into commitments**, not **anonymous deposit**. Ops: [`docs/ops/PRIVATE_TOKEN_STEALTH_TIGHTENING_PLAYBOOK.md`](../docs/ops/PRIVATE_TOKEN_STEALTH_TIGHTENING_PLAYBOOK.md), [`docs/PRIVATE_TOKEN_ONCHAIN_EVENTS_DISCLOSURE.md`](../docs/PRIVATE_TOKEN_ONCHAIN_EVENTS_DISCLOSURE.md).
 *      - **Fixed supply:** the full `21_000_000e18` AGS is created once in the constructor on the allocation address; `totalSupply`
 *        does not increase afterward. There is **no** ERC20-style `mint` on this contract. Other modules must **never** assume
 *        inflationary mint for liquidity—they must move existing AGS via transparent transfers, **`shield` (mint proof)** /
 *        transparent exit (`unshield`) / ZK paths,
 *        or `transferToPoolInternal` / `transferFromPool` when authorized.
 */
contract PrivateTokenContract is Ownable, ReentrancyGuard, Pausable, ICommonErrors {
    using CommitmentLib for CommitmentLib.Commitment;
    using ProofLib for ProofLib.ZKProof;
    using EnumerableSet for EnumerableSet.AddressSet;
    
    // Token metadata
    /// @notice The name of the token
    string public constant NAME = "Aegis Token";
    /// @notice The symbol of the token
    string public constant SYMBOL = "AGS";
    /// @notice The number of decimals for the token
    uint8 public constant DECIMALS = 18;
    
    // Austrian Economic Principles - Sound Money Implementation
    /// @notice Maximum supply cap - implements Rothbard's fixed money supply principle
    /// @dev "The gold standard alone makes the determination of money's purchasing power 
    ///      independent of the ambitions and machinations of governments" - Ludwig von Mises
    uint256 public constant MAX_SUPPLY = 21_000_000 * 10**18; // 21M tokens like Bitcoin
    
    /// @notice Initial supply for fair distribution
    uint256 public constant INITIAL_SUPPLY = 21_000_000 * 10**18; // Match total allocation supply
    
    // Burn mechanism removed for better user experience and utility
    // Fixed supply of 21M tokens provides scarcity without transaction friction
    
    /// @notice Total supply of AGS tokens in circulation
    uint256 public totalSupply;
    
    // Verifier configuration struct to reduce state variable count
    /// @notice Configuration for ZK proof verifiers
    struct VerifierConfig {
        IVerifierFactory factory;
        address transfer;
        address mint;
    }
    
    /// @notice Verifier configuration instance
    VerifierConfig public verifiers;

    /// @notice When true, any EOA may call `shield`, `shieldedTransfer`, and transparent exit (`unshield`). When false, only `authorizedContracts` may.
    bool public publicEntryEnabled;

    /// @notice When true, any holder may use `transfer` / `transferFrom` on transparent balances. When false, only
    ///         `authorizedContracts` may initiate those calls (EOAs use shielded rails or protocol routers you authorize).
    bool public permissionlessTransparentTransfers;

    /// @notice Emitted when governance toggles permissionless entry to shield / shieldedTransfer / transparent exit (`unshield`)
    event PublicEntryEnabledUpdated(bool enabled);
    /// @notice Emitted when governance toggles permissionless transparent ERC20-style moves
    event PermissionlessTransparentTransfersUpdated(bool enabled);
    
    // Circuit types for different operations
    /// @notice Circuit type identifier for transfer operations
    string public constant TRANSFER_CIRCUIT = "transfer-optimized";
    /// @notice Circuit type identifier for mint operations
    string public constant MINT_CIRCUIT = "mint-optimized";
    /// @notice Circuit type for EOA `unshield` (4 public signals; see `transfer-unshield.circom`)
    string public constant TRANSFER_UNSHIELD_CIRCUIT = "transfer-unshield";
    /// @notice Circuit type for `shieldedTransfer` (**11** public signals; see `shielded-transfer.circom`)
    string public constant SHIELDED_TRANSFER_CIRCUIT = "shielded-transfer";
    /// @notice `transferToPool` dedicated verifier (`transfer-to-pool.circom`, 4 public)
    string public constant TRANSFER_TO_POOL_CIRCUIT = "transfer-to-pool";
    /// @notice `transferFromCollateral` / `transferBetweenCommitments` (`transfer-commitment-internal.circom`)
    string public constant TRANSFER_COMMITMENT_INTERNAL_CIRCUIT = "transfer-commitment-internal";
    /// @notice `lockCollateral` / `unlockCollateral` (`transfer-commitment-action.circom`)
    string public constant TRANSFER_COMMITMENT_ACTION_CIRCUIT = "transfer-commitment-action";

    /// @notice Small field domain tag for lock-proof public input (replaces raw `keccak256("lock")` for field safety)
    uint256 public constant LOCK_DOMAIN = 1;
    /// @notice Small field domain tag for unlock-proof public input
    uint256 public constant UNLOCK_DOMAIN = 2;
    /// @notice Public input count for `shieldedTransfer` join-split proofs
    uint256 public constant SHIELDED_TRANSFER_PUBLIC_INPUTS = 11;

    // Commitment tracking
    /// @notice Mapping to track valid commitments in the system
    mapping(bytes32 => bool) public commitments;
    /// @notice Mapping to track used nullifiers to prevent double-spending
    mapping(bytes32 => bool) public nullifiers;
    /// @notice Mapping to track balances for each commitment
    mapping(bytes32 => uint256) public commitmentBalances;
    /// @notice Tracking flag for commitments that have no remaining balance
    mapping(bytes32 => bool) public spentCommitments;
    /// @notice Mapping to track locked collateral for each commitment
    mapping(bytes32 => uint256) public lockedCollateral;
    /// @notice Mapping of transparent (public) token balances by address
    mapping(address => uint256) public transparentBalances;
    
    // Burn exemption system removed - no longer needed without burn mechanism
    
    // Ecosystem configuration struct to reduce state variable count
    /// @notice Configuration for ecosystem contracts
    struct EcosystemConfig {
        address governance;
        address staking;
        address yieldFarming;
    }
    
    /// @notice Ecosystem contract configuration
    EcosystemConfig public ecosystem;

    /// @notice Optional `AegisTimelockController` for delayed admin via `execute`.
    address public timelockController;

    /// @notice Emitted when the timelock address used for governance-gated execution is updated
    event TimelockControllerUpdated(address indexed previousTimelock, address indexed newTimelock);
    /// @notice Mapping to track authorized protocol contracts
    mapping(address => bool) public authorizedContracts;
    /// @notice Timestamp of the last authorization update for a contract
    mapping(address => uint256) public authorizationUpdatedAt;
    /// @notice Enumerable set of currently authorized contracts for auditability
    EnumerableSet.AddressSet private _authorizedContractsSet;
    /// @notice Maximum number of authorized contracts allowed concurrently
    uint256 public constant MAX_AUTHORIZED_CONTRACTS = 64;
    /// @notice Nonce for secure nullifier generation
    uint256 private nonce;

    /// @notice Address of the TokenAllocation contract that receives the initial supply
    address public tokenAllocationContract;
    
    // ERC20 allowances
    /// @notice Mapping of token allowances for ERC20 compatibility
    mapping(address => mapping(address => uint256)) private _allowances;

    /// @notice Groth16 verifier for transparent exit (`unshield`) under `TRANSFER_UNSHIELD_CIRCUIT` (**4** public). Must be registered in `VerifierFactory` (`syncVerifiersFromFactory` loads it).
    address public transferUnshieldVerifier;
    /// @notice Groth16 verifier for `shieldedTransfer` under `SHIELDED_TRANSFER_CIRCUIT` (**11** public). Factory-registered only.
    address public shieldedTransferVerifier;
    /// @notice Verifier for `transferToPool` under `TRANSFER_TO_POOL_CIRCUIT` (**4** public). Factory-registered only.
    address public transferToPoolVerifier;
    /// @notice Verifier for commitment-internal moves under `TRANSFER_COMMITMENT_INTERNAL_CIRCUIT` (**4** public). Factory-registered only.
    address public transferCommitmentInternalVerifier;
    /// @notice Verifier for `lockCollateral` / `unlockCollateral` under `TRANSFER_COMMITMENT_ACTION_CIRCUIT` (**4** public). Factory-registered only.
    address public transferCommitmentActionVerifier;
    
    // Events
    /// @notice Emitted when tokens are transferred between addresses (ERC20 compatibility)
    /// @dev ERC20 standard: value should NOT be indexed (only from and to are indexed)
    /// @param from Address tokens are transferred from
    /// @param to Address tokens are transferred to
    /// @param value Amount of tokens transferred
    event Transfer(address indexed from, address indexed to, uint256 value);
    
    /// @notice Emitted when an approval is made for token spending (ERC20 compatibility)
    /// @dev ERC20 standard: value should NOT be indexed (only owner and spender are indexed)
    /// @param owner Address that owns the tokens
    /// @param spender Address that is approved to spend tokens
    /// @param value Amount of tokens approved for spending
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    /// @notice Emitted when a new commitment is added to the system
    /// @param commitment The commitment hash that was added
    /// @param timestamp Block timestamp when the commitment was added
    event CommitmentAdded(bytes32 indexed commitment, uint256 indexed timestamp);
    
    /// @notice Emitted when a nullifier is used to prevent double-spending
    /// @param nullifier The nullifier hash that was used
    /// @param timestamp Block timestamp when the nullifier was used
    event NullifierUsed(bytes32 indexed nullifier, uint256 indexed timestamp);
    
    /// @notice Emitted when a shielded transfer is executed using zero-knowledge proofs
    /// @param inputNullifier1 First input nullifier used in the transfer
    /// @param inputNullifier2 Second input nullifier used in the transfer
    /// @param outputCommitment1 First output commitment created in the transfer
    /// @param outputCommitment2 Second output commitment created in the transfer
    event ShieldedTransfer(
        bytes32 indexed inputNullifier1,
        bytes32 indexed inputNullifier2,
        bytes32 indexed outputCommitment1,
        bytes32 outputCommitment2
    );
    
    /// @notice Emitted when transparent tokens are shielded into private commitments
    /// @param commitment The commitment created for the shielded tokens
    event Shield(bytes32 indexed commitment);
    
    /// @notice Emitted when private tokens are unshielded to transparent balance
    /// @param nullifier The nullifier used to unshield the tokens
    event Unshield(bytes32 indexed nullifier);
    
    /// @notice Emitted when a transparent transfer occurs between addresses
    /// @param from Address tokens are transferred from
    /// @param to Address tokens are transferred to
    /// @param amount Amount of tokens transferred
    event TransparentTransfer(address indexed from, address indexed to, uint256 indexed amount);
    
    /// @notice Emitted when collateral is locked for a commitment
    /// @param commitment The commitment for which collateral is locked
    /// @param amount Amount of collateral locked
    event CollateralLocked(bytes32 indexed commitment, uint256 indexed amount);
    
    /// @notice Emitted when collateral is unlocked for a commitment
    /// @param commitment The commitment for which collateral is unlocked
    /// @param amount Amount of collateral unlocked
    event CollateralUnlocked(bytes32 indexed commitment, uint256 indexed amount);
    
    /// @notice Emitted when a contract is authorized or deauthorized
    /// @param contractAddress The contract address
    /// @param authorized Whether the contract is authorized
    /// @param timestamp Block timestamp when the change occurred
    /// @param governanceExecutor Address that executed the governance action
    /// @param authorizedContractCount Total number of authorized contracts after the change
    event ContractAuthorizationChanged(
        address indexed contractAddress,
        bool authorized,
        uint256 timestamp,
        address indexed governanceExecutor,
        uint256 authorizedContractCount
    );

    /// @notice Thrown when governance attempts to authorize more contracts than allowed
    error AuthorizationLimitReached();
    /// @notice Thrown when attempting to authorize an already authorized contract
    error ContractAlreadyAuthorized();
    /// @notice Thrown when attempting to revoke a contract that is not authorized
    error ContractNotAuthorized();
    
    // Burn-related events removed - no longer needed without burn mechanism
    
    // Errors (InvalidProof and InvalidVerifier are imported from ProofLib)

    /**
     * @notice Initializes the private token contract with proper token allocation
     * @dev Constructor implements fixed supply cap and proper token distribution
     * @param _verifierFactory Address of the VerifierFactory contract
     * @param _tokenAllocation Address of the TokenAllocation contract
     */
    constructor(
        address _verifierFactory,
        address _tokenAllocation
    ) Ownable(msg.sender) {
        if (_verifierFactory == address(0)) {
            revert InvalidAddress();
        }
        if (_tokenAllocation == address(0)) {
            revert ZeroAddress();
        }
        
        // Fixed Supply Model: 21M tokens maximum supply
        // Fully decentralized allocation - NO TEAM/FOUNDER PRIVILEGES:
        // - Public Sale: 50% (10.5M tokens) - Open to all participants
        //   - 9.5M tokens for auction sale
        //   - 1.0M tokens reserved for liquidity deployment
        // - Ecosystem Rewards: 30% (6.3M tokens) - Governance-controlled rewards  
        // - Treasury/Development: 20% (4.2M tokens) - Development and operations
        //
        // Austrian Economic Principle: Complete decentralization from launch
        // Team/founders have no special allocation - they participate as equals
        
        // Validate that initial supply doesn't exceed maximum
        if (INITIAL_SUPPLY > MAX_SUPPLY) {
            revert InitialSupplyExceedsMaximum();
        }
        
        // Effects: Update all state variables and emit events first
        totalSupply = INITIAL_SUPPLY;
        transparentBalances[_tokenAllocation] = INITIAL_SUPPLY;
        tokenAllocationContract = _tokenAllocation;

        // Set factory first
        verifiers.factory = IVerifierFactory(_verifierFactory);
        
        // Emit initial distribution event for transparency
        emit TransparentTransfer(address(0), _tokenAllocation, INITIAL_SUPPLY);
        
        // Initialize verifiers through private function to satisfy linter
        _initializeVerifiers();

        // Permissionless entry on day zero so holders can move AGS into commitments without a mediator contract.
        // Governance may later set `publicEntryEnabled` false (stricter stealth) only after authorized routers exist.
        publicEntryEnabled = true;
        emit PublicEntryEnabledUpdated(true);

        // Transparent transfers default permissive for integrations; tighten with `setPermissionlessTransparentTransfers(false)`
        // after allowlisting routers, auction, rewards, and any contract that `transfer`s or `transferFrom`s AGS.
        permissionlessTransparentTransfers = true;
        emit PermissionlessTransparentTransfersUpdated(true);
    }
    modifier onlyTokenAllocation() {
        if (msg.sender != tokenAllocationContract) revert UnauthorizedAccess();
        _;
    }

    
    /// @notice Private function to initialize verifiers after constructor state setup
    /// @dev Separated from constructor to satisfy linter reentrancy requirements
    function _initializeVerifiers() private {
        verifiers.transfer = address(0);
        verifiers.mint = address(0);
    }

    function syncVerifiersFromFactory() public {
        if (address(verifiers.factory) == address(0)) {
            revert InvalidVerifier();
        }

        try verifiers.factory.getVerifier(TRANSFER_CIRCUIT) returns (address transferVerifierAddr) {
            verifiers.transfer = transferVerifierAddr;
        } catch {
            verifiers.transfer = address(0);
        }

        try verifiers.factory.getVerifier(MINT_CIRCUIT) returns (address mintVerifierAddr) {
            verifiers.mint = mintVerifierAddr;
        } catch {
            verifiers.mint = address(0);
        }

        try verifiers.factory.getVerifier(TRANSFER_UNSHIELD_CIRCUIT) returns (address unshieldV) {
            transferUnshieldVerifier = unshieldV;
        } catch {
            transferUnshieldVerifier = address(0);
        }

        try verifiers.factory.getVerifier(SHIELDED_TRANSFER_CIRCUIT) returns (address stV) {
            shieldedTransferVerifier = stV;
        } catch {
            shieldedTransferVerifier = address(0);
        }

        try verifiers.factory.getVerifier(TRANSFER_TO_POOL_CIRCUIT) returns (address tp) {
            transferToPoolVerifier = tp;
        } catch {
            transferToPoolVerifier = address(0);
        }

        try verifiers.factory.getVerifier(TRANSFER_COMMITMENT_INTERNAL_CIRCUIT) returns (address ti) {
            transferCommitmentInternalVerifier = ti;
        } catch {
            transferCommitmentInternalVerifier = address(0);
        }

        try verifiers.factory.getVerifier(TRANSFER_COMMITMENT_ACTION_CIRCUIT) returns (address ta) {
            transferCommitmentActionVerifier = ta;
        } catch {
            transferCommitmentActionVerifier = address(0);
        }
    }

    /// @dev `transfer-commitment-internal` layout (4 public) — never fall back to `verifiers.transfer` (`transfer-optimized`, 5 public).
    function _transferCommitmentInternalVerifierSynced() private returns (address) {
        if (transferCommitmentInternalVerifier == address(0)) {
            syncVerifiersFromFactory();
        }
        if (transferCommitmentInternalVerifier == address(0)) revert InvalidVerifier();
        return transferCommitmentInternalVerifier;
    }

    /// @dev `transfer-commitment-action` layout — never fall back to `verifiers.transfer`.
    function _transferCommitmentActionVerifierSynced() private returns (address) {
        if (transferCommitmentActionVerifier == address(0)) {
            syncVerifiersFromFactory();
        }
        if (transferCommitmentActionVerifier == address(0)) revert InvalidVerifier();
        return transferCommitmentActionVerifier;
    }
    
    /// @notice Modifier to restrict access to authorized protocol contracts only
    modifier onlyAuthorizedContract() {
        if (!authorizedContracts[msg.sender]) revert UnauthorizedContract();
        _;
    }

    /// @notice Modifier to allow only governance to call administrative functions
    /// @dev Implements Austrian Economic Principle: Fully autonomous decentralized governance
    /// @custom:security Only governance contract can control critical functions
    modifier onlyGovernance() {
        if (!GovernanceAccessLib.isGovernanceTimelockOrCore(ecosystem.governance, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    /// @notice Enables or disables direct user entry (governance / timelock only). Emits `PublicEntryEnabledUpdated`.
    function setPublicEntryEnabled(bool enabled) external onlyGovernance {
        publicEntryEnabled = enabled;
        emit PublicEntryEnabledUpdated(enabled);
    }

    /// @notice Tightens or relaxes who may initiate `transfer` / `transferFrom` on transparent balances (governance / timelock).
    function setPermissionlessTransparentTransfers(bool enabled) external onlyGovernance {
        permissionlessTransparentTransfers = enabled;
        emit PermissionlessTransparentTransfersUpdated(enabled);
    }

    /// @dev When permissionless transparent transfers are disabled, only authorized contracts may move transparent balances.
    function _requireTransparentTransferAuthority() private view {
        if (permissionlessTransparentTransfers) return;
        if (authorizedContracts[msg.sender]) return;
        revert UnauthorizedContract();
    }

    /// @notice Modifier to restrict access to owner or governance contract
    /// @dev Allows both owner and governance to perform administrative functions
    modifier onlyOwnerOrGovernance() {
        if (msg.sender != owner() && !GovernanceAccessLib.isGovernanceTimelockOrCore(ecosystem.governance, timelockController, msg.sender)) {
            revert UnauthorizedAccess();
        }
        _;
    }

    /// @notice Register the protocol timelock for delayed token admin (pause, verifier wiring, etc.).
    function setTimelockController(address newTimelock) external onlyOwnerOrGovernance {
        emit TimelockControllerUpdated(timelockController, newTimelock);
        timelockController = newTimelock;
    }
    
    /// @notice Sets the governance contract address (owner only, one-time setup)
    /// @param _governance Address of the governance contract
    function setGovernanceContract(address _governance) external onlyOwner {
        if (_governance == address(0)) revert InvalidGovernanceAddress();
        if (ecosystem.governance != address(0)) revert GovernanceAlreadySet();
        ecosystem.governance = _governance;
    }
    
    /**
     * @notice Executes a private transfer between shielded addresses using zero-knowledge proofs
     * @dev Verifier: `shieldedTransferVerifier` (`SHIELDED_TRANSFER_CIRCUIT`). If unset, `syncVerifiersFromFactory()` is attempted once; then `InvalidVerifier` if still unset.
     * @dev **11 public inputs:** `[n1,n2,o1,o2,totalAmount,in1,in2,bal1,bal2,out1Amt,out2Amt]` — the contract
     *      overwrites indices 7–8 with live `commitmentBalances` before verification. Policy: **full merge** of
     *      the two input notes (`totalAmount == bal(in1)+bal(in2)`), outputs receive `out1Amt+out2Amt == totalAmount`.
     *      The Circom template proves input openings `Poseidon(s, balance, r)` against the public commitment hashes;
     *      `r` is a **private** witness so notes can chain from `mint-optimized` (third limb = depositor field) or
     *      from prior join-split outputs (fixed output tags 1 and 2 in-circuit).
     * @param proof The ZK proof data
     * @param publicInputs Join-split public vector (length **11**)
     */
    function shieldedTransfer(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        if (!publicEntryEnabled && !authorizedContracts[msg.sender]) revert UnauthorizedContract();
        ProofLib.requireValidInputLength(publicInputs, SHIELDED_TRANSFER_PUBLIC_INPUTS);

        bytes32 inputNullifier1 = ProofLib.extractNullifier(publicInputs, 0);
        bytes32 inputNullifier2 = ProofLib.extractNullifier(publicInputs, 1);
        bytes32 outputCommitment1 = ProofLib.extractCommitment(publicInputs, 2);
        bytes32 outputCommitment2 = ProofLib.extractCommitment(publicInputs, 3);
        uint256 totalAmount = ProofLib.extractAmount(publicInputs, 4);
        bytes32 inputCommitment1 = ProofLib.extractCommitment(publicInputs, 5);
        bytes32 inputCommitment2 = ProofLib.extractCommitment(publicInputs, 6);
        uint256 outputAmount1 = ProofLib.extractAmount(publicInputs, 9);
        uint256 outputAmount2 = ProofLib.extractAmount(publicInputs, 10);

        if (totalAmount == 0) revert InvalidAmount();
        if (inputCommitment1 == inputCommitment2) revert InvalidAmount();
        if (nullifiers[inputNullifier1] || nullifiers[inputNullifier2]) revert NullifierAlreadyUsed();
        if (commitments[outputCommitment1] || commitments[outputCommitment2]) revert CommitmentAlreadyExists();
        if (!commitments[inputCommitment1] || !commitments[inputCommitment2]) revert CommitmentNotFound();

        uint256 bal1 = commitmentBalances[inputCommitment1];
        uint256 bal2 = commitmentBalances[inputCommitment2];
        if (bal1 + bal2 != totalAmount) revert InvalidAmount();
        if (outputAmount1 + outputAmount2 != totalAmount) revert InvalidAmount();

        uint256[] memory verifyInputs = new uint256[](SHIELDED_TRANSFER_PUBLIC_INPUTS);
        for (uint256 i = 0; i < SHIELDED_TRANSFER_PUBLIC_INPUTS; ++i) {
            verifyInputs[i] = publicInputs[i];
        }
        verifyInputs[7] = bal1;
        verifyInputs[8] = bal2;

        if (shieldedTransferVerifier == address(0)) {
            syncVerifiersFromFactory();
        }
        address stVerifier = shieldedTransferVerifier;
        if (stVerifier == address(0)) revert InvalidVerifier();
        ProofLib.ZKProof memory zkProof = ProofLib.ZKProof({
            proof: proof,
            publicInputs: verifyInputs,
            verifier: stVerifier
        });
        zkProof.requireValidProof();

        nullifiers[inputNullifier1] = true;
        nullifiers[inputNullifier2] = true;
        _consumeCommitment(inputCommitment1, bal1);
        _consumeCommitment(inputCommitment2, bal2);
        commitments[outputCommitment1] = true;
        commitments[outputCommitment2] = true;
        commitmentBalances[outputCommitment1] = outputAmount1;
        commitmentBalances[outputCommitment2] = outputAmount2;
        spentCommitments[outputCommitment1] = false;
        spentCommitments[outputCommitment2] = false;

        _emitShieldedTransferEvents(inputNullifier1, inputNullifier2, outputCommitment1, outputCommitment2);
    }

    /**
     * @notice Emits events for shielded transfer
     * @dev Emits events for shielded transfer
     * @param inputNullifier1 The first input nullifier used
     * @param inputNullifier2 The second input nullifier used
     * @param outputCommitment1 The first output commitment added
     * @param outputCommitment2 The second output commitment added
     */
    function _emitShieldedTransferEvents(
        bytes32 inputNullifier1,
        bytes32 inputNullifier2,
        bytes32 outputCommitment1,
        bytes32 outputCommitment2
    ) private {
        uint256 currentTime = block.timestamp;
        emit NullifierUsed(inputNullifier1, currentTime);
        emit NullifierUsed(inputNullifier2, currentTime);
        emit CommitmentAdded(outputCommitment1, currentTime);
        emit CommitmentAdded(outputCommitment2, currentTime);
        emit ShieldedTransfer(inputNullifier1, inputNullifier2, outputCommitment1, outputCommitment2);
    }

    /**
     * @notice Consumes balance from a commitment and marks it spent when depleted
     * @param commitment Commitment being consumed
     * @param amount Amount to deduct
     */
    function _consumeCommitment(bytes32 commitment, uint256 amount) private {
        if (!commitments[commitment]) revert CommitmentNotFound();
        if (spentCommitments[commitment]) revert InvalidCommitment();
        uint256 balance = commitmentBalances[commitment];
        if (balance < amount) revert InsufficientBalance();

        unchecked {
            commitmentBalances[commitment] = balance - amount;
        }

        if (commitmentBalances[commitment] == 0) {
            spentCommitments[commitment] = true;
        }
    }
    
    /**
     * @notice **Shield (API name):** moves AGS from **`transparentBalances`** into a new **commitment** using **`mint-optimized`** Groth16. **Not wallet-anonymous:** public inputs include **`depositor`** (`publicInputs[3]` as `uint160`); indexers can link the economic owner to this shield. Authorized callers (e.g. privacy router) may relay proofs binding another `depositor` — relayer still sees calldata. Prefer product language **shield into commitments** over **anonymous shield**.
     * @dev Public inputs (length **4**) must match the deployed `mint-optimized` verifier / `mint-optimized.circom` ceremony:
     *      `[0] depositNullifier` — one-time nullifier for this deposit proof (prevents replay),
     *      `[1] outputCommitment` — new note commitment,
     *      `[2] amount` — wei debited from the payer's transparent balance (must match `payer`),
     *      `[3] depositor` — `uint256(uint160(payer))`; payer is `msg.sender` unless `msg.sender` is an **authorized** contract,
     *      in which case `depositor` is taken from public inputs and the proof must bind the debit to that address.
     * @param proof Packed Groth16 proof for `MINT_CIRCUIT`
     * @param publicInputs Four public signals in the order above
     */
    function shield(uint256[8] calldata proof, uint256[] calldata publicInputs) external nonReentrant whenNotPaused {
        if (!publicEntryEnabled && !authorizedContracts[msg.sender]) revert UnauthorizedContract();
        ProofLib.requireValidInputLength(publicInputs, 4);

        bytes32 depositNullifier = ProofLib.extractNullifier(publicInputs, 0);
        bytes32 outputCommitment = ProofLib.extractCommitment(publicInputs, 1);
        uint256 amount = ProofLib.extractAmount(publicInputs, 2);
        address depositor = address(uint160(publicInputs[3]));

        if (amount == 0) revert InvalidAmount();
        if (depositor == address(0)) revert ZeroAddress();
        if (commitments[outputCommitment]) revert CommitmentAlreadyExists();
        if (nullifiers[depositNullifier]) revert NullifierAlreadyUsed();

        address payer = depositor;
        if (!authorizedContracts[msg.sender]) {
            if (payer != msg.sender) revert UnauthorizedAccess();
        }
        if (transparentBalances[payer] < amount) revert InsufficientBalance();

        if (verifiers.mint == address(0)) {
            syncVerifiersFromFactory();
        }
        ProofLib.ZKProof memory zkProof = ProofLib.ZKProof({
            proof: proof,
            publicInputs: publicInputs,
            verifier: verifiers.mint
        });
        zkProof.requireValidProof();

        nullifiers[depositNullifier] = true;
        unchecked {
            transparentBalances[payer] -= amount;
        }
        commitments[outputCommitment] = true;
        commitmentBalances[outputCommitment] = amount;
        spentCommitments[outputCommitment] = false;

        uint256 currentTime = block.timestamp;
        emit NullifierUsed(depositNullifier, currentTime);
        emit Shield(outputCommitment);
        emit CommitmentAdded(outputCommitment, currentTime);
    }
    
    /**
     * @notice **Transparent exit (compatibility):** moves value from a shielded commitment to `transparentBalances[recipient]`.
     * @dev Aegis defaults to **shielded-first** holding; call this only when a public ERC-20 leg is required (e.g. legacy DEX).
     * @dev Verifier: `transferUnshieldVerifier` (`TRANSFER_UNSHIELD_CIRCUIT`). If unset, `syncVerifiersFromFactory()` is attempted once; then `InvalidVerifier` if still unset.
     * @param proof The ZK proof data
     * @param publicInputs Public inputs: [nullifier, recipient, amount, inputCommitment]
     */
    function unshield(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external nonReentrant whenNotPaused {
        if (!publicEntryEnabled && !authorizedContracts[msg.sender]) revert UnauthorizedContract();
        // Validate input length
        ProofLib.requireValidInputLength(publicInputs, 4);
        
        // Extract public inputs
        bytes32 nullifier = ProofLib.extractNullifier(publicInputs, 0);
        address recipient = address(uint160(publicInputs[1]));
        uint256 amount = ProofLib.extractAmount(publicInputs, 2);
        bytes32 commitment = ProofLib.extractCommitment(publicInputs, 3);
        
        if (recipient == address(0)) revert ZeroAddress();
        if (nullifiers[nullifier]) revert NullifierAlreadyUsed();
        if (!commitments[commitment]) revert CommitmentNotFound();
        
        // Verify proof before state changes
        if (transferUnshieldVerifier == address(0)) {
            syncVerifiersFromFactory();
        }
        address unshieldVerifier = transferUnshieldVerifier;
        if (unshieldVerifier == address(0)) revert InvalidVerifier();
        ProofLib.ZKProof memory zkProof = ProofLib.ZKProof({
            proof: proof,
            publicInputs: publicInputs,
            verifier: unshieldVerifier
        });
        zkProof.requireValidProof();
        
        nullifiers[nullifier] = true;
        _consumeCommitment(commitment, amount);
        transparentBalances[recipient] += amount;
        
        uint256 currentTime = block.timestamp;
        emit NullifierUsed(nullifier, currentTime);
        emit Unshield(nullifier);
    }
    
    /**
     * @notice Transfers tokens from a commitment to a pool address (for protocol use)
     * @dev Transfers value from a private commitment to a transparent pool balance (protocol leg).
     * @dev Verifier: `transferToPoolVerifier` (`TRANSFER_TO_POOL_CIRCUIT`). If unset, `syncVerifiersFromFactory()` is attempted once; then `InvalidVerifier` if still unset.
     * @param commitment The commitment to transfer from
     * @param poolAddress The pool address to transfer to
     * @param amount The amount to transfer
     * @param nullifier The nullifier to prevent double spending
     * @param proof The ZK proof for the transfer
     */
    function transferToPool(
        bytes32 commitment,
        address poolAddress,
        uint256 amount,
        bytes32 nullifier,
        uint256[8] calldata proof
    ) external nonReentrant whenNotPaused {
        if (poolAddress == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (!commitments[commitment]) revert CommitmentNotFound();
        if (nullifiers[nullifier]) revert NullifierAlreadyUsed();
        
        // Prepare ZK proof verification inputs
        uint256[] memory publicInputs = new uint256[](4);
        publicInputs[0] = uint256(commitment);
        publicInputs[1] = uint256(uint160(poolAddress));
        publicInputs[2] = amount;
        publicInputs[3] = uint256(nullifier);

        if (transferToPoolVerifier == address(0)) {
            syncVerifiersFromFactory();
        }
        address poolV = transferToPoolVerifier;
        if (poolV == address(0)) revert InvalidVerifier();
        ProofLib.ZKProof memory zkPool = ProofLib.ZKProof({
            proof: proof,
            publicInputs: publicInputs,
            verifier: poolV
        });
        zkPool.requireValidProof();
        
        nullifiers[nullifier] = true;
        _consumeCommitment(commitment, amount);
        transparentBalances[poolAddress] += amount;
        
        uint256 currentTime = block.timestamp;
        emit NullifierUsed(nullifier, currentTime);
        emit Transfer(address(0), poolAddress, amount);
    }
    
    /**
     * @notice Transfers tokens to another address
     * @dev Standard ERC20 transfer function with reentrancy protection
     * @param to The recipient address
     * @param amount The amount to transfer
     * @return True if transfer was successful
     */
    function transfer(address to, uint256 amount) external nonReentrant whenNotPaused returns (bool) {
        _requireTransparentTransferAuthority();
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (transparentBalances[msg.sender] < amount) revert InsufficientBalance();
        
        // Simple transfer without burn mechanism for better user experience
        // Fixed 21M supply provides scarcity without transaction friction
        transparentBalances[msg.sender] -= amount;
        transparentBalances[to] += amount;
        
        emit Transfer(msg.sender, to, amount);
        emit TransparentTransfer(msg.sender, to, amount);
        
        return true;
    }

    /**
     * @notice Performs a transfer on behalf of the TokenAllocation contract during initial distribution
     * @param to The recipient address
     * @param amount The amount to transfer
     * @return True if transfer was successful
     */
    function allocationTransfer(address to, uint256 amount) 
    external nonReentrant whenNotPaused onlyTokenAllocation returns (bool) {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (transparentBalances[tokenAllocationContract] < amount) revert InsufficientBalance();

        transparentBalances[tokenAllocationContract] -= amount;
        transparentBalances[to] += amount;

        emit Transfer(tokenAllocationContract, to, amount);
        emit TransparentTransfer(tokenAllocationContract, to, amount);

        return true;
    }
    
    /**
     * @notice Transfers tokens from one address to another using allowance mechanism
     * @dev Transfer tokens from one address to another using allowance
     * @param from Address to transfer from
     * @param to Address to transfer to
     * @param amount Amount to transfer
     * @return True if the transfer was successful
     */
    function transferFrom(address from, address to, uint256 amount) external nonReentrant whenNotPaused returns (bool) {
        _requireTransparentTransferAuthority();
        if (from == address(0)) revert InvalidAddress();
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (transparentBalances[from] < amount) revert InsufficientBalance();
        
        uint256 currentAllowance = _allowances[from][msg.sender];
        if (currentAllowance < amount) revert InsufficientBalance();
        
        // Simple transfer without burn mechanism for better user experience
        // Fixed 21M supply provides scarcity without transaction friction
        transparentBalances[from] -= amount;
        transparentBalances[to] += amount;
        _allowances[from][msg.sender] = currentAllowance - amount;
        
        emit Transfer(from, to, amount);
        emit TransparentTransfer(from, to, amount);
        
        return true;
    }
    
    /**
     * @notice Approves a spender to transfer tokens on behalf of the caller
     * @dev Approve spender to transfer tokens on behalf of caller
     * @param spender Address to approve
     * @param amount Amount to approve
     * @return True if the approval was successful
     */
    function approve(address spender, uint256 amount) external nonReentrant whenNotPaused returns (bool) {
        if (spender == address(0)) revert ZeroAddress();
        
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
    
    /**
     * @notice Returns the amount of tokens that a spender is allowed to transfer on behalf of an owner
     * @dev Returns the allowance of spender for owner's tokens
     * @param tokenOwner Token owner
     * @param spender Approved spender
     * @return The allowance amount
     */
    function allowance(address tokenOwner, address spender) external view returns (uint256) {
        return _allowances[tokenOwner][spender];
    }
    
    /**
     * @notice Returns the transparent token balance of an account
     * @dev Returns the transparent balance of an account
     * @param account The account to query
     * @return The transparent balance
     */
    function balanceOf(address account) external view returns (uint256) {
        return transparentBalances[account];
    }
    
    /**
     * @notice Returns the name of the token
     * @return The token name
     */
    function name() external pure returns (string memory) {
        return NAME;
    }
    
    /**
     * @notice Returns the symbol of the token
     * @return The token symbol
     */
    function symbol() external pure returns (string memory) {
        return SYMBOL;
    }
    
    /**
     * @notice Returns the number of decimals for the token
     * @return The number of decimals
     */
    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }
    
    // Austrian Economic Principle Transparency Functions
    
    /**
     * @notice Returns the maximum supply cap (Austrian sound money principle)
     * @dev "The gold standard alone makes the determination of money's purchasing power 
     * independent of the ambitions and machinations of governments" - Ludwig von Mises
     * @return The maximum supply that can ever exist
     */
    function maxSupply() external pure returns (uint256) {
        return MAX_SUPPLY;
    }

    /**
     * @notice Returns the remaining supply that could theoretically be created
     * @dev In Austrian economics, this should always be 0 after initial distribution
     * @return The difference between max supply and current supply
     */
    function remainingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply;
    }
    
    // Burn rate functions removed - no longer needed without burn mechanism
    
    /**
     * @notice Austrian Economic Principle: Supply Cap Status Monitoring
     * @dev Returns comprehensive supply cap information for transparency
     * @return currentSupply Current total supply in circulation
     * @return maxSupplyAmount Maximum supply cap (21M tokens)
     * @return remainingSupplyAmount Tokens that could theoretically still exist
     * @return percentageUsed Percentage of max supply currently in use
     * @return isNearCap Whether supply is approaching cap (>95%)
     */
    function getSupplyCapStatus() external view returns (
        uint256 currentSupply,
        uint256 maxSupplyAmount,
        uint256 remainingSupplyAmount,
        uint256 percentageUsed,
        bool isNearCap
    ) {
        currentSupply = totalSupply;
        maxSupplyAmount = MAX_SUPPLY;
        remainingSupplyAmount = MAX_SUPPLY - totalSupply;
        percentageUsed = (totalSupply * 100) / MAX_SUPPLY;
        isNearCap = percentageUsed > 94;
    }
    
    /**
     * @notice Fixed Supply Status Tracking
     * @dev Returns supply information for the fixed 21M token model
     * @return initialSupply The initial supply at contract deployment (10M tokens)
     * @return currentSupply Current total supply in circulation (same as initial, no burns)
     * @return maxSupplyAmount Maximum possible supply (21M tokens)
     * @return supplyUtilization Percentage of max supply currently in circulation
     */
    function getSupplyStatus() external view returns (
        uint256 initialSupply,
        uint256 currentSupply,
        uint256 maxSupplyAmount,
        uint256 supplyUtilization
    ) {
        initialSupply = INITIAL_SUPPLY;
        currentSupply = totalSupply;
        maxSupplyAmount = MAX_SUPPLY;
        supplyUtilization = (totalSupply * 100) / MAX_SUPPLY;
    }
    
    /// @notice Checks if a commitment exists in the system
    /// @param commitment The commitment to check
    /// @return True if the commitment exists
    function commitmentExists(bytes32 commitment) external view returns (bool) {
        return commitments[commitment];
    }
    
    /// @notice Checks if a nullifier has been used to prevent double-spending
    /// @param nullifier The nullifier to check
    /// @return True if the nullifier has been used
    function nullifierUsed(bytes32 nullifier) external view returns (bool) {
        return nullifiers[nullifier];
    }
    
    /// @notice Updates the transfer verifier contract address (governance only - DAO controlled)
    /// @dev Critical security function - only DAO governance can update verifiers
    /// @param transferVerifierAddress New transfer verifier address
    function updateTransferVerifier(address transferVerifierAddress) external onlyGovernance {
        if (transferVerifierAddress == address(0)) revert InvalidAddress();
        verifiers.transfer = transferVerifierAddress;
    }
    
    /// @notice Updates the mint verifier contract address (governance only - DAO controlled)
    /// @dev Critical security function - only DAO governance can update verifiers
    /// @param mintVerifierAddress New mint verifier address
    function updateMintVerifier(address mintVerifierAddress) external onlyGovernance {
        if (mintVerifierAddress == address(0)) revert InvalidAddress();
        verifiers.mint = mintVerifierAddress;
    }

    /// @notice Sets the dedicated `unshield` verifier (governance only)
    function updateTransferUnshieldVerifier(address verifierAddress) external onlyGovernance {
        if (verifierAddress == address(0)) revert InvalidAddress();
        transferUnshieldVerifier = verifierAddress;
    }

    /// @notice Sets the dedicated `shieldedTransfer` verifier (governance only)
    function updateShieldedTransferVerifier(address verifierAddress) external onlyGovernance {
        if (verifierAddress == address(0)) revert InvalidAddress();
        shieldedTransferVerifier = verifierAddress;
    }

    /// @notice Sets the dedicated `transferToPool` verifier (governance only)
    function updateTransferToPoolVerifier(address verifierAddress) external onlyGovernance {
        if (verifierAddress == address(0)) revert InvalidAddress();
        transferToPoolVerifier = verifierAddress;
    }

    /// @notice Sets the dedicated commitment-internal transfer verifier (governance only)
    function updateTransferCommitmentInternalVerifier(address verifierAddress) external onlyGovernance {
        if (verifierAddress == address(0)) revert InvalidAddress();
        transferCommitmentInternalVerifier = verifierAddress;
    }

    /// @notice Sets the dedicated lock/unlock action verifier (governance only)
    function updateTransferCommitmentActionVerifier(address verifierAddress) external onlyGovernance {
        if (verifierAddress == address(0)) revert InvalidAddress();
        transferCommitmentActionVerifier = verifierAddress;
    }

    /// @notice Pauses the contract (governance only - DAO controlled)
    /// @dev Austrian Economic Principle: Decentralized governance without admin backdoors
    /// "The gold standard makes the determination of money's purchasing power 
    /// independent of governments" - Ludwig von Mises
    function pause() external onlyGovernance {
        _pause();
    }
    
    /// @notice Unpauses the contract (governance only - DAO controlled)
    /// @dev Austrian Economic Principle: Decentralized governance without admin backdoors
    function unpause() external onlyGovernance {
        _unpause();
    }
    
    /// @notice Austrian Economic Principle: NO UNLIMITED MINTING
    /// @dev emergencyMint function REMOVED to implement sound money principles
    /// "The gold standard makes the determination of money's purchasing power 
    /// independent of governments" - Ludwig von Mises
    /// 
    /// Initial token distribution should be done through constructor or 
    /// predetermined allocation, not arbitrary minting by central authority
    
    /// @notice Authorizes a contract to access internal functions (governance only - DAO controlled)
    /// @dev Critical access control function - only DAO governance can authorize contracts
    /// @param contractAddress Address of the contract to authorize
    function authorizeContract(address contractAddress) external onlyGovernance {
        if (contractAddress == address(0)) revert ZeroAddress();
        if (authorizedContracts[contractAddress]) revert ContractAlreadyAuthorized();
        if (_authorizedContractsSet.length() >= MAX_AUTHORIZED_CONTRACTS) revert AuthorizationLimitReached();

        authorizedContracts[contractAddress] = true;
        bool added = _authorizedContractsSet.add(contractAddress);
        assert(added);
        authorizationUpdatedAt[contractAddress] = block.timestamp;

        emit ContractAuthorizationChanged(
            contractAddress,
            true,
            block.timestamp,
            msg.sender,
            _authorizedContractsSet.length()
        );
    }
    
    /// @notice Revokes authorization for a contract (governance only - DAO controlled)
    /// @dev Critical access control function - only DAO governance can revoke authorization
    /// @param contractAddress Address of the contract to revoke authorization
    function revokeContractAuthorization(address contractAddress) external onlyGovernance {
        if (!authorizedContracts[contractAddress]) revert ContractNotAuthorized();

        authorizedContracts[contractAddress] = false;
        _authorizedContractsSet.remove(contractAddress);
        authorizationUpdatedAt[contractAddress] = block.timestamp;

        emit ContractAuthorizationChanged(
            contractAddress,
            false,
            block.timestamp,
            msg.sender,
            _authorizedContractsSet.length()
        );
    }
    
    /// @notice Checks if a contract is authorized
    /// @param contractAddress Address to check
    /// @return True if the contract is authorized
    function isAuthorizedContract(address contractAddress) external view returns (bool) {
        return authorizedContracts[contractAddress];
    }

    /// @notice Returns the number of currently authorized contracts
    /// @return count Number of authorized contracts
    function authorizedContractsCount() external view returns (uint256 count) {
        count = _authorizedContractsSet.length();
    }

    /// @notice Returns the list of authorized contracts for governance auditing
    /// @return contractsList Array of active authorized contract addresses
    function authorizedContractsList() external view returns (address[] memory contractsList) {
        contractsList = _authorizedContractsSet.values();
    }
    
    /// @notice Transfer tokens from a pool address to a private commitment
    /// @param poolAddress The pool address to transfer from
    /// @param recipientCommitment The commitment to transfer to
    /// @param amount The amount to transfer
    /// @dev CRITICAL SECURITY: Only authorized contracts can transfer from pools
    function transferFromPool(
        address poolAddress,
        bytes32 recipientCommitment,
        uint256 amount
    ) external whenNotPaused onlyAuthorizedContract {
        if (poolAddress == address(0)) revert ZeroAddress();
        if (recipientCommitment == bytes32(0)) revert InvalidAmount();
        if (amount == 0) revert InvalidAmount();
        if (transparentBalances[poolAddress] < amount) revert InsufficientBalance();
        
        // CRITICAL FIX: Prevent underflow
        unchecked {
            transparentBalances[poolAddress] -= amount;
        }
        
        // Handle both new and existing commitments
        if (!commitments[recipientCommitment]) {
            commitments[recipientCommitment] = true;
            commitmentBalances[recipientCommitment] = amount;
            spentCommitments[recipientCommitment] = false;
            emit CommitmentAdded(recipientCommitment, block.timestamp);
        } else {
            commitmentBalances[recipientCommitment] += amount;
            spentCommitments[recipientCommitment] = false;
        }
        
        emit TransparentTransfer(poolAddress, address(0), amount);
    }
    
    /// @notice Austrian Economic Principle: NO ARBITRARY MINTING TO COMMITMENTS
    /// @dev mintToCommitment function REMOVED to prevent inflation
    /// "Inflation is a policy that cannot last" - Ludwig von Mises
    /// 
    /// Tokens should only be transferred to commitments from existing supply,
    /// not created out of thin air. This preserves the fixed supply principle.

    /**
     * @notice Transfers tokens from one commitment to another for collateral purposes
     * @dev Transfers tokens from one commitment to another for collateral purposes using ZK proofs
     * @param fromCommitment The commitment to transfer from
     * @param toCommitment The commitment to transfer to
     * @param amount The amount to transfer
     * @param nullifier The nullifier to prevent double-spending
     * @param proof The ZK proof data
     */
    function transferFromCollateral(
        bytes32 fromCommitment,
        bytes32 toCommitment,
        uint256 amount,
        bytes32 nullifier,
        uint256[8] calldata proof
    ) external nonReentrant whenNotPaused {
        // Validate parameters
        if (fromCommitment == bytes32(0)) revert InvalidAmount();
        if (toCommitment == bytes32(0)) revert InvalidAmount();
        if (amount == 0) revert InvalidAmount();
        if (!commitments[fromCommitment]) revert CommitmentNotFound();
        if (commitments[toCommitment]) revert CommitmentAlreadyExists();
        if (nullifiers[nullifier]) revert NullifierAlreadyUsed();
        
        // Verify ZK proof for collateral transfer
        // Proof should verify:
        // 1. Ownership of the fromCommitment
        // 2. Sufficient balance in the fromCommitment
        // 3. Correct nullifier generation
        // 4. Valid toCommitment creation
        uint256[] memory publicInputs = new uint256[](4);
        publicInputs[0] = uint256(fromCommitment);
        publicInputs[1] = uint256(toCommitment);
        publicInputs[2] = amount;
        publicInputs[3] = uint256(nullifier);
        
        ProofLib.ZKProof memory zkCollateral = ProofLib.ZKProof({
            proof: proof,
            publicInputs: publicInputs,
            verifier: _transferCommitmentInternalVerifierSynced()
        });
        zkCollateral.requireValidProof();
        
        nullifiers[nullifier] = true;
        _consumeCommitment(fromCommitment, amount);
        commitments[toCommitment] = true;
        commitmentBalances[toCommitment] = amount;
        spentCommitments[toCommitment] = false;
        
        // Events: Emit events after state updates
        uint256 currentTime = block.timestamp;
        emit NullifierUsed(nullifier, currentTime);
        emit CommitmentAdded(toCommitment, currentTime);
        emit ShieldedTransfer(nullifier, bytes32(0), toCommitment, bytes32(0));
    }

    /// @notice Transfer tokens between commitments (for protocol use)
    /// @param fromCommitment The commitment to transfer from
    /// @param toCommitment The commitment to transfer to
    /// @param amount The amount to transfer
    /// @param nullifier The nullifier to prevent double spending
    /// @param proof The ZK proof for the transfer
    function transferBetweenCommitments(
        bytes32 fromCommitment,
        bytes32 toCommitment,
        uint256 amount,
        bytes32 nullifier,
        uint256[8] calldata proof
    ) external whenNotPaused {
        if (fromCommitment == bytes32(0) || toCommitment == bytes32(0)) revert InvalidAmount();
        if (amount == 0) revert InvalidAmount();
        if (!commitments[fromCommitment]) revert CommitmentNotFound();
        if (commitments[toCommitment]) revert CommitmentAlreadyExists();
        if (nullifiers[nullifier]) revert NullifierAlreadyUsed();
        
        // Verify ZK proof for private transfer
        // Proof should verify:
        // 1. Ownership of the fromCommitment
        // 2. Sufficient balance in the fromCommitment
        // 3. Correct nullifier generation
        // 4. Valid toCommitment creation
        uint256[] memory publicInputs = new uint256[](4);
        publicInputs[0] = uint256(fromCommitment);
        publicInputs[1] = uint256(toCommitment);
        publicInputs[2] = amount;
        publicInputs[3] = uint256(nullifier);

        ProofLib.ZKProof memory zkBetween = ProofLib.ZKProof({
            proof: proof,
            publicInputs: publicInputs,
            verifier: _transferCommitmentInternalVerifierSynced()
        });
        zkBetween.requireValidProof();
        
        nullifiers[nullifier] = true;
        _consumeCommitment(fromCommitment, amount);
        
        // Generate a nullifier for this transfer
        uint256 currentTime = block.timestamp;
        bytes32 transferNullifier = keccak256(abi.encodePacked(fromCommitment, toCommitment, amount, currentTime));
        if (nullifiers[transferNullifier]) revert NullifierAlreadyUsed();
        
        // Update state
        nullifiers[transferNullifier] = true;
        commitments[toCommitment] = true;
        commitmentBalances[toCommitment] = amount;
        spentCommitments[toCommitment] = false;
        
        emit NullifierUsed(transferNullifier, currentTime);
        emit CommitmentAdded(toCommitment, currentTime);
    }

    /// @notice Create an empty commitment (for protocol use)
    /// @param commitment The commitment to create
    function createCommitment(bytes32 commitment) external whenNotPaused {
        if (commitment == bytes32(0)) revert InvalidAmount();
        if (commitments[commitment]) revert CommitmentAlreadyExists();
        
        // Create the commitment with zero balance
        commitments[commitment] = true;
        commitmentBalances[commitment] = 0;
        spentCommitments[commitment] = false;
        
        emit CommitmentAdded(commitment, block.timestamp);
    }

    /// @notice Create a commitment with an initial balance (for protocol use)
    /// @param commitment The commitment to create
    /// @param initialBalance The initial balance for the commitment
    function createCommitmentWithBalance(bytes32 commitment, uint256 initialBalance) 
        external 
        whenNotPaused 
        onlyAuthorizedContract 
    {
        if (commitment == bytes32(0)) revert InvalidAmount();
        if (commitments[commitment]) revert CommitmentAlreadyExists();
        
        // Create the commitment with specified balance
        commitments[commitment] = true;
        commitmentBalances[commitment] = initialBalance;
        spentCommitments[commitment] = false;
        
        emit CommitmentAdded(commitment, block.timestamp);
    }

    /// @notice Lock collateral in a commitment (for protocol use)
    /// @param commitment The commitment to lock collateral in
    /// @param amount The amount to lock
    /// @param nullifier The nullifier to prevent double spending
    /// @param proof The ZK proof for the collateral lock
    function lockCollateral(
        bytes32 commitment,
        uint256 amount,
        bytes32 nullifier,
        uint256[8] calldata proof
    ) external whenNotPaused {
        if (commitment == bytes32(0)) revert InvalidAmount();
        if (amount == 0) revert InvalidAmount();
        if (!commitments[commitment]) revert CommitmentNotFound();
        if (nullifiers[nullifier]) revert NullifierAlreadyUsed();
        
        // Prepare ZK proof verification inputs
        uint256[] memory publicInputs = new uint256[](4);
        publicInputs[0] = uint256(commitment);
        publicInputs[1] = amount;
        publicInputs[2] = uint256(nullifier);
        publicInputs[3] = LOCK_DOMAIN;

        ProofLib.ZKProof memory zkLock = ProofLib.ZKProof({
            proof: proof,
            publicInputs: publicInputs,
            verifier: _transferCommitmentActionVerifierSynced()
        });
        zkLock.requireValidProof();
        
        nullifiers[nullifier] = true;
        _consumeCommitment(commitment, amount);
        
        uint256 currentTime = block.timestamp;
        emit NullifierUsed(nullifier, currentTime);
    }

    /// @notice Unlock collateral from a commitment (for protocol use)
    /// @param commitment The commitment to unlock collateral from
    /// @param amount The amount to unlock
    /// @param nullifier The nullifier to prevent double spending
    /// @param proof The ZK proof for the collateral unlock
    function unlockCollateral(
        bytes32 commitment,
        uint256 amount,
        bytes32 nullifier,
        uint256[8] calldata proof
    ) external whenNotPaused {
        if (commitment == bytes32(0)) revert InvalidAmount();
        if (amount == 0) revert InvalidAmount();
        if (!commitments[commitment]) revert CommitmentNotFound();
        if (nullifiers[nullifier]) revert NullifierAlreadyUsed();
        
        // Prepare ZK proof verification inputs
        uint256[] memory publicInputs = new uint256[](4);
        publicInputs[0] = uint256(commitment);
        publicInputs[1] = amount;
        publicInputs[2] = uint256(nullifier);
        publicInputs[3] = UNLOCK_DOMAIN;

        ProofLib.ZKProof memory zkUnlock = ProofLib.ZKProof({
            proof: proof,
            publicInputs: publicInputs,
            verifier: _transferCommitmentActionVerifierSynced()
        });
        zkUnlock.requireValidProof();
        
        nullifiers[nullifier] = true;
        commitmentBalances[commitment] += amount;
        spentCommitments[commitment] = false;
        
        emit NullifierUsed(nullifier, block.timestamp);
    }

    /// @notice Get the balance associated with a commitment
    /// @param commitment The commitment to check balance for
    /// @return The balance amount
    function getBalance(bytes32 commitment) external view returns (uint256) {
        // Return balance based on commitment tracking
        if (commitments[commitment] && !spentCommitments[commitment]) {
            return commitmentBalances[commitment];
        }
        return 0;
    }

    /// @notice Austrian Economic Principle: NO POOL MINTING
    /// @dev mintToPool function REMOVED to prevent monetary debasement
    /// "The boom can last only as long as the credit expansion progresses" - Ludwig von Mises
    /// 
    /// Pools should receive tokens through transfers from existing holders,
    /// not through arbitrary creation. This maintains the integrity of the fixed supply
    /// and prevents the artificial boom-bust cycles that Austrian economists warn against.

    /// @notice Internal function to lock collateral for protocol use
    /// @param commitment The commitment to lock collateral from
    /// @param amount The amount to lock
    function lockCollateralInternal(bytes32 commitment, uint256 amount) external whenNotPaused onlyAuthorizedContract {
        if (commitment == bytes32(0)) revert InvalidAmount();
        if (amount == 0) revert InvalidAmount();
        if (!commitments[commitment]) revert CommitmentNotFound();
        
        // Lock collateral by reducing available balance and tracking locked amount
        _consumeCommitment(commitment, amount);
        lockedCollateral[commitment] += amount;
        
        emit CollateralLocked(commitment, amount);
    }

    /// @notice Internal function to unlock collateral for protocol use
    /// @param commitment The commitment to unlock collateral from
    /// @param amount The amount to unlock
    function unlockCollateralInternal(bytes32 commitment, uint256 amount) 
        external 
        whenNotPaused 
        onlyAuthorizedContract 
    {
        if (commitment == bytes32(0)) revert InvalidAmount();
        if (amount == 0) revert InvalidAmount();
        if (!commitments[commitment]) revert CommitmentNotFound();
        if (lockedCollateral[commitment] < amount) revert InvalidAmount();
        
        // Unlock collateral by reducing locked amount and restoring available balance
        lockedCollateral[commitment] -= amount;
        commitmentBalances[commitment] += amount;
        spentCommitments[commitment] = false;
        
        emit CollateralUnlocked(commitment, amount);
    }

    /// @notice Internal function to transfer to pool for protocol use
    /// @param commitment The commitment to transfer from
    /// @param poolAddress The pool address to transfer to
    /// @param amount The amount to transfer
    function transferToPoolInternal(
        bytes32 commitment,
        address poolAddress,
        uint256 amount
    ) external whenNotPaused onlyAuthorizedContract {
        if (poolAddress == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (!commitments[commitment]) revert CommitmentNotFound();
        
        // Transfer tokens from commitment to pool's transparent balance
        _consumeCommitment(commitment, amount);
        transparentBalances[poolAddress] += amount;
        
        emit Transfer(address(0), poolAddress, amount);
        emit TransparentTransfer(address(0), poolAddress, amount);
    }

    /// @notice Internal function to transfer between commitments for protocol use
    /// @param fromCommitment The commitment to transfer from
    /// @param toCommitment The commitment to transfer to
    /// @param amount The amount to transfer
    function transferBetweenCommitmentsInternal(
        bytes32 fromCommitment,
        bytes32 toCommitment,
        uint256 amount
    ) external whenNotPaused onlyAuthorizedContract {
        if (fromCommitment == bytes32(0) || toCommitment == bytes32(0)) revert InvalidAmount();
        if (amount == 0) revert InvalidAmount();
        if (!commitments[fromCommitment]) revert CommitmentNotFound();
        if (commitmentBalances[fromCommitment] < amount) revert InvalidAmount();
        
        // Transfer balance between commitments
        _consumeCommitment(fromCommitment, amount);
        
        // Create the new commitment if it doesn't exist
        if (!commitments[toCommitment]) {
            commitments[toCommitment] = true;
            spentCommitments[toCommitment] = false;
            emit CommitmentAdded(toCommitment, block.timestamp);
        }
        
        commitmentBalances[toCommitment] += amount;
        spentCommitments[toCommitment] = false;
    }
    
    /**
     * @notice Sets ecosystem contract addresses for protocol integration
     * @dev Only owner can set these addresses to configure ecosystem contracts
     * @param _governanceContract Address of the governance contract
     * @param _stakingContract Address of the staking contract
     * @param _yieldFarmingContract Address of the yield farming contract
     */
    function setEcosystemContracts(
        address _governanceContract,
        address _stakingContract,
        address _yieldFarmingContract
    ) external onlyOwner {
        if (_governanceContract != address(0)) {
            ecosystem.governance = _governanceContract;
        }
        
        if (_stakingContract != address(0)) {
            ecosystem.staking = _stakingContract;
        }
        
        if (_yieldFarmingContract != address(0)) {
            ecosystem.yieldFarming = _yieldFarmingContract;
        }
    }

    // Getter functions for verifiers (for test compatibility)
    /// @notice Get the verifier factory address
    /// @return The address of the verifier factory
    function verifierFactory() external view returns (address) {
        return address(verifiers.factory);
    }

    /// @notice Get the transfer verifier address
    /// @return The address of the transfer verifier
    function transferVerifier() external view returns (address) {
        return verifiers.transfer;
    }

    /// @notice Get the mint verifier address
    /// @return The address of the mint verifier
    function mintVerifier() external view returns (address) {
        return verifiers.mint;
    }

}