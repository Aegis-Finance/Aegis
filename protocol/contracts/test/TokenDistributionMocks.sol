// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IVerifier.sol";

/**
 * @title MockERC20
 * @notice Minimal ERC20 mock for testing
 */
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    string public name;
    string public symbol;
    uint8 public decimals = 18;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        totalSupply = _initialSupply;
        balanceOf[msg.sender] = _initialSupply;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }
}

/**
 * @title MockVerifier
 * @notice Mock verifier for testing compliance and other functionalities
 */
contract MockVerifier is IVerifier {
    bool public shouldVerify = true;
    mapping(bytes32 => bool) public usedNullifiers;

    function setShouldVerify(bool _shouldVerify) external {
        shouldVerify = _shouldVerify;
    }

    function setNullifierUsed(bytes32 nullifier, bool used) external {
        usedNullifiers[nullifier] = used;
    }

    function verifyProof(
        uint256[2] memory,
        uint256[2][2] memory,
        uint256[2] memory,
        uint256[] memory
    ) external view override returns (bool) {
        return shouldVerify;
    }

    function verifyProof(
        uint256[8] calldata,
        uint256[] calldata
    ) external view override returns (bool) {
        return shouldVerify;
    }

    function getVerificationKeyHash() external pure override returns (bytes32) {
        return keccak256("mock_sybil_verification_key");
    }

    function isProductionKey() external pure override returns (bool) {
        return false;
    }

    function getCeremonyId() external pure override returns (bytes32) {
        return keccak256("mock_sybil_ceremony");
    }

    function validateProductionSafety() external pure override {}
}

/**
 * @title MockPurchaseVerifier
 * @notice Mock purchase verifier for testing
 */
contract MockPurchaseVerifier is IVerifier {
    bool public shouldVerify = true;

    function setShouldVerify(bool _shouldVerify) external {
        shouldVerify = _shouldVerify;
    }

    function verifyProof(
        uint256[2] memory,
        uint256[2][2] memory,
        uint256[2] memory,
        uint256[] memory
    ) external view override returns (bool) {
        return shouldVerify;
    }

    function verifyProof(
        uint256[8] calldata,
        uint256[] calldata
    ) external view override returns (bool) {
        return shouldVerify;
    }

    function getVerificationKeyHash() external pure override returns (bytes32) {
        return keccak256("mock_purchase_verification_key");
    }

    function isProductionKey() external pure override returns (bool) {
        return false;
    }

    function getCeremonyId() external pure override returns (bytes32) {
        return keccak256("mock_purchase_ceremony");
    }

    function validateProductionSafety() external pure override {}
}

/**
 * @title MockUniswapV2Factory
 * @notice Mock Uniswap V2 factory for testing
 */
contract MockUniswapV2Factory {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "Identical addresses");
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(getPair[tokenA][tokenB] == address(0), "Pair exists");

        // Create mock pair
        MockUniswapV2Pair mockPair = new MockUniswapV2Pair(tokenA, tokenB);
        pair = address(mockPair);
        
        getPair[tokenA][tokenB] = pair;
        getPair[tokenB][tokenA] = pair;
        allPairs.push(pair);
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }
}

/**
 * @title MockUniswapV2Pair
 * @notice Mock Uniswap V2 pair for testing
 */
contract MockUniswapV2Pair {
    address public token0;
    address public token1;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    function mint(address to) external returns (uint256 liquidity) {
        liquidity = 1000 * 10**18; // Mock liquidity amount
        balanceOf[to] += liquidity;
        totalSupply += liquidity;
        return liquidity;
    }

    function burn(address to) external returns (uint256 amount0, uint256 amount1) {
        uint256 liquidity = balanceOf[address(this)];
        amount0 = liquidity / 2;
        amount1 = liquidity / 2;
        balanceOf[address(this)] = 0;
        totalSupply -= liquidity;
        
        // Mock token transfers
        // slither-disable-next-line unchecked-transfer
        bool success0 = MockERC20(token0).transfer(to, amount0);
        // slither-disable-next-line unchecked-transfer
        bool success1 = MockERC20(token1).transfer(to, amount1);
        // In test mocks, we don't revert on failure to allow testing various scenarios
        require(success0 && success1, "Mock transfer failed");
    }

    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }
}

/**
 * @title MockUniswapV2Router02
 * @notice Mock Uniswap V2 router for testing
 */
// INTENTIONAL: Mock contract for testing - intentionally receives ETH
// slither-disable-next-line locked-ether
contract MockUniswapV2Router02 {
    address public factory;
    address public WETH;

    constructor(address _factory) {
        factory = _factory;
    }

    function setWETH(address _weth) external {
        WETH = _weth;
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 /* amountTokenMin */,
        uint256 /* amountETHMin */,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        require(deadline >= block.timestamp, "Expired");
        
        // Mock implementation
        amountToken = amountTokenDesired;
        amountETH = msg.value;
        liquidity = 1000 * 10**18; // Mock liquidity
        
        // Transfer tokens from sender
        // slither-disable-next-line unchecked-transfer
        bool success = MockERC20(token).transferFrom(msg.sender, address(this), amountToken);
        require(success, "Mock transferFrom failed");
        
        // Get or create pair
        address pair = MockUniswapV2Factory(factory).getPair(token, WETH);
        if (pair == address(0)) {
            pair = MockUniswapV2Factory(factory).createPair(token, WETH);
        }
        
        // Mint LP tokens to recipient
        MockUniswapV2Pair(pair).mint(to);
    }
}

/**
 * @title MockWETH
 * @notice Mock WETH for testing
 */
contract MockWETH is MockERC20 {
    constructor() MockERC20("Wrapped Ether", "WETH", 0) {}

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        payable(msg.sender).transfer(amount);
        emit Transfer(msg.sender, address(0), amount);
    }

    receive() external payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
    }
}

/**
 * @title MockDutchAuction
 * @notice Mock Dutch auction contract for testing
 */
contract MockDutchAuction {
    bool public saleCompleted = false;
    uint256 public totalRaised = 0;
    uint256 public meanPrice = 0;
    uint256 public startTime;
    uint256 public endTime;
    
    constructor() {
        startTime = block.timestamp;
        endTime = block.timestamp + 7 days;
    }
    
    function setSaleCompleted(bool _completed) external {
        saleCompleted = _completed;
    }
    
    function setTotalRaised(uint256 _amount) external {
        totalRaised = _amount;
    }
    
    function setMeanPrice(uint256 _meanPrice) external {
        meanPrice = _meanPrice;
    }
    
    function isSaleCompleted() external view returns (bool) {
        return saleCompleted;
    }
    
    function getTotalRaised() external view returns (uint256) {
        return totalRaised;
    }
    
    function getMeanPrice() external view returns (uint256) {
        return meanPrice;
    }
    
    // Allow forwarding funds to a target so msg.sender at the target is this contract
    function fund(address payable target) external payable {
        require(target != address(0), "invalid target");
        (bool ok, ) = target.call{value: msg.value}("");
        require(ok, "forward failed");
    }
}

/**
 * @title MockLiquidityDeployer
 * @notice Minimal sink used in tests: `AutomatedDutchAuction` forwards AGS + native here via `seedFromAuction`.
 */
// slither-disable-next-line locked-ether
contract MockLiquidityDeployer {
    bool public liquiditySeeded;

    receive() external payable {}

    fallback() external payable {}

    function seedFromAuction(uint256, uint256) external payable {
        liquiditySeeded = true;
    }

    function setSeeded(bool v) external {
        liquiditySeeded = v;
    }
}

/**
 * @title MockSwapRouter02
 * @notice TGE-peg swap stub for settlement tests (`exactInputSingle` only).
 */
contract MockSwapRouter02 {
    mapping(address => mapping(address => uint256)) public outNumerator;
    mapping(address => mapping(address => uint256)) public inDenominator;

    function setSwapRate(address tokenIn, address tokenOut, uint256 num, uint256 den) external {
        outNumerator[tokenIn][tokenOut] = num;
        inDenominator[tokenIn][tokenOut] = den;
    }

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut) {
        uint256 num = outNumerator[params.tokenIn][params.tokenOut];
        uint256 den = inDenominator[params.tokenIn][params.tokenOut];
        require(num > 0 && den > 0, "no pool");
        amountOut = (params.amountIn * num) / den;
        require(amountOut >= params.amountOutMinimum, "slippage");
        require(IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn), "transferFrom");
        require(IERC20(params.tokenOut).transfer(params.recipient, amountOut), "transfer");
    }
}

/**
 * @title MockUniswapV3Factory
 * @notice Mock Uniswap V3 factory for testing
 */
contract MockUniswapV3Factory {
    mapping(address => mapping(address => mapping(uint24 => address))) public getPool;
    address[] public allPools;

    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external returns (address pool) {
        require(tokenA != tokenB, "Identical addresses");
        require(tokenA != address(0) && tokenB != address(0), "Zero address");
        require(getPool[tokenA][tokenB][fee] == address(0), "Pool exists");

        // Create mock pool
        MockUniswapV3Pool mockPool = new MockUniswapV3Pool(tokenA, tokenB, fee);
        pool = address(mockPool);
        
        getPool[tokenA][tokenB][fee] = pool;
        getPool[tokenB][tokenA][fee] = pool;
        allPools.push(pool);
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}

/**
 * @title MockUniswapV3Pool
 * @notice Mock Uniswap V3 pool for testing
 */
contract MockUniswapV3Pool {
    address public token0;
    address public token1;
    uint24 public fee;

    constructor(address _token0, address _token1, uint24 _fee) {
        token0 = _token0;
        token1 = _token1;
        fee = _fee;
    }

    function slot0() external pure returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    ) {
        // Return mock values
        sqrtPriceX96 = 79228162514264337593543950336; // 1.0001^0 = 1
        tick = 0;
        observationIndex = 0;
        observationCardinality = 1;
        observationCardinalityNext = 1;
        feeProtocol = 0;
        unlocked = true;
    }
}

/**
 * @title MockNonfungiblePositionManager
 * @notice Mock Uniswap V3 Nonfungible Position Manager for testing
 */
// INTENTIONAL: Mock contract for testing - intentionally receives ETH
// slither-disable-next-line locked-ether
contract MockNonfungiblePositionManager {
    struct Position {
        uint96 nonce;
        address operator;
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    event MockTransfer(address from, address to, address token, uint256 amount);

    mapping(uint256 => Position) public positions;
    uint256 public nextTokenId = 1;

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 /* sqrtPriceX96 */
    ) external payable returns (address pool) {
        pool = address(uint160(uint256(keccak256(abi.encode(token0, token1, fee, "pool")))));
        return pool;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        // Mock implementation
        tokenId = nextTokenId++;
        liquidity = 1000 * 10**18; // Mock liquidity amount
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;

        // Store position data
        positions[tokenId] = Position({
            nonce: 0,
            operator: params.recipient,
            token0: params.token0,
            token1: params.token1,
            fee: params.fee,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity,
            feeGrowthInside0LastX128: 0,
            feeGrowthInside1LastX128: 0,
            tokensOwed0: 0,
            tokensOwed1: 0
        });

        // Mock token transfers - don't actually transfer since these might be real contracts
        // In a real test environment, the tokens would be properly funded
        emit MockTransfer(msg.sender, address(this), params.token0, amount0);
        emit MockTransfer(msg.sender, address(this), params.token1, amount1);
    }

    function burn(uint256 tokenId) external payable {
        require(positions[tokenId].operator != address(0), "Position does not exist");
        delete positions[tokenId];
    }

    function getPosition(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        )
    {
        Position memory position = positions[tokenId];
        return (
            position.nonce,
            position.operator,
            position.token0,
            position.token1,
            position.fee,
            position.tickLower,
            position.tickUpper,
            position.liquidity,
            position.feeGrowthInside0LastX128,
            position.feeGrowthInside1LastX128,
            position.tokensOwed0,
            position.tokensOwed1
        );
    }

    function safeTransferFrom(address /* from */, address to, uint256 tokenId, bytes calldata /* data */) external {
        // Mock implementation - just update operator
        positions[tokenId].operator = to;
    }
}