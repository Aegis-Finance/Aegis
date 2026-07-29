// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IVerifier} from "./interfaces/IVerifier.sol";
import {ICommonErrors} from "./interfaces/ICommonErrors.sol";

/**
 * @title Groth16Verifier
 * @author Aegis Protocol Team
 * @dev Production-grade Groth16 ZK proof verifier with trusted setup ceremony validation
 * @notice Implements cryptographically secure zero-knowledge proof verification
 * 
 * This contract provides real ZK proof verification using the Groth16 proving system.
 * It ensures privacy, prevents double-spending, and enforces cryptographic constraints.
 * Additionally, it tracks and validates trusted setup ceremony metadata for security.
 */
contract Groth16Verifier is IVerifier, ICommonErrors {
    
    // Groth16 verification key components
    struct VerifyingKey {
        uint256[2] alpha;
        uint256[2][2] beta;
        uint256[2][2] gamma;
        uint256[2][2] delta;
        uint256[2][] ic;
    }
    
    // Groth16 proof structure
    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }
    
    // Trusted setup ceremony metadata
    struct CeremonyMetadata {
        bytes32 ceremonyId;           // Unique ceremony identifier
        uint256 participantCount;     // Number of ceremony participants
        bytes32 transcriptHash;       // Hash of the ceremony transcript
        uint256 setupTimestamp;      // When the ceremony was completed
        bool isProduction;           // True for production ceremony, false for development
        string circuitName;          // Name of the circuit this key is for
        bytes32 powersOfTauHash;     // Hash of the Powers of Tau used
    }
    
    /// @notice The verification key for this circuit
    VerifyingKey private verifyingKey;
    
    /// @notice Hash of the verification key for integrity checking
    bytes32 public immutable VERIFICATION_KEY_HASH;
    
    /// @notice Ceremony metadata for this verification key
    CeremonyMetadata public CEREMONY_METADATA;
    
    /// @notice Prime field modulus for BN254 curve
    uint256 private constant PRIME_Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583;
    
    /// @notice Curve order (number of points) for BN254 curve
    uint256 private constant CURVE_ORDER = 
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    
    /// @notice Custom errors for better gas efficiency

    /// @notice Events for ceremony tracking
    event VerificationKeyDeployed(
        bytes32 indexed vkHash,
        bytes32 indexed ceremonyId,
        string circuitName,
        bool isProduction
    );
    
    /**
     * @notice Constructor to initialize the verifier with a verification key and ceremony metadata
     * @param _verifyingKey The Groth16 verification key for the circuit
     * @param _ceremonyMetadata Metadata about the trusted setup ceremony
     */
    constructor(
        VerifyingKey memory _verifyingKey,
        CeremonyMetadata memory _ceremonyMetadata
    ) {
        // Validate verification key
        if (_verifyingKey.ic.length == 0) revert InvalidVerificationKey();
        
        // Validate ceremony metadata
        _validateCeremonyMetadata(_ceremonyMetadata);
        
        // Store verification key and metadata
        verifyingKey = _verifyingKey;
        VERIFICATION_KEY_HASH = keccak256(abi.encode(_verifyingKey));
        CEREMONY_METADATA = _ceremonyMetadata;
        
        emit VerificationKeyDeployed(
            VERIFICATION_KEY_HASH,
            _ceremonyMetadata.ceremonyId,
            _ceremonyMetadata.circuitName,
            _ceremonyMetadata.isProduction
        );
    }
    
    /**
     * @notice Validates ceremony metadata for security requirements
     * @param metadata The ceremony metadata to validate
     */
    function _validateCeremonyMetadata(CeremonyMetadata memory metadata) private view {
        // Basic validation
        if (metadata.ceremonyId == bytes32(0)) revert InvalidCeremonyMetadata();
        if (metadata.transcriptHash == bytes32(0)) revert InvalidCeremonyMetadata();
        if (metadata.powersOfTauHash == bytes32(0)) revert InvalidCeremonyMetadata();
        if (bytes(metadata.circuitName).length == 0) revert EmptyCircuitName();
        
        // Production ceremony requirements
        if (metadata.isProduction) {
            // Require minimum 3 participants for production
            if (metadata.participantCount < 3) revert InsufficientParticipants();
            
            // Require reasonable timestamp (not in future, not too old)
            if (metadata.setupTimestamp > block.timestamp) revert InvalidCeremonyTimestamp();
            if (block.timestamp - metadata.setupTimestamp > 365 days) revert InvalidCeremonyTimestamp();
        }
    }
    
    /**
     * @notice Gets the verification key hash
     * @return bytes32 The hash of the verification key
     */
    function getVerificationKeyHash() external view override returns (bytes32) {
        return VERIFICATION_KEY_HASH;
    }
    
    /**
     * @notice Gets the ceremony metadata for this verifier
     * @return CeremonyMetadata The ceremony metadata
     */
    function getCeremonyMetadata() external view returns (CeremonyMetadata memory) {
        return CEREMONY_METADATA;
    }
    
    /**
     * @notice Checks if this verifier uses a production ceremony key
     * @return bool True if production ceremony, false if development
     */
    function isProductionKey() external view returns (bool) {
        return CEREMONY_METADATA.isProduction;
    }
    
    /**
     * @notice Gets the ceremony ID for this verifier
     * @return bytes32 The ceremony identifier
     */
    function getCeremonyId() external view returns (bytes32) {
        return CEREMONY_METADATA.ceremonyId;
    }
    
    /**
     * @notice Gets the ceremony transcript hash for verification
     * @return bytes32 The hash of the ceremony transcript
     */
    function getCeremonyTranscriptHash() external view returns (bytes32) {
        return CEREMONY_METADATA.transcriptHash;
    }
    
    /**
     * @notice Validates that this verifier is safe for production use
     * @dev Reverts if using development keys in production context
     */
    function validateProductionSafety() external view {
        // This function can be called by other contracts to ensure production safety
        if (!CEREMONY_METADATA.isProduction) {
            revert DevelopmentKeyInProduction();
        }
        
        // Additional production safety checks
        if (CEREMONY_METADATA.participantCount < 3) {
            revert InsufficientParticipants();
        }
    }
    
    /**
     * @notice Verifies ceremony transcript integrity (placeholder for future implementation)
     * @param transcriptData The ceremony transcript data to verify
     * @return bool True if transcript is valid
     * @dev This is a placeholder for future on-chain ceremony verification
     */
    function verifyCeremonyTranscript(bytes calldata transcriptData) external view returns (bool) {
        // Verify the provided transcript matches our stored hash
        bytes32 providedHash = keccak256(transcriptData);
        return providedHash == CEREMONY_METADATA.transcriptHash;
    }
    
    /**
     * @notice Verifies a Groth16 proof
     * @param proof The proof elements [a_x, a_y, b_x0, b_x1, b_y0, b_y1, c_x, c_y]
     * @param publicInputs Array of public inputs to the circuit
     * @return bool True if the proof is valid, false otherwise
     */
    function verifyProof(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external view override returns (bool) {
        // Validate input lengths
        if (proof.length != 8) revert InvalidProofLength();
        if (publicInputs.length + 1 != verifyingKey.ic.length) revert InvalidPublicInputsLength();
        
        // Validate field elements
        for (uint256 i = 0; i < 8; i++) {
            if (proof[i] >= PRIME_Q) revert InvalidFieldElement();
        }
        for (uint256 i = 0; i < publicInputs.length; i++) {
            if (publicInputs[i] >= PRIME_Q) revert InvalidFieldElement();
        }
        
        // Parse proof components
        Proof memory proofStruct = Proof({
            a: [proof[0], proof[1]],
            b: [[proof[2], proof[3]], [proof[4], proof[5]]],
            c: [proof[6], proof[7]]
        });
        
        // Compute vkX = IC[0] + sum(IC[i+1] * public_input[i])
        uint256[2] memory vkX = verifyingKey.ic[0];
        for (uint256 i = 0; i < publicInputs.length; i++) {
            vkX = _addG1(vkX, _scalarMulG1(verifyingKey.ic[i + 1], publicInputs[i]));
        }

        // Verify the pairing equation:
        // e(A, B) = e(alpha, beta) * e(vkX, gamma) * e(C, delta)
        return _verifyPairing(proofStruct, vkX);
    }
    
    /**
     * @notice Gets the current verification key
     * @return VerifyingKey The current verification key
     */
    function getVerifyingKey() external view returns (VerifyingKey memory) {
        return verifyingKey;
    }
    
    // Internal functions for cryptographic operations
    
    /**
     * @notice Verifies the pairing equation for Groth16
     * @dev Verifies the pairing equation for Groth16
     * @param proof The parsed proof structure
     * @param vkX The computed vkX value
     * @return bool True if pairing equation holds
     */
    function _verifyPairing(Proof memory proof, uint256[2] memory vkX) internal view returns (bool) {
        if (!_basicProofValidation(proof, vkX)) return false;

        uint256[2][2] memory betaNeg = _negateG2Y(verifyingKey.beta);
        uint256[2][2] memory gammaNeg = _negateG2Y(verifyingKey.gamma);
        uint256[2][2] memory deltaNeg = _negateG2Y(verifyingKey.delta);

        uint256[24] memory pairingValues;
        uint256 cursor = 0;

        // e(A, B)
        pairingValues[cursor++] = proof.a[0];
        pairingValues[cursor++] = proof.a[1];
        pairingValues[cursor++] = proof.b[0][1];
        pairingValues[cursor++] = proof.b[0][0];
        pairingValues[cursor++] = proof.b[1][1];
        pairingValues[cursor++] = proof.b[1][0];

        // e(-alpha, beta) = e(alpha, -beta)
        pairingValues[cursor++] = verifyingKey.alpha[0];
        pairingValues[cursor++] = verifyingKey.alpha[1];
        pairingValues[cursor++] = betaNeg[0][1];
        pairingValues[cursor++] = betaNeg[0][0];
        pairingValues[cursor++] = betaNeg[1][1];
        pairingValues[cursor++] = betaNeg[1][0];

        // e(-vkX, gamma) = e(vkX, -gamma)
        pairingValues[cursor++] = vkX[0];
        pairingValues[cursor++] = vkX[1];
        pairingValues[cursor++] = gammaNeg[0][1];
        pairingValues[cursor++] = gammaNeg[0][0];
        pairingValues[cursor++] = gammaNeg[1][1];
        pairingValues[cursor++] = gammaNeg[1][0];

        // e(-C, delta) = e(C, -delta)
        pairingValues[cursor++] = proof.c[0];
        pairingValues[cursor++] = proof.c[1];
        pairingValues[cursor++] = deltaNeg[0][1];
        pairingValues[cursor++] = deltaNeg[0][0];
        pairingValues[cursor++] = deltaNeg[1][1];
        pairingValues[cursor++] = deltaNeg[1][0];

        bytes memory pairingInput = abi.encodePacked(pairingValues);

        (bool success, bytes memory result) = address(0x08).staticcall(pairingInput);

        if (!success) return false;
        if (result.length != 32) return false;

        return abi.decode(result, (uint256)) == 1;
    }
    
    /**
     * @notice Comprehensive proof validation for Groth16 proofs
     * @dev Comprehensive proof validation for Groth16 proofs
     * @param proof The Groth16 proof structure to validate
     * @param vkX The computed verification key point
     * @return bool True if all validation checks pass
     */
    function _basicProofValidation(Proof memory proof, uint256[2] memory vkX) internal pure returns (bool) {
        // Validate proof.a is a valid non-zero G1 point
        if (!_isValidG1Point(proof.a)) return false;
        if (proof.a[0] == 0 && proof.a[1] == 0) return false; // Cannot be point at infinity
        
        // Validate proof.b is a valid non-zero G2 point
        if (!_isValidG2Point(proof.b)) return false;
        if (_isG2PointAtInfinity(proof.b)) return false; // Cannot be point at infinity
        
        // Validate proof.c is a valid non-zero G1 point
        if (!_isValidG1Point(proof.c)) return false;
        if (proof.c[0] == 0 && proof.c[1] == 0) return false; // Cannot be point at infinity
        
        // Validate vkX is a valid G1 point (can be point at infinity)
        if (!_isValidG1Point(vkX)) return false;
        
        // Additional cryptographic validation
        // Check that proof components are in the correct subgroup
        if (!_isInG1Subgroup(proof.a)) return false;
        if (!_isInG1Subgroup(proof.c)) return false;
        if (!_isInG2Subgroup(proof.b)) return false;
        
        // Validate field elements are properly reduced
        if (proof.a[0] >= PRIME_Q || proof.a[1] >= PRIME_Q) return false;
        if (proof.c[0] >= PRIME_Q || proof.c[1] >= PRIME_Q) return false;
        if (vkX[0] >= PRIME_Q || vkX[1] >= PRIME_Q) return false;
        
        for (uint256 i = 0; i < 2; i++) {
            for (uint256 j = 0; j < 2; j++) {
                if (proof.b[i][j] >= PRIME_Q) return false;
            }
        }
        
        return true;
    }
    
    /**
     * @notice Validates if a point is a valid G1 point
     * @dev Validates if a point is a valid G1 point
     * @param point The G1 point to validate [x, y]
     * @return bool True if the point is valid, false otherwise
     */
    function _isValidG1Point(uint256[2] memory point) internal pure returns (bool) {
        return _isOnCurveG1(point);
    }
    
    /**
     * @notice Validates if a point is a valid G2 point
     * @dev Validates if a point is a valid G2 point
     * @param point The G2 point to validate [[x0, x1], [y0, y1]]
     * @return bool True if the point is valid, false otherwise
     */
    function _isValidG2Point(uint256[2][2] memory point) internal pure returns (bool) {
        return _isOnCurveG2(point);
    }
    
    /**
     * @notice Checks if G2 point is at infinity
     * @dev Checks if G2 point is at infinity
     * @param point The G2 point to check [[x0, x1], [y0, y1]]
     * @return bool True if the point is at infinity, false otherwise
     */
    function _isG2PointAtInfinity(uint256[2][2] memory point) internal pure returns (bool) {
        return (point[0][0] == 0 && point[0][1] == 0 && point[1][0] == 0 && point[1][1] == 0);
    }
    
    /**
     * @notice Checks if G1 point is in the correct subgroup with proper cofactor validation
     * @dev Checks if G1 point is in the correct subgroup with proper cofactor validation
     * @param point The G1 point to check
     * @return bool True if the point is in the correct subgroup
     */
    function _isInG1Subgroup(uint256[2] memory point) internal pure returns (bool) {
        // First check if point is on the curve
        if (!_isOnCurveG1(point)) return false;
        
        // Point at infinity is always in the subgroup
        if (point[0] == 0 && point[1] == 0) return true;
        
        // For BN254, the cofactor for G1 is 1, meaning all points on the curve are in the subgroup
        // However, we still need to verify this by checking that r * P = O (point at infinity)
        // where r is the curve order
        uint256[2] memory result = _scalarMulG1(point, CURVE_ORDER);
        
        // The result should be the point at infinity
        return (result[0] == 0 && result[1] == 0);
    }
    
    /**
     * @notice Checks if G2 point is in the correct subgroup with proper cofactor validation
     * @dev Checks if G2 point is in the correct subgroup with proper cofactor validation
     * @param point The G2 point to check
     * @return bool True if the point is in the correct subgroup
     */
    function _isInG2Subgroup(uint256[2][2] memory point) internal pure returns (bool) {
        // First check if point is on the curve
        if (!_isOnCurveG2(point)) return false;
        
        // Point at infinity is always in the subgroup
        if (_isG2PointAtInfinity(point)) return true;
        
        // For BN254, G2 has cofactor h = 21888242871839275222246405745257275088844257914179612981679871602714643921549
        // We need to check that cofactor * P = O or that the point has order dividing the curve order
        // Since cofactor multiplication is expensive, we use an alternative approach:
        // Check that the point satisfies the subgroup equation by verifying r * P = O
        uint256[2][2] memory result = _scalarMulG2(point, CURVE_ORDER);
        
        // The result should be the point at infinity
        return _isG2PointAtInfinity(result);
    }
    
    /**
     * @notice Scalar multiplication on G2 using double-and-add algorithm
     * @dev Scalar multiplication on G2 using double-and-add algorithm
     * @param point The G2 point to multiply
     * @param scalar The scalar to multiply by
     * @return result The result of scalar * point
     */
    function _scalarMulG2(uint256[2][2] memory point, uint256 scalar) internal pure returns (uint256[2][2] memory) {
        // Handle edge cases
        if (scalar == 0) return [[uint256(0), uint256(0)], [uint256(0), uint256(0)]]; // Point at infinity
        if (_isG2PointAtInfinity(point)) return point; // scalar * O = O
        if (scalar == 1) return point; // 1 * P = P
        
        // Reduce scalar modulo curve order
        scalar = scalar % CURVE_ORDER;
        if (scalar == 0) return [[uint256(0), uint256(0)], [uint256(0), uint256(0)]];
        
        // Double-and-add algorithm for G2 scalar multiplication
        uint256[2][2] memory result = [[uint256(0), uint256(0)], [uint256(0), uint256(0)]]; // Point at infinity
        uint256[2][2] memory addend = point; // Current power of 2 multiple of point
        
        while (scalar > 0) {
            // If current bit is 1, add current power of 2 multiple to result
            if (scalar & 1 == 1) {
                result = _addG2(result, addend);
            }
            
            // Double the addend for next iteration
            addend = _doubleG2(addend);
            
            // Move to next bit
            scalar = scalar >> 1;
        }
        
        return result;
    }
    
    /**
     * @notice Adds two points on G2 using proper elliptic curve point addition with Fp2 arithmetic
     * @dev Adds two points on G2 using proper elliptic curve point addition with Fp2 arithmetic
     * @param a First G2 point [[x1_0, x1_1], [y1_0, y1_1]]
     * @param b Second G2 point [[x2_0, x2_1], [y2_0, y2_1]]
     * @return result The sum of the two points
     */
    function _addG2(uint256[2][2] memory a, uint256[2][2] memory b) internal pure returns (uint256[2][2] memory) {
        // Handle point at infinity cases
        if (_isG2PointAtInfinity(a)) return b;
        if (_isG2PointAtInfinity(b)) return a;
        
        // If points are the same, use point doubling
        if (_isG2PointEqual(a, b)) {
            return _doubleG2(a);
        }
        
        // If points have same x but different y, result is point at infinity
        if (_isG2XEqual(a, b)) {
            return [[uint256(0), uint256(0)], [uint256(0), uint256(0)]];
        }
        
        return _performG2Addition(a, b);
    }
    
    /**
     * @notice Performs the core G2 point addition calculation
     * @dev Implements elliptic curve point addition formula in Fp2
     * @param a First G2 point [[x1_0, x1_1], [y1_0, y1_1]]
     * @param b Second G2 point [[x2_0, x2_1], [y2_0, y2_1]]
     * @return result The sum of the two points
     */
    function _performG2Addition(uint256[2][2] memory a, uint256[2][2] memory b) 
        internal 
        pure 
        returns (uint256[2][2] memory) 
    {
        // Extract coordinates as Fp2 elements
        uint256[2] memory x1 = [a[0][0], a[0][1]];
        uint256[2] memory y1 = [a[1][0], a[1][1]];
        uint256[2] memory x2 = [b[0][0], b[0][1]];
        uint256[2] memory y2 = [b[1][0], b[1][1]];
        
        // Calculate slope λ = (y2 - y1) / (x2 - x1)
        uint256[2] memory lambda = _calculateG2Slope(x1, y1, x2, y2);
        
        // Calculate result coordinates
        return _calculateG2Result(x1, y1, x2, lambda);
    }
    
    /**
     * @notice Calculates the slope for G2 point addition
     * @dev Computes λ = (y2 - y1) / (x2 - x1) in Fp2
     * @param x1 First point x coordinate
     * @param y1 First point y coordinate
     * @param x2 Second point x coordinate
     * @param y2 Second point y coordinate
     * @return lambda The slope value
     */
    function _calculateG2Slope(
        uint256[2] memory x1, 
        uint256[2] memory y1, 
        uint256[2] memory x2, 
        uint256[2] memory y2
    ) internal pure returns (uint256[2] memory) {
        uint256[2] memory xDiff = _subFp2(x2, x1);
        uint256[2] memory yDiff = _subFp2(y2, y1);
        uint256[2] memory xDiffInv = _invFp2(xDiff);
        return _mulFp2(yDiff, xDiffInv);
    }
    
    /**
     * @notice Calculates the final result coordinates for G2 point addition
     * @dev Computes x3 = λ^2 - x1 - x2 and y3 = λ*(x1 - x3) - y1
     * @param x1 First point x coordinate
     * @param y1 First point y coordinate
     * @param x2 Second point x coordinate
     * @param lambda The slope value
     * @return result The resulting G2 point
     */
    function _calculateG2Result(
        uint256[2] memory x1, 
        uint256[2] memory y1, 
        uint256[2] memory x2, 
        uint256[2] memory lambda
    ) internal pure returns (uint256[2][2] memory) {
        // Calculate x3 = λ^2 - x1 - x2
        uint256[2] memory lambdaSquared = _squareFp2(lambda);
        uint256[2] memory x1PlusX2 = _addFp2(x1, x2);
        uint256[2] memory x3 = _subFp2(lambdaSquared, x1PlusX2);
        
        // Calculate y3 = λ*(x1 - x3) - y1
        uint256[2] memory x1MinusX3 = _subFp2(x1, x3);
        uint256[2] memory lambdaTimesXDiff = _mulFp2(lambda, x1MinusX3);
        uint256[2] memory y3 = _subFp2(lambdaTimesXDiff, y1);
        
        return [[x3[0], x3[1]], [y3[0], y3[1]]];
    }
    
    /**
     * @notice Doubles a G2 point (point addition with itself) using proper Fp2 arithmetic
     * @dev Doubles a G2 point (point addition with itself) using proper Fp2 arithmetic
     * @param point The G2 point to double [[x0, x1], [y0, y1]]
     * @return result The doubled point
     */
    function _doubleG2(uint256[2][2] memory point) internal pure returns (uint256[2][2] memory) {
        if (_isG2PointAtInfinity(point)) return point; // Point at infinity
        
        // Extract coordinates as Fp2 elements
        uint256[2] memory x = [point[0][0], point[0][1]];
        uint256[2] memory y = [point[1][0], point[1][1]];
        
        // Check if y = 0, which means the tangent is vertical and result is point at infinity
        if (_isZeroFp2(y)) {
            return [[uint256(0), uint256(0)], [uint256(0), uint256(0)]];
        }
        
        // Point doubling formula for elliptic curves in Fp2:
        // For curve Y^2 = X^3 + b, the doubling formula is:
        // λ = (3*X^2) / (2*Y)
        // X' = λ^2 - 2*X
        // Y' = λ*(X - X') - Y
        
        // Calculate 3*X^2
        uint256[2] memory xSquared = _squareFp2(x);
        uint256[2] memory threeXSquared = _scalarMulFp2(xSquared, 3);
        
        // Calculate 2*Y
        uint256[2] memory twoY = _scalarMulFp2(y, 2);
        
        // Calculate λ = (3*X^2) / (2*Y) = (3*X^2) * (2*Y)^(-1)
        uint256[2] memory twoYInv = _invFp2(twoY);
        uint256[2] memory lambda = _mulFp2(threeXSquared, twoYInv);
        
        // Calculate X' = λ^2 - 2*X
        uint256[2] memory lambdaSquared = _squareFp2(lambda);
        uint256[2] memory twoX = _scalarMulFp2(x, 2);
        uint256[2] memory xNew = _subFp2(lambdaSquared, twoX);
        
        // Calculate Y' = λ*(X - X') - Y
        uint256[2] memory xDiff = _subFp2(x, xNew);
        uint256[2] memory lambdaXDiff = _mulFp2(lambda, xDiff);
        uint256[2] memory yNew = _subFp2(lambdaXDiff, y);
        
        return [[xNew[0], xNew[1]], [yNew[0], yNew[1]]];
    }
    
    /**
     * @notice Checks if two G2 points are equal
     * @dev Checks if two G2 points are equal
     * @param a First G2 point [[x0, x1], [y0, y1]]
     * @param b Second G2 point [[x0, x1], [y0, y1]]
     * @return bool True if the points are equal, false otherwise
     */
    function _isG2PointEqual(uint256[2][2] memory a, uint256[2][2] memory b) internal pure returns (bool) {
        return (a[0][0] == b[0][0] && a[0][1] == b[0][1] && a[1][0] == b[1][0] && a[1][1] == b[1][1]);
    }
    
    /**
     * @notice Checks if two G2 points have the same x coordinate
     * @dev Checks if two G2 points have the same x coordinate
     * @param a First G2 point [[x0, x1], [y0, y1]]
     * @param b Second G2 point [[x0, x1], [y0, y1]]
     * @return bool True if the x coordinates are equal, false otherwise
     */
    function _isG2XEqual(uint256[2][2] memory a, uint256[2][2] memory b) internal pure returns (bool) {
        return (a[0][0] == b[0][0] && a[0][1] == b[0][1]);
    }
    
    /**
     * @notice Checks if a point is on the BN254 G1 curve
     * @dev Checks if a point is on the BN254 G1 curve
     * @param point The G1 point to check [x, y]
     * @return bool True if the point is on the curve, false otherwise
     */
    function _isOnCurveG1(uint256[2] memory point) internal pure returns (bool) {
        if (point[0] > PRIME_Q - 1 || point[1] > PRIME_Q - 1) return false;
        if (point[0] == 0 && point[1] == 0) return true; // Point at infinity
        
        // Check y^2 = x^3 + 3 (BN254 curve equation)
        uint256 lhs = mulmod(point[1], point[1], PRIME_Q);
        uint256 rhs = addmod(mulmod(mulmod(point[0], point[0], PRIME_Q), point[0], PRIME_Q), 3, PRIME_Q);
        return lhs == rhs;
    }
    
    /**
     * @notice Negates the Y coordinate of a G2 point for pairing operations
     * @dev Negates the Y coordinate of a G2 point for pairing operations
     * @param point The G2 point to negate
     * @return The G2 point with negated Y coordinate
     */
    function _negateG2Y(uint256[2][2] memory point) internal pure returns (uint256[2][2] memory) {
        if (_isG2PointAtInfinity(point)) {
            return point;
        }
        
        return [
            point[0],
            [
                point[1][0] == 0 ? 0 : PRIME_Q - point[1][0],
                point[1][1] == 0 ? 0 : PRIME_Q - point[1][1]
            ]
        ];
    }

    /**
     * @notice Checks if a point is on the BN254 G2 curve
     * @dev Checks if a point is on the BN254 G2 curve
     * @param point The G2 point to check [[x0, x1], [y0, y1]]
     * @return bool True if the point is on the curve, false otherwise
     */
    function _isOnCurveG2(uint256[2][2] memory point) internal pure returns (bool) {
        if (point[0][0] > PRIME_Q - 1 || point[0][1] > PRIME_Q - 1) return false;
        if (point[1][0] > PRIME_Q - 1 || point[1][1] > PRIME_Q - 1) return false;
        
        // Point at infinity check
        if (point[0][0] == 0 && point[0][1] == 0 && point[1][0] == 0 && point[1][1] == 0) {
            return true;
        }
        
        // Calculate Y^2 and X^3 + b in Fp2, then compare
        uint256[2] memory ySquared = _squareFp2(point[1]);
        uint256[2] memory xCubed = _cubeFp2(point[0]);
        uint256[2] memory rhs = _addG2CurveConstant(xCubed);
        
        return (ySquared[0] == rhs[0]) && (ySquared[1] == rhs[1]);
    }

    /**
     * @notice Cubes an Fp2 element (X^3)
     * @dev Cubes an Fp2 element using Fp2 multiplication
     * @param x The Fp2 element to cube [x0, x1]
     * @return uint256[2] The cubed result in Fp2
     */
    function _cubeFp2(uint256[2] memory x) internal pure returns (uint256[2] memory) {
        uint256[2] memory xSquared = _squareFp2(x);
        return _mulFp2(xSquared, x);
    }

    /**
     * @notice Adds the BN254 G2 curve constant b to an Fp2 element
     * @dev Adds the curve constant b = (b0, b1) where b0 and b1 are BN254 G2 constants
     * @param x The Fp2 element to add the constant to [x0, x1]
     * @return uint256[2] The result x + b in Fp2
     */
    function _addG2CurveConstant(uint256[2] memory x) internal pure returns (uint256[2] memory) {
        // BN254 G2 curve constants: b = (b0, b1)
        uint256 b0 = 19485874751759354771024239261021720505790618469301721065564631296452457478373;
        uint256 b1 = 266929791119991161246907387137283842545076965332900288569378510910307636690;
        
        return [
            addmod(x[0], b0, PRIME_Q),
            addmod(x[1], b1, PRIME_Q)
        ];
    }
    
    /**
     * @notice Adds two points on G1 using proper elliptic curve point addition
     * @dev Adds two points on G1 using proper elliptic curve point addition
     * @param a First G1 point [x, y]
     * @param b Second G1 point [x, y]
     * @return result The sum of the two points
     */
    function _addG1(uint256[2] memory a, uint256[2] memory b) internal pure returns (uint256[2] memory) {
        // Handle point at infinity cases
        if (a[0] == 0 && a[1] == 0) return b;
        if (b[0] == 0 && b[1] == 0) return a;
        
        // If points are the same, use point doubling
        if (a[0] == b[0] && a[1] == b[1]) {
            return _doubleG1(a);
        }
        
        // If points have same x but different y, result is point at infinity
        if (a[0] == b[0]) {
            return [uint256(0), uint256(0)];
        }
        
        // Standard elliptic curve point addition
        // slope = (b.y - a.y) / (b.x - a.x)
        uint256 deltaY = addmod(b[1], PRIME_Q - a[1], PRIME_Q);
        uint256 deltaX = addmod(b[0], PRIME_Q - a[0], PRIME_Q);
        uint256 slope = mulmod(deltaY, _modInverse(deltaX, PRIME_Q), PRIME_Q);
        
        // x3 = slope^2 - a.x - b.x
        uint256 x3 = addmod(
            mulmod(slope, slope, PRIME_Q),
            PRIME_Q - addmod(a[0], b[0], PRIME_Q),
            PRIME_Q
        );
        
        // y3 = slope * (a.x - x3) - a.y
        uint256 y3 = addmod(
            mulmod(slope, addmod(a[0], PRIME_Q - x3, PRIME_Q), PRIME_Q),
            PRIME_Q - a[1],
            PRIME_Q
        );
        
        return [x3, y3];
    }
    
    /**
     * @notice Doubles a G1 point (point addition with itself)
     * @dev Doubles a G1 point (point addition with itself)
     * @param point The G1 point to double
     * @return result The doubled point
     */
    function _doubleG1(uint256[2] memory point) internal pure returns (uint256[2] memory) {
        if (point[0] == 0 && point[1] == 0) return point; // Point at infinity
        
        // slope = (3 * x^2) / (2 * y)
        uint256 numerator = mulmod(3, mulmod(point[0], point[0], PRIME_Q), PRIME_Q);
        uint256 denominator = mulmod(2, point[1], PRIME_Q);
        uint256 slope = mulmod(numerator, _modInverse(denominator, PRIME_Q), PRIME_Q);
        
        // x3 = slope^2 - 2 * x
        uint256 x3 = addmod(
            mulmod(slope, slope, PRIME_Q),
            PRIME_Q - mulmod(2, point[0], PRIME_Q),
            PRIME_Q
        );
        
        // y3 = slope * (x - x3) - y
        uint256 y3 = addmod(
            mulmod(slope, addmod(point[0], PRIME_Q - x3, PRIME_Q), PRIME_Q),
            PRIME_Q - point[1],
            PRIME_Q
        );
        
        return [x3, y3];
    }
    
    /**
     * @notice Computes modular inverse using extended Euclidean algorithm
     * @dev Computes modular inverse using extended Euclidean algorithm
     * @param a The number to find inverse of
     * @param m The modulus
     * @return result The modular inverse of a mod m
     */
    function _modInverse(uint256 a, uint256 m) internal pure returns (uint256) {
        if (a == 0) revert CannotComputeInverseOfZero();
        
        // Use Fermat's little theorem: a^(p-1) ≡ 1 (mod p) for prime p
        // Therefore: a^(p-2) ≡ a^(-1) (mod p)
        return _modExp(a, m - 2, m);
    }
    
    /**
     * @notice Computes modular exponentiation using binary exponentiation
     * @dev Computes modular exponentiation using binary exponentiation
     * @param base The base
     * @param exponent The exponent
     * @param modulus The modulus
     * @return result base^exponent mod modulus
     */
    function _modExp(uint256 base, uint256 exponent, uint256 modulus) internal pure returns (uint256) {
        if (modulus == 1) return 0;
        
        uint256 result = 1;
        base = base % modulus;
        
        while (exponent > 0) {
            if (exponent % 2 == 1) {
                result = mulmod(result, base, modulus);
            }
            exponent = exponent >> 1;
            base = mulmod(base, base, modulus);
        }
        
        return result;
    }
    
    /**
     * @notice Scalar multiplication on G1 using double-and-add algorithm
     * @dev Scalar multiplication on G1 using double-and-add algorithm
     * @param point The G1 point to multiply
     * @param scalar The scalar to multiply by
     * @return result The result of scalar * point
     */
    function _scalarMulG1(uint256[2] memory point, uint256 scalar) internal pure returns (uint256[2] memory) {
        // Handle edge cases
        if (scalar == 0) return [uint256(0), uint256(0)]; // 0 * P = O (point at infinity)
        if (point[0] == 0 && point[1] == 0) return point; // scalar * O = O
        if (scalar == 1) return point; // 1 * P = P
        
        // Reduce scalar modulo the curve order to ensure it's in valid range
        scalar = scalar % CURVE_ORDER;
        if (scalar == 0) return [uint256(0), uint256(0)];
        
        // Double-and-add algorithm for scalar multiplication
        uint256[2] memory result = [uint256(0), uint256(0)]; // Start with point at infinity
        uint256[2] memory addend = point; // Current power of 2 multiple of point
        
        while (scalar > 0) {
            // If current bit is 1, add current power of 2 multiple to result
            if (scalar & 1 == 1) {
                result = _addG1(result, addend);
            }
            
            // Double the addend for next iteration (next power of 2)
            addend = _doubleG1(addend);
            
            // Move to next bit
            scalar = scalar >> 1;
        }
        
        return result;
    }
    
    /**
     * @notice Optimized scalar multiplication using windowing method for larger scalars
     * @param point The G1 point to multiply
     * @param scalar The scalar to multiply by
     * @return result The result of scalar * point
     */
    function _scalarMulG1Windowed(uint256[2] memory point, uint256 scalar) internal pure returns (uint256[2] memory) {
        uint256[2] memory result = [uint256(0), uint256(0)];
        uint256[2] memory addend = point;
        
        // Precompute powers of 2
        uint256[2][16] memory precomputed;
        precomputed[0] = point;
        
        for (uint256 i = 1; i < 16; ++i) {
            precomputed[i] = _addG1(precomputed[i-1], point);
        }
        
        // Process 4 bits at a time
        while (scalar > 0) {
            uint256 window = scalar & 15; // Get lowest 4 bits
            if (window > 0) {
                result = _addG1(result, precomputed[window-1]);
            }
            
            // Shift by 4 bits
            for (uint256 j = 0; j < 4; ++j) {
                addend = _doubleG1(addend);
            }
            scalar >>= 4;
        }
        
        return result;
    }
    
    /**
     * @notice Adds two Fp2 elements
     * @dev Adds two Fp2 elements
     * @param a First Fp2 element [a0, a1]
     * @param b Second Fp2 element [b0, b1]
     * @return uint256[2] The sum in Fp2
     */
    function _addFp2(uint256[2] memory a, uint256[2] memory b) internal pure returns (uint256[2] memory) {
        return [
            addmod(a[0], b[0], PRIME_Q),
            addmod(a[1], b[1], PRIME_Q)
        ];
    }
    
    /**
     * @notice Subtracts two Fp2 elements
     * @dev Subtracts two Fp2 elements
     * @param a First Fp2 element [a0, a1]
     * @param b Second Fp2 element [b0, b1]
     * @return uint256[2] The difference in Fp2
     */
    function _subFp2(uint256[2] memory a, uint256[2] memory b) internal pure returns (uint256[2] memory) {
        return [
            addmod(a[0], PRIME_Q - b[0], PRIME_Q),
            addmod(a[1], PRIME_Q - b[1], PRIME_Q)
        ];
    }
    
    /**
     * @notice Multiplies two Fp2 elements
     * @dev Multiplies two Fp2 elements
     * @param a First Fp2 element [a0, a1]
     * @param b Second Fp2 element [b0, b1]
     * @return uint256[2] The product in Fp2
     */
    function _mulFp2(uint256[2] memory a, uint256[2] memory b) internal pure returns (uint256[2] memory) {
        uint256 a0B0 = mulmod(a[0], b[0], PRIME_Q);
        uint256 a1B1 = mulmod(a[1], b[1], PRIME_Q);
        uint256 a0B1 = mulmod(a[0], b[1], PRIME_Q);
        uint256 a1B0 = mulmod(a[1], b[0], PRIME_Q);
        
        return [
            addmod(a0B0, PRIME_Q - a1B1, PRIME_Q),
            addmod(a0B1, a1B0, PRIME_Q)
        ];
    }
    
    /**
     * @notice Squares an Fp2 element
     * @dev Squares an Fp2 element
     * @param a The Fp2 element to square [a0, a1]
     * @return uint256[2] The square in Fp2
     */
    function _squareFp2(uint256[2] memory a) internal pure returns (uint256[2] memory) {
        uint256 a0Squared = mulmod(a[0], a[0], PRIME_Q);
        uint256 a1Squared = mulmod(a[1], a[1], PRIME_Q);
        uint256 a0a1 = mulmod(a[0], a[1], PRIME_Q);
        
        return [
            addmod(a0Squared, PRIME_Q - a1Squared, PRIME_Q),
            addmod(a0a1, a0a1, PRIME_Q)
        ];
    }
    
    /**
     * @notice Computes the inverse of an Fp2 element
     * @dev Computes the inverse of an Fp2 element
     * @param a The Fp2 element to invert [a0, a1]
     * @return uint256[2] The inverse in Fp2
     */
    function _invFp2(uint256[2] memory a) internal pure returns (uint256[2] memory) {
        uint256 norm = addmod(mulmod(a[0], a[0], PRIME_Q), mulmod(a[1], a[1], PRIME_Q), PRIME_Q);
        uint256 invNorm = _modInverse(norm, PRIME_Q);
        
        return [
            mulmod(a[0], invNorm, PRIME_Q),
            addmod(0, PRIME_Q - mulmod(a[1], invNorm, PRIME_Q), PRIME_Q)
        ];
    }
    
    /**
     * @notice Multiplies an Fp2 element by a scalar
     * @dev Multiplies an Fp2 element by a scalar
     * @param a The Fp2 element [a0, a1]
     * @param scalar The scalar to multiply by
     * @return uint256[2] The scaled Fp2 element
     */
    function _scalarMulFp2(uint256[2] memory a, uint256 scalar) internal pure returns (uint256[2] memory) {
        return [
            mulmod(a[0], scalar, PRIME_Q),
            mulmod(a[1], scalar, PRIME_Q)
        ];
    }
    
    /**
     * @notice Checks if an Fp2 element is zero
     * @dev Checks if an Fp2 element is zero
     * @param a The Fp2 element to check [a0, a1]
     * @return bool True if the element is zero
     */
    function _isZeroFp2(uint256[2] memory a) internal pure returns (bool) {
        return (a[0] == 0 && a[1] == 0);
    }
    
    /**
     * @notice Verifies a Groth16 proof with detailed format
     * @param _pA Proof point A [x, y]
     * @param _pB Proof point B [[x0, x1], [y0, y1]]
     * @param _pC Proof point C [x, y]
     * @param _pubSignals Array of public signals
     * @return bool True if the proof is valid, false otherwise
     */
    function verifyProof(
        uint256[2] calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2] calldata _pC,
        uint256[] calldata _pubSignals
    ) external view override returns (bool) {
        // Convert to compact format and call the main verification function
        uint256[8] memory proof = [
            _pA[0], _pA[1],           // A point
            _pB[0][0], _pB[0][1],     // B point x
            _pB[1][0], _pB[1][1],     // B point y
            _pC[0], _pC[1]            // C point
        ];
        
        return this.verifyProof(proof, _pubSignals);
    }
}