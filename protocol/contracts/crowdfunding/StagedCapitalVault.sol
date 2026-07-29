// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ICommonErrors} from "../interfaces/ICommonErrors.sol";

/**
 * @title StagedCapitalVault
 * @author Aegis Protocol Team
 * @notice VC-style staged capital: sequential milestones, M-of-N committee attestation (EIP-712),
 *         hard cap / min raise, and pro-rata refunds on failure.
 * @dev Complements `AegisCrowdShield` + `VoluntaryCampaignManager` with a **deal-native** flow:
 *      fewer investors, committee-gated releases, and optional `stealthCommitment` labels for
 *      off-chain cap-table privacy (on-chain accounting remains `msg.sender` for refunds unless
 *      a future ZK withdrawal rail is wired).
 *      Optional `investorMerkleRoot` (OpenZeppelin merkle-tree leaf for `msg.sender`) restricts commits.
 */
contract StagedCapitalVault is ReentrancyGuard, EIP712, ICommonErrors {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    uint256 public constant MAX_COMMITTEE = 24;
    uint256 public constant MAX_MILESTONES = 24;
    uint256 public constant BASIS_POINTS = 10_000;

    bytes32 private constant MILESTONE_ATTESTATION_TYPEHASH =
        keccak256("MilestoneAttestation(uint256 roundId,uint256 milestoneIndex,bytes32 evidenceHash)");

    enum RoundStatus {
        Funding,
        Failed,
        Active,
        Completed
    }

    struct Round {
        IERC20 token;
        address founder;
        uint256 hardCap;
        uint256 minRaise;
        uint256 startTime;
        uint256 endTime;
        uint256 totalRaised;
        RoundStatus status;
        uint8 milestoneCount;
        uint8 committeeThreshold;
        uint8 nextMilestone;
        /// @dev `bytes32(0)` = open round; else commits must prove `computeInvestorLeaf(msg.sender)`.
        bytes32 investorMerkleRoot;
        uint16[] releaseBps;
    }

    uint256 public nextRoundId;
    mapping(uint256 => Round) private _rounds;
    mapping(uint256 => address[]) private _committee;
    mapping(uint256 => mapping(address => bool)) public isCommitteeMember;
    mapping(uint256 => mapping(uint256 => uint256)) public milestonePayout;
    mapping(uint256 => mapping(uint256 => bool)) public milestoneAttested;
    mapping(uint256 => mapping(uint256 => bool)) public milestoneClaimed;
    mapping(uint256 => mapping(address => uint256)) public deposits;

    event RoundCreated(
        uint256 indexed roundId,
        address indexed founder,
        address indexed token,
        uint256 hardCap,
        uint256 minRaise,
        uint256 startTime,
        uint256 endTime,
        uint256 committeeSize,
        uint256 committeeThreshold,
        bytes32 investorMerkleRoot
    );
    event CapitalCommitted(
        uint256 indexed roundId,
        address indexed contributor,
        uint256 amount,
        uint256 newTotalRaised,
        bytes32 stealthCommitment
    );
    event RoundFinalized(uint256 indexed roundId, RoundStatus status, uint256 totalRaised);
    event MilestoneAttested(uint256 indexed roundId, uint256 milestoneIndex, bytes32 evidenceHash);
    event MilestoneClaimed(uint256 indexed roundId, uint256 milestoneIndex, address indexed founder, uint256 amount);
    event Refunded(uint256 indexed roundId, address indexed contributor, uint256 amount);

    error RoundNotFound();
    error InvalidRoundTimes();
    error InvalidCaps();
    error InvalidCommittee();
    error InvalidMilestones();
    error FundingNotOpen();
    error FundingClosed();
    error RoundNotFailed();
    error NothingToRefund();
    error RoundNotFinalizable();
    error RoundNotActive();
    error InvalidMilestoneIndex();
    error MilestoneOutOfOrder();
    error MilestoneAlreadyAttested();
    error MilestoneNotAttested();
    error MilestoneAlreadyClaimed();
    error InsufficientSignatures();
    error DuplicateSigner();
    error InvalidSigner();
    error CommitteeNotMember();
    error AllowlistInvalid();
    error UnexpectedMerkleProof();

    constructor() EIP712("AegisStagedCapital", "1") {}

    /**
     * @notice Leaf hash for the optional investor allowlist (matches OpenZeppelin merkle-tree `AddressValue` encoding).
     * @dev Leaf = `keccak256(bytes.concat(keccak256(abi.encode(account))))`.
     */
    function computeInvestorLeaf(address account) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account))));
    }

    function getRound(uint256 roundId) external view returns (Round memory) {
        return _rounds[roundId];
    }

    function getCommittee(uint256 roundId) external view returns (address[] memory) {
        return _committee[roundId];
    }

    /**
     * @notice Create a new staged capital round.
     * @param token ERC20 investors pay in (must not be zero address).
     * @param founder Receives milestone payouts (typically a multisig).
     * @param committee Addresses that may sign EIP-712 milestone attestations (unique).
     * @param committeeThreshold M-of-N threshold (1 <= threshold <= committee.length).
     * @param hardCap Maximum raise; no deposits accepted above this.
     * @param minRaise If not reached by endTime, round fails and refunds open.
     * @param startTime Earliest deposit timestamp (inclusive).
     * @param endTime Latest deposit timestamp (inclusive).
     * @param releaseBps Basis points per milestone, sequential; must sum to 10_000.
     * @param investorMerkleRoot Zero = any address may commit; non-zero = commits must include a valid Merkle proof
     *        for `computeInvestorLeaf(msg.sender)` (off-chain tree: OpenZeppelin merkle-tree npm package).
     */
    function createRound(
        IERC20 token,
        address founder,
        address[] calldata committee,
        uint256 committeeThreshold,
        uint256 hardCap,
        uint256 minRaise,
        uint256 startTime,
        uint256 endTime,
        uint16[] calldata releaseBps,
        bytes32 investorMerkleRoot
    ) external returns (uint256 roundId) {
        if (address(token) == address(0)) revert ZeroAddress();
        if (founder == address(0)) revert ZeroAddress();
        if (startTime >= endTime) revert InvalidRoundTimes();
        if (hardCap == 0 || minRaise == 0 || minRaise > hardCap) revert InvalidCaps();
        if (committee.length == 0 || committee.length > MAX_COMMITTEE) revert InvalidCommittee();
        if (committeeThreshold == 0 || committeeThreshold > committee.length) revert InvalidCommittee();
        if (committeeThreshold > type(uint8).max) revert InvalidCommittee();
        if (releaseBps.length == 0 || releaseBps.length > MAX_MILESTONES) revert InvalidMilestones();

        uint256 bpsSum;
        for (uint256 i = 0; i < releaseBps.length; ++i) {
            bpsSum += uint256(releaseBps[i]);
        }
        if (bpsSum != BASIS_POINTS) revert InvalidMilestones();

        for (uint256 i = 0; i < committee.length; ++i) {
            if (committee[i] == address(0)) revert ZeroAddress();
            for (uint256 j = i + 1; j < committee.length; ++j) {
                if (committee[i] == committee[j]) revert InvalidCommittee();
            }
        }

        roundId = ++nextRoundId;
        Round storage r = _rounds[roundId];
        r.token = token;
        r.founder = founder;
        r.hardCap = hardCap;
        r.minRaise = minRaise;
        r.startTime = startTime;
        r.endTime = endTime;
        r.status = RoundStatus.Funding;
        r.milestoneCount = uint8(releaseBps.length);
        r.committeeThreshold = uint8(committeeThreshold); // checked above against max uint8
        r.nextMilestone = 0;
        r.investorMerkleRoot = investorMerkleRoot;

        for (uint256 i = 0; i < releaseBps.length; ++i) {
            r.releaseBps.push(releaseBps[i]);
        }

        _committee[roundId] = new address[](committee.length);
        for (uint256 i = 0; i < committee.length; ++i) {
            address m = committee[i];
            _committee[roundId][i] = m;
            isCommitteeMember[roundId][m] = true;
        }

        emit RoundCreated(
            roundId,
            founder,
            address(token),
            hardCap,
            minRaise,
            startTime,
            endTime,
            committee.length,
            committeeThreshold,
            investorMerkleRoot
        );
    }

    /**
     * @notice Commit capital during the funding window.
     * @param stealthCommitment Optional opaque label (commitment / tag) for off-chain cap-table privacy.
     *                          Does not change accounting; refunds remain `msg.sender`.
     * @param merkleProof Sibling path proving `computeInvestorLeaf(msg.sender)` under `investorMerkleRoot`;
     *                    must be empty when root is zero.
     */
    function commitCapital(
        uint256 roundId,
        uint256 amount,
        bytes32 stealthCommitment,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Round storage r = _rounds[roundId];
        if (r.founder == address(0)) revert RoundNotFound();
        if (r.status != RoundStatus.Funding) revert FundingClosed();
        if (block.timestamp < r.startTime || block.timestamp > r.endTime) revert FundingNotOpen();

        if (r.investorMerkleRoot == bytes32(0)) {
            if (merkleProof.length != 0) revert UnexpectedMerkleProof();
        } else {
            bytes32 leaf = computeInvestorLeaf(msg.sender);
            if (!MerkleProof.verifyCalldata(merkleProof, r.investorMerkleRoot, leaf)) {
                revert AllowlistInvalid();
            }
        }

        uint256 remaining = r.hardCap - r.totalRaised;
        if (amount > remaining) revert InsufficientBalance();

        r.totalRaised += amount;
        deposits[roundId][msg.sender] += amount;

        r.token.safeTransferFrom(msg.sender, address(this), amount);

        emit CapitalCommitted(roundId, msg.sender, amount, r.totalRaised, stealthCommitment);
    }

    /**
     * @notice Finalize a round after `endTime`. Sets Failed (refunds) or Active (milestones).
     */
    function finalizeRound(uint256 roundId) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (r.founder == address(0)) revert RoundNotFound();
        if (r.status != RoundStatus.Funding) revert RoundNotFinalizable();
        if (block.timestamp <= r.endTime) revert RoundNotFinalizable();

        if (r.totalRaised < r.minRaise) {
            r.status = RoundStatus.Failed;
            emit RoundFinalized(roundId, RoundStatus.Failed, r.totalRaised);
            return;
        }

        r.status = RoundStatus.Active;
        _computeMilestonePayouts(roundId, r);
        emit RoundFinalized(roundId, RoundStatus.Active, r.totalRaised);
    }

    /**
     * @notice Refund principal on a failed round.
     */
    function refund(uint256 roundId) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (r.founder == address(0)) revert RoundNotFound();
        if (r.status != RoundStatus.Failed) revert RoundNotFailed();

        uint256 amount = deposits[roundId][msg.sender];
        if (amount == 0) revert NothingToRefund();

        deposits[roundId][msg.sender] = 0;
        r.token.safeTransfer(msg.sender, amount);

        emit Refunded(roundId, msg.sender, amount);
    }

    /**
     * @notice Committee attests the current milestone (strictly sequential).
     */
    function attestMilestone(
        uint256 roundId,
        uint256 milestoneIndex,
        bytes32 evidenceHash,
        address[] calldata signers,
        bytes[] calldata signatures
    ) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (r.founder == address(0)) revert RoundNotFound();
        if (r.status != RoundStatus.Active) revert RoundNotActive();
        if (milestoneIndex >= uint256(r.milestoneCount)) revert InvalidMilestoneIndex();
        if (milestoneIndex != uint256(r.nextMilestone)) revert MilestoneOutOfOrder();
        if (milestoneAttested[roundId][milestoneIndex]) revert MilestoneAlreadyAttested();

        if (signers.length != signatures.length) revert MismatchedArrays();
        if (signers.length < uint256(r.committeeThreshold)) revert InsufficientSignatures();

        _assertUniqueSigners(signers);
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(MILESTONE_ATTESTATION_TYPEHASH, roundId, milestoneIndex, evidenceHash))
        );

        for (uint256 i = 0; i < signers.length; ++i) {
            address signer = signers[i];
            if (!isCommitteeMember[roundId][signer]) revert CommitteeNotMember();
            address recovered = digest.recover(signatures[i]);
            if (recovered != signer) revert InvalidSigner();
        }

        milestoneAttested[roundId][milestoneIndex] = true;
        emit MilestoneAttested(roundId, milestoneIndex, evidenceHash);
    }

    /**
     * @notice Founder claims payout for the current attested milestone (strictly sequential).
     */
    function claimMilestone(uint256 roundId) external nonReentrant {
        Round storage r = _rounds[roundId];
        if (r.founder == address(0)) revert RoundNotFound();
        if (r.status != RoundStatus.Active) revert RoundNotActive();
        if (msg.sender != r.founder) revert UnauthorizedAccess();

        uint256 idx = uint256(r.nextMilestone);
        if (idx >= uint256(r.milestoneCount)) revert InvalidMilestoneIndex();
        if (!milestoneAttested[roundId][idx]) revert MilestoneNotAttested();
        if (milestoneClaimed[roundId][idx]) revert MilestoneAlreadyClaimed();

        uint256 payout = milestonePayout[roundId][idx];
        milestoneClaimed[roundId][idx] = true;
        unchecked {
            r.nextMilestone += 1;
        }

        r.token.safeTransfer(r.founder, payout);
        emit MilestoneClaimed(roundId, idx, r.founder, payout);

        if (r.nextMilestone == r.milestoneCount) {
            r.status = RoundStatus.Completed;
        }
    }

    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getAttestationDigest(uint256 roundId, uint256 milestoneIndex, bytes32 evidenceHash)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(MILESTONE_ATTESTATION_TYPEHASH, roundId, milestoneIndex, evidenceHash))
        );
    }

    function _computeMilestonePayouts(uint256 roundId, Round storage r) internal {
        uint256 total = r.totalRaised;
        uint256 n = uint256(r.milestoneCount);
        uint256 assigned;
        for (uint256 i = 0; i < n - 1; ++i) {
            uint256 payout = (total * uint256(r.releaseBps[i])) / BASIS_POINTS;
            milestonePayout[roundId][i] = payout;
            assigned += payout;
        }
        milestonePayout[roundId][n - 1] = total - assigned;
    }

    function _assertUniqueSigners(address[] calldata signers) internal pure {
        for (uint256 i = 0; i < signers.length; ++i) {
            for (uint256 j = i + 1; j < signers.length; ++j) {
                if (signers[i] == signers[j]) revert DuplicateSigner();
            }
        }
    }
}
