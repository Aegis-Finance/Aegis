const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { TestHelpers } = require("./helpers/TestHelpers");
const { mintShield } = require("./helpers/mintShieldHelper");

describe("CrossChainPrivacyBridge", function () {
    let testHelpers;
    
    async function governanceExecute(bridge, governanceExecutor, governanceSigner, functionName, params = []) {
        const data = bridge.interface.encodeFunctionData(functionName, params);
        return governanceExecutor.connect(governanceSigner).execute(data);
    }
    
    async function deployBridgeFixture() {
        const [owner, governance, validator1, user1, user2] = await ethers.getSigners();
        
        // Deploy mock verifier factory
        const MockVerifierFactory = await ethers.getContractFactory("MockVerifierFactory");
        const verifierFactory = await MockVerifierFactory.deploy();
        await verifierFactory.waitForDeployment();
        
        // Deploy TokenAllocation
        const TokenAllocation = await ethers.getContractFactory("TokenAllocation");
        const tokenAllocation = await TokenAllocation.deploy(governance.address);
        await tokenAllocation.waitForDeployment();
        
        // Initialize test helpers
        const testHelpersInstance = new TestHelpers();
        await testHelpersInstance.initialize();
        
        // Deploy ProofLib library first
        const proofLibAddress = await testHelpersInstance.deployProofLib();
        
        // Deploy PrivateTokenContract with linked library
        const PrivateTokenContract = await testHelpersInstance.getContractFactoryWithProofLib("PrivateTokenContract", proofLibAddress);
        const tokenContract = await PrivateTokenContract.deploy(
            await verifierFactory.getAddress(),
            await tokenAllocation.getAddress()
        );
        await tokenContract.waitForDeployment();
        
        // Deploy CrossChainPrivacyBridge (no library linking needed)
        const CrossChainPrivacyBridge = await ethers.getContractFactory("CrossChainPrivacyBridge");
        const bridge = await CrossChainPrivacyBridge.deploy(
            await tokenContract.getAddress(),
            await verifierFactory.getAddress(),
            1, // requiredValidations
            ethers.parseEther("10000") // validatorStakeAmount
        );
        await bridge.waitForDeployment();

        const BridgeGovernanceExecutor = await ethers.getContractFactory("BridgeGovernanceExecutor");
        const governanceExecutor = await BridgeGovernanceExecutor.deploy(await bridge.getAddress());
        await governanceExecutor.waitForDeployment();

        await bridge.updateGovernance(await governanceExecutor.getAddress());
        
        // Set up TokenAllocation so governance has tokens for testing (governance is owner)
        await tokenAllocation.connect(governance).setToken(await tokenContract.getAddress());
        await tokenAllocation.connect(governance).setTreasuryWallet(governance.address);
        await tokenAllocation.connect(governance).allocateTreasuryTokens();
        
        // Set governance in token contract (owner is the deployer, first signer)
        await tokenContract.setGovernanceContract(governance.address);
        // Authorize bridge contract (requires governance to be set)
        await tokenContract.connect(governance).authorizeContract(await bridge.getAddress());
        
        return {
            bridge,
            tokenContract,
            verifierFactory,
            owner,
            governance,
            validator1,
            user1,
            user2,
            governanceExecutor
        };
    }
    
    beforeEach(async function () {
        testHelpers = new TestHelpers();
        await testHelpers.initialize();
    });

    async function setupBridgeForTransfer({
        bridge,
        tokenContract,
        verifierFactory,
        governance,
        validator1,
        governanceExecutor
    }, overrides = {}) {
        const chainId = 42161;
        await governanceExecute(
            bridge,
            governanceExecutor,
            governance,
            "addSupportedChain",
            [
                chainId,
                "Arbitrum",
                await bridge.getAddress(),
                12,
                ethers.parseEther("1"),
                ethers.parseEther("1000000"),
                10
            ]
        );

        const validatorCommitment = testHelpers.generateUniqueCommitment("validator-challenge");
        const stakeAmount = ethers.parseEther("10000");
        await tokenContract.connect(governance).transfer(validator1.address, stakeAmount);
        await mintShield(tokenContract, validator1, validatorCommitment, stakeAmount, testHelpers);
        await governanceExecute(
            bridge,
            governanceExecutor,
            governance,
            "addValidator",
            [validator1.address, validatorCommitment, stakeAmount]
        );
        await governanceExecute(
            bridge,
            governanceExecutor,
            governance,
            "setRequiredValidations",
            [1]
        );

        const liquidityProof = testHelpers.generateMockZKProof("liquidity-challenge");
        const liquidityAmount = ethers.parseEther("50000");
        await mintShield(tokenContract, governance, liquidityProof.commitment, liquidityAmount, testHelpers);

        const liquidityParams = {
            chainId,
            amount: liquidityAmount,
            providerCommitment: liquidityProof.commitment,
            nullifier: liquidityProof.nullifier,
            zkProof: ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256[8]"],
                [[
                    liquidityProof.a[0],
                    liquidityProof.a[1],
                    liquidityProof.b[0][0],
                    liquidityProof.b[0][1],
                    liquidityProof.b[1][0],
                    liquidityProof.b[1][1],
                    liquidityProof.c[0],
                    liquidityProof.c[1]
                ]]
            )
        };

        const bridgeVerifier = await verifierFactory.verifiers("bridge");
        const mockVerifier = await ethers.getContractAt("MockZKVerifier", bridgeVerifier);
        await mockVerifier.setShouldVerify(true);

        await governanceExecute(
            bridge,
            governanceExecutor,
            governance,
            "addLiquidity",
            [liquidityParams]
        );

        const senderCommitment = overrides.senderCommitment || testHelpers.generateUniqueCommitment("sender-challenge");
        const transferAmount = overrides.transferAmount || ethers.parseEther("1000");
        await mintShield(tokenContract, governance, senderCommitment, transferAmount, testHelpers);

        const recipientCommitment = overrides.recipientCommitment || testHelpers.generateUniqueCommitment("recipient-challenge");
        const sourceNullifier = overrides.sourceNullifier || testHelpers.generateUniqueNullifier();
        const destinationNullifier = overrides.destinationNullifier || testHelpers.generateUniqueNullifier();
        const transferProof = overrides.transferProof || testHelpers.generateMockZKProof("transfer-challenge");
        const merkleRoot = overrides.merkleRoot || testHelpers.generateUniqueCommitment("merkle-root");
        const feeCommitment = overrides.feeCommitment || testHelpers.generateUniqueCommitment("fee-commitment");
        const nullifierHash = overrides.nullifierHash || testHelpers.generateUniqueCommitment("nullifier-hash");

        await governanceExecute(
            bridge,
            governanceExecutor,
            governance,
            "addMerkleRoot",
            [merkleRoot]
        );
        await bridge.connect(validator1).attestMerkleRoot(merkleRoot);
        const activationDelay = await bridge.merkleRootActivationDelay();
        await time.increase(activationDelay + 1n);
        await bridge.activateMerkleRoot(merkleRoot);

        const transferParams = {
            destinationChain: chainId,
            nullifierHash,
            merkleRoot,
            transferCommitment: recipientCommitment,
            feeCommitment,
            senderCommitment,
            recipientCommitment,
            amount: transferAmount,
            sourceNullifier,
            destinationNullifier,
            zkProof: ethers.AbiCoder.defaultAbiCoder().encode(
                ["uint256[8]"],
                [[
                    transferProof.a[0],
                    transferProof.a[1],
                    transferProof.b[0][0],
                    transferProof.b[0][1],
                    transferProof.b[1][0],
                    transferProof.b[1][1],
                    transferProof.c[0],
                    transferProof.c[1]
                ]]
            )
        };

        return {
            chainId,
            transferParams,
            validatorCommitment,
            transferAmount,
            senderCommitment,
            recipientCommitment,
            sourceNullifier,
            destinationNullifier,
            merkleRoot,
            feeCommitment,
            nullifierHash
        };
    }

    async function prepareValidatedTransfer(context) {
        const setup = await setupBridgeForTransfer(context);
        const {
            bridge,
            validator1
        } = context;

        const {
            transferParams,
            transferAmount,
            senderCommitment
        } = setup;

        const tx = await bridge.initiateTransfer(transferParams);
        const receipt = await tx.wait();
        const transferInitiatedEvent = receipt.logs.find(log => {
            try {
                const parsed = bridge.interface.parseLog(log);
                return parsed && parsed.name === "TransferInitiated";
            } catch {
                return false;
            }
        });

        if (!transferInitiatedEvent) {
            throw new Error("TransferInitiated event not found");
        }

        const parsedEvent = bridge.interface.parseLog(transferInitiatedEvent);
        const transferId = parsedEvent.args.transferId;

        await bridge.connect(validator1).validateTransfer(
            transferId,
            true,
            ethers.keccak256(ethers.toUtf8Bytes("validation")),
            "0x"
        );

        // Ensure state updated
        await time.increase(1);

        const transfer = await bridge.transfers(transferId);
        if (transfer.status !== 1n) {
            throw new Error("Transfer did not reach VALIDATED state");
        }

        return {
            ...setup,
            transferId,
            senderCommitment,
            transferAmount,
            confirmationTime: transfer.confirmationTime
        };
    }
    
    describe("Deployment", function () {
        it("Should deploy with correct token and verifier factory", async function () {
            const { bridge, tokenContract, verifierFactory } = await loadFixture(deployBridgeFixture);
            
            expect(await bridge.PRIVATE_TOKEN()).to.equal(await tokenContract.getAddress());
            expect(await bridge.VERIFIER_FACTORY()).to.equal(await verifierFactory.getAddress());
        });
        
        it("Should initialize with zero transfers", async function () {
            const { bridge } = await loadFixture(deployBridgeFixture);
            
            expect(await bridge.nextTransferId()).to.equal(1n); // Starts at 1, increments before use
            expect(await bridge.pendingTransfersCount()).to.equal(0n);
        });
        
        it("Should have correct constants", async function () {
            const { bridge } = await loadFixture(deployBridgeFixture);
            
            expect(await bridge.MIN_TRANSFER_AMOUNT()).to.equal(ethers.parseEther("1"));
            expect(await bridge.MAX_TRANSFER_AMOUNT()).to.equal(ethers.parseEther("1000000"));
            expect(await bridge.CONFIRMATION_BLOCKS()).to.equal(12n);
            expect(await bridge.CHALLENGE_PERIOD()).to.equal(86400n); // 24 hours
            expect(await bridge.MAX_PENDING_TRANSFERS()).to.equal(1000n);
            expect(Number(await bridge.MAX_CHALLENGE_ATTEMPTS())).to.equal(3);
        });
    });
    
    describe("Chain Management", function () {
        it("Should allow adding supported chains", async function () {
            const { bridge, governance, governanceExecutor } = await loadFixture(deployBridgeFixture);
            
            const chainId = 42161; // Arbitrum
            
            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "addSupportedChain",
                    [
                        chainId,
                        "Arbitrum",
                        await bridge.getAddress(),
                        12,
                        ethers.parseEther("1"),
                        ethers.parseEther("1000000"),
                        10 // 0.1% in basis points
                    ]
                )
            ).to.emit(bridge, "ChainAdded")
                .withArgs(chainId, "Arbitrum", await bridge.getAddress());
            
            const addedChain = await bridge.supportedChains(chainId);
            expect(addedChain.chainId).to.equal(chainId);
            expect(addedChain.isActive).to.be.true;
        });
        
        it("Should prevent adding duplicate chains", async function () {
            const { bridge, governance, governanceExecutor } = await loadFixture(deployBridgeFixture);
            
            const chainId = 42161;
            
            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "addSupportedChain",
                [
                    chainId,
                    "Arbitrum",
                    await bridge.getAddress(),
                    12,
                    ethers.parseEther("1"),
                    ethers.parseEther("1000000"),
                    10
                ]
            );
            
            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "addSupportedChain",
                    [
                        chainId,
                        "Arbitrum",
                        await bridge.getAddress(),
                        12,
                        ethers.parseEther("1"),
                        ethers.parseEther("1000000"),
                        10
                    ]
                )
            ).to.be.revertedWithCustomError(bridge, "ChainNotSupported");
        });
    });
    
    describe("Transfer Initiation", function () {
        it("Should allow initiating cross-chain transfers with valid proof", async function () {
            const context = await loadFixture(deployBridgeFixture);
            const { bridge, validator1 } = context;
            const { transferParams } = await setupBridgeForTransfer(context);

            await expect(bridge.initiateTransfer(transferParams)).to.emit(bridge, "TransferInitiated");

            expect(await bridge.pendingTransfersCount()).to.equal(1n);
        });
        
        it("Should reject transfers to unsupported chains", async function () {
            const context = await loadFixture(deployBridgeFixture);
            const { bridge, validator1 } = context;
            const setup = await setupBridgeForTransfer(context);
            const transferParams = {
                ...setup.transferParams,
                destinationChain: 99999
            };
            
            await expect(
                bridge.initiateTransfer(transferParams)
            ).to.be.revertedWithCustomError(bridge, "ChainNotSupported");
        });
        
        it("Should reject transfers below minimum amount", async function () {
            const context = await loadFixture(deployBridgeFixture);
            const { bridge, validator1 } = context;
            const setup = await setupBridgeForTransfer(context, {
                transferAmount: ethers.parseEther("0.5")
            });
            
            await expect(
                bridge.initiateTransfer(setup.transferParams)
            ).to.be.revertedWithCustomError(bridge, "InvalidAmount");
        });
    });
    
    describe("Validator Management", function () {
        it("Should allow adding validators with sufficient stake", async function () {
            const { bridge, tokenContract, governance, validator1, governanceExecutor } = await loadFixture(deployBridgeFixture);
            
            // Validator stake amount is set in constructor (already set to 10000)
            
            // Transfer tokens to validator (governance has tokens from TokenAllocation)
            await tokenContract.connect(governance).transfer(validator1.address, ethers.parseEther("20000"));
            
            const validatorCommitment = ethers.keccak256(ethers.toUtf8Bytes("validator1"));
            const stake = ethers.parseEther("10000");
            
            // Shield tokens to commitment first (required for transferToPoolInternal)
            await mintShield(tokenContract, validator1, validatorCommitment, stake, testHelpers);
            
            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "addValidator",
                    [validator1.address, validatorCommitment, stake]
                )
            ).to.emit(bridge, "ValidatorAdded")
                .withArgs(validator1.address, validatorCommitment, stake);
            
            const validatorInfo = await bridge.validators(validator1.address);
            expect(validatorInfo.isActive).to.be.true;
            expect(validatorInfo.stake).to.equal(stake);
        });
        
        it("Should reject validators with insufficient stake", async function () {
            const { bridge, tokenContract, governance, validator1, governanceExecutor } = await loadFixture(deployBridgeFixture);
            
            // Validator stake amount is already set to 10000 in constructor
            
            // Transfer tokens to validator (governance has tokens from TokenAllocation)
            await tokenContract.connect(governance).transfer(validator1.address, ethers.parseEther("5000"));
            await tokenContract.connect(validator1).approve(await bridge.getAddress(), ethers.parseEther("5000"));
            
            const validatorCommitment = ethers.keccak256(ethers.toUtf8Bytes("validator1"));
            const insufficientStake = ethers.parseEther("5000");
            
            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "addValidator",
                    [validator1.address, validatorCommitment, insufficientStake]
                )
            ).to.be.revertedWithCustomError(bridge, "InsufficientStake");
        });

        it("Should prevent non-governance accounts from adding validators", async function () {
            const { bridge, tokenContract, governance, validator1 } = await loadFixture(deployBridgeFixture);

            const validatorCommitment = testHelpers.generateUniqueCommitment("validator-unauth");
            const stake = ethers.parseEther("10000");

            await tokenContract.connect(governance).transfer(validator1.address, stake);
            await mintShield(tokenContract, validator1, validatorCommitment, stake, testHelpers);

            await expect(
                bridge.connect(validator1).addValidator(
                    validator1.address,
                    validatorCommitment,
                    stake
                )
            ).to.be.revertedWithCustomError(bridge, "UnauthorizedGovernanceAccess");
        });

        it("Should allow governance to remove validators when quorum remains and return stake", async function () {
            const { bridge, tokenContract, governance, validator1, user1, governanceExecutor } = await loadFixture(deployBridgeFixture);

            const stake = ethers.parseEther("10000");

            const validatorCommitment = testHelpers.generateUniqueCommitment("validator-remove-primary");
            await tokenContract.connect(governance).transfer(validator1.address, stake);
            await mintShield(tokenContract, validator1, validatorCommitment, stake, testHelpers);
            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "addValidator",
                [validator1.address, validatorCommitment, stake]
            );

            const secondaryCommitment = testHelpers.generateUniqueCommitment("validator-remove-secondary");
            await tokenContract.connect(governance).transfer(user1.address, stake);
            await mintShield(tokenContract, user1, secondaryCommitment, stake, testHelpers);
            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "addValidator",
                [user1.address, secondaryCommitment, stake]
            );

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "removeValidator",
                    [validator1.address]
                )
            ).to.emit(bridge, "ValidatorRemoved")
                .withArgs(validator1.address, validatorCommitment, stake);

            const validatorInfo = await bridge.validators(validator1.address);
            expect(validatorInfo.isActive).to.be.false;
            expect(validatorInfo.stake).to.equal(0n);
            expect(await tokenContract.commitmentBalances(validatorCommitment)).to.equal(stake);

            const activeValidators = await bridge.getActiveValidators();
            expect(activeValidators).to.deep.equal([user1.address]);
        });

        it("Should prevent removing the last active validator", async function () {
            const { bridge, tokenContract, governance, validator1, governanceExecutor } = await loadFixture(deployBridgeFixture);

            const validatorCommitment = testHelpers.generateUniqueCommitment("validator-last");
            const stake = ethers.parseEther("10000");
            await tokenContract.connect(governance).transfer(validator1.address, stake);
            await mintShield(tokenContract, validator1, validatorCommitment, stake, testHelpers);
            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "addValidator",
                [validator1.address, validatorCommitment, stake]
            );

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "removeValidator",
                    [validator1.address]
                )
            ).to.be.revertedWithCustomError(bridge, "CannotRemoveLastValidator");
        });

        it("Should update required validations within governance limits", async function () {
            const { bridge, tokenContract, governance, validator1, governanceExecutor } = await loadFixture(deployBridgeFixture);

            const validatorCommitment = testHelpers.generateUniqueCommitment("validator-threshold");
            const stake = ethers.parseEther("10000");
            await tokenContract.connect(governance).transfer(validator1.address, stake);
            await mintShield(tokenContract, validator1, validatorCommitment, stake, testHelpers);
            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "addValidator",
                [validator1.address, validatorCommitment, stake]
            );

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "setRequiredValidations",
                    [1]
                )
            ).to.not.be.reverted;

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "setRequiredValidations",
                    [0]
                )
            ).to.be.revertedWithCustomError(bridge, "InvalidValidationThreshold");

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "setRequiredValidations",
                    [2]
                )
            ).to.be.revertedWithCustomError(bridge, "InvalidValidationThreshold");

            await expect(
                bridge.connect(validator1).setRequiredValidations(1)
            ).to.be.revertedWithCustomError(bridge, "UnauthorizedGovernanceAccess");
        });

        it("Should require a two-thirds supermajority when four validators are registered", async function () {
            const {
                bridge,
                tokenContract,
                verifierFactory,
                governance,
                owner,
                validator1,
                user1,
                user2,
                governanceExecutor
            } = await loadFixture(deployBridgeFixture);

            const stakeAmount = ethers.parseEther("10000");
            const validators = [
                { signer: validator1, label: "validator-majority-1" },
                { signer: user1, label: "validator-majority-2" },
                { signer: user2, label: "validator-majority-3" },
                { signer: owner, label: "validator-majority-4" }
            ];

            for (const { signer, label } of validators) {
                await tokenContract.connect(governance).transfer(signer.address, stakeAmount);
                const commitment = testHelpers.generateUniqueCommitment(label);
                await mintShield(tokenContract, signer, commitment, stakeAmount, testHelpers);
                await governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "addValidator",
                    [signer.address, commitment, stakeAmount]
                );
            }

            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "setRequiredValidations",
                [validators.length]
            );

            const chainId = 42161;
            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "addSupportedChain",
                [
                    chainId,
                    "Arbitrum",
                    await bridge.getAddress(),
                    12,
                    ethers.parseEther("1"),
                    ethers.parseEther("1000000"),
                    10
                ]
            );

            const liquidityProof = testHelpers.generateMockZKProof("liquidity-majority");
            const liquidityAmount = ethers.parseEther("100000");
            await mintShield(tokenContract, governance, liquidityProof.commitment, liquidityAmount, testHelpers);

            const liquidityParams = {
                chainId,
                amount: liquidityAmount,
                providerCommitment: liquidityProof.commitment,
                nullifier: liquidityProof.nullifier,
                zkProof: ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[
                        liquidityProof.a[0],
                        liquidityProof.a[1],
                        liquidityProof.b[0][0],
                        liquidityProof.b[0][1],
                        liquidityProof.b[1][0],
                        liquidityProof.b[1][1],
                        liquidityProof.c[0],
                        liquidityProof.c[1]
                    ]]
                )
            };

            const bridgeVerifier = await verifierFactory.verifiers("bridge");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", bridgeVerifier);
            await mockVerifier.setShouldVerify(true);

            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "addLiquidity",
                [liquidityParams]
            );

            const liquidityBefore = (await bridge.chainLiquidityInfo(chainId)).availableLiquidity;

            const senderCommitment = testHelpers.generateUniqueCommitment("sender-majority");
            const recipientCommitment = testHelpers.generateUniqueCommitment("recipient-majority");
            const transferAmount = ethers.parseEther("1500");
            await mintShield(tokenContract, governance, senderCommitment, transferAmount, testHelpers);

            const transferProof = testHelpers.generateMockZKProof("transfer-majority");
            const sourceNullifier = testHelpers.generateUniqueNullifier();
            const destinationNullifier = testHelpers.generateUniqueNullifier();

            const merkleRoot = testHelpers.generateUniqueCommitment("supermajority-root");
            const feeCommitment = testHelpers.generateUniqueCommitment("supermajority-fee");
            const nullifierHash = testHelpers.generateUniqueCommitment("supermajority-nullifier");

            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "addMerkleRoot",
                [merkleRoot]
            );
            for (const { signer } of validators) {
                await bridge.connect(signer).attestMerkleRoot(merkleRoot);
            }
            const activationDelay = await bridge.merkleRootActivationDelay();
            await time.increase(activationDelay + 1n);
            await bridge.activateMerkleRoot(merkleRoot);

            const transferParams = {
                destinationChain: chainId,
                nullifierHash,
                merkleRoot,
                transferCommitment: recipientCommitment,
                feeCommitment,
                senderCommitment,
                recipientCommitment,
                amount: transferAmount,
                sourceNullifier,
                destinationNullifier,
                zkProof: ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[
                        transferProof.a[0],
                        transferProof.a[1],
                        transferProof.b[0][0],
                        transferProof.b[0][1],
                        transferProof.b[1][0],
                        transferProof.b[1][1],
                        transferProof.c[0],
                        transferProof.c[1]
                    ]]
                )
            };

            const tx = await bridge.initiateTransfer(transferParams);
            const receipt = await tx.wait();
            const transferInitiatedEvent = receipt.logs.find(log => {
                try {
                    const parsed = bridge.interface.parseLog(log);
                    return parsed && parsed.name === "TransferInitiated";
                } catch {
                    return false;
                }
            });

            if (!transferInitiatedEvent) {
                throw new Error("TransferInitiated event not found");
            }

            const parsedEvent = bridge.interface.parseLog(transferInitiatedEvent);
            const transferId = parsedEvent.args.transferId;

            const validationHashes = [
                "validation-majority-0",
                "validation-majority-1",
                "validation-majority-2",
                "validation-majority-3"
            ].map(message => ethers.keccak256(ethers.toUtf8Bytes(message)));

            await bridge.connect(validators[0].signer).validateTransfer(transferId, true, validationHashes[0], "0x");
            await bridge.connect(validators[1].signer).validateTransfer(transferId, true, validationHashes[1], "0x");
            await bridge.connect(validators[2].signer).validateTransfer(transferId, false, validationHashes[2], "0x");
            await bridge.connect(validators[3].signer).validateTransfer(transferId, false, validationHashes[3], "0x");

            const transfer = await bridge.transfers(transferId);
            expect(transfer.status).to.equal(4n); // FAILED
            expect(await bridge.pendingTransfersCount()).to.equal(0n);

            const senderBalance = await tokenContract.commitmentBalances(senderCommitment);
            expect(senderBalance).to.equal(transferAmount);

            const liquidityAfter = (await bridge.chainLiquidityInfo(chainId)).availableLiquidity;
            expect(liquidityAfter).to.equal(liquidityBefore);
        });
    });
    
    describe("Transfer Execution", function () {
        it("Should allow executing validated transfers after challenge period", async function () {
            const context = await loadFixture(deployBridgeFixture);
            const { bridge, validator1 } = context;
            const { transferId } = await prepareValidatedTransfer(context);

            const challengePeriod = await bridge.CHALLENGE_PERIOD();
            await time.increase(challengePeriod + 1n);

            await expect(
                bridge.executeTransfer(transferId)
            ).to.emit(bridge, "TransferExecuted");
        });

        it("Should prevent executing validated transfers before the full challenge period", async function () {
            const context = await loadFixture(deployBridgeFixture);
            const { bridge } = context;
            const { transferId } = await prepareValidatedTransfer(context);

            const challengePeriod = await bridge.CHALLENGE_PERIOD();
            await time.increase(challengePeriod - 10n);

            await expect(
                bridge.executeTransfer(transferId)
            ).to.be.revertedWithCustomError(bridge, "ChallengePeriodNotEnded");
        });
    });

    describe("Challenge Resolution", function () {
        it("Should allow governance to uphold a challenge and refund the sender", async function () {
            const context = await loadFixture(deployBridgeFixture);
            const { bridge, tokenContract, governance, governanceExecutor } = context;
            const { transferId, senderCommitment, transferAmount, confirmationTime } = await prepareValidatedTransfer(context);

            await expect(
                bridge.challengeTransfer(transferId, "fraudulent proof")
            ).to.emit(bridge, "TransferChallenged");

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "resolveChallenge",
                    [transferId, true]
                )
            ).to.emit(bridge, "ChallengeResolved")
                .withArgs(transferId, await governanceExecutor.getAddress(), true);

            const transfer = await bridge.transfers(transferId);
            expect(transfer.status).to.equal(4n); // FAILED
            expect(transfer.challengeExpiry).to.equal(0n);
            expect(await bridge.pendingTransfersCount()).to.equal(0n);
            expect(await tokenContract.commitmentBalances(senderCommitment)).to.equal(transferAmount);
            expect(transfer.confirmationTime).to.equal(confirmationTime);
        });

        it("Should auto-dismiss a challenge after the response window", async function () {
            const context = await loadFixture(deployBridgeFixture);
            const { bridge, governance } = context;
            const { transferId, confirmationTime } = await prepareValidatedTransfer(context);

            await bridge.challengeTransfer(transferId, "grief attempt");

            const responseWindow = await bridge.CHALLENGE_RESPONSE_WINDOW();
            await time.increase(responseWindow + 1n);

            await expect(
                bridge.finalizeChallenge(transferId)
            ).to.emit(bridge, "ChallengeResolved")
                .withArgs(transferId, ethers.ZeroAddress, false);

            const transfer = await bridge.transfers(transferId);
            expect(transfer.status).to.equal(1n); // VALIDATED
            expect(transfer.challengeExpiry).to.equal(0n);
            expect(transfer.confirmationTime).to.equal(confirmationTime);

            const challengePeriod = await bridge.CHALLENGE_PERIOD();
            await time.increase(challengePeriod + 1n);

            await expect(
                bridge.executeTransfer(transferId)
            ).to.emit(bridge, "TransferExecuted");
        });

        it("Should cap sequential challenges and allow limited retries", async function () {
            const context = await loadFixture(deployBridgeFixture);
            const { bridge, governance, governanceExecutor } = context;
            const { transferId, confirmationTime } = await prepareValidatedTransfer(context);

            await bridge.challengeTransfer(transferId, "initial challenge");

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "resolveChallenge",
                    [transferId, false]
                )
            ).to.emit(bridge, "ChallengeResolved")
                .withArgs(transferId, await governanceExecutor.getAddress(), false);

            const transferAfterFirstDismissal = await bridge.transfers(transferId);
            expect(transferAfterFirstDismissal.confirmationTime).to.equal(confirmationTime);

            await expect(
                bridge.challengeTransfer(transferId, "second challenge")
            ).to.emit(bridge, "TransferChallenged");

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "resolveChallenge",
                    [transferId, false]
                )
            ).to.emit(bridge, "ChallengeResolved")
                .withArgs(transferId, await governanceExecutor.getAddress(), false);

            await expect(
                bridge.challengeTransfer(transferId, "third challenge")
            ).to.emit(bridge, "TransferChallenged");

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "resolveChallenge",
                    [transferId, false]
                )
            ).to.emit(bridge, "ChallengeResolved")
                .withArgs(transferId, await governanceExecutor.getAddress(), false);

            const { challengeAttempts } = await bridge.transfers(transferId);
            expect(Number(challengeAttempts)).to.equal(3);

            await expect(
                bridge.challengeTransfer(transferId, "fourth challenge")
            ).to.be.revertedWithCustomError(bridge, "ChallengeLimitExceeded");
        });
    });

    describe("Governance Pause Controls", function () {
        it("Should block governance operations while paused and allow after unpause", async function () {
            const { bridge, tokenContract, governance, validator1, governanceExecutor } = await loadFixture(deployBridgeFixture);

            const stake = ethers.parseEther("10000");
            const validatorCommitment = testHelpers.generateUniqueCommitment("pause-validator");
            await tokenContract.connect(governance).transfer(validator1.address, stake);
            await mintShield(tokenContract, validator1, validatorCommitment, stake, testHelpers);

            await governanceExecute(bridge, governanceExecutor, governance, "pauseBridge");
            expect(await bridge.paused()).to.be.true;

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "addValidator",
                    [validator1.address, validatorCommitment, stake]
                )
            ).to.be.revertedWithCustomError(bridge, "EnforcedPause");

            await governanceExecute(bridge, governanceExecutor, governance, "unpauseBridge");
            expect(await bridge.paused()).to.be.false;

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "addValidator",
                    [validator1.address, validatorCommitment, stake]
                )
            ).to.emit(bridge, "ValidatorAdded")
                .withArgs(validator1.address, validatorCommitment, stake);
        });
    });

    describe("Merkle Root Governance", function () {
        const SIX_HOURS = 6 * 60 * 60;

        it("Should require validator attestations before activating a pending Merkle root", async function () {
            const { bridge, tokenContract, governance, validator1, governanceExecutor } = await loadFixture(deployBridgeFixture);

            const stake = ethers.parseEther("10000");
            const validatorCommitment = testHelpers.generateUniqueCommitment("root-validator");
            await tokenContract.connect(governance).transfer(validator1.address, stake);
            await mintShield(tokenContract, validator1, validatorCommitment, stake, testHelpers);

            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "addValidator",
                [validator1.address, validatorCommitment, stake]
            );

            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "setMerkleRootActivationDelay",
                [SIX_HOURS]
            );

            const merkleRoot = testHelpers.generateUniqueCommitment("pending-root");
            await governanceExecute(bridge, governanceExecutor, governance, "addMerkleRoot", [merkleRoot]);

            await time.increase(SIX_HOURS + 1);

            await expect(bridge.activateMerkleRoot(merkleRoot))
                .to.be.revertedWithCustomError(bridge, "InsufficientMerkleRootAttestations");

            await bridge.connect(validator1).attestMerkleRoot(merkleRoot);

            await expect(bridge.activateMerkleRoot(merkleRoot))
                .to.emit(bridge, "MerkleRootUpdated")
                .withArgs(merkleRoot, true);

            expect(await bridge.validMerkleRoots(merkleRoot)).to.be.true;

            await expect(bridge.connect(validator1).attestMerkleRoot(merkleRoot))
                .to.be.revertedWithCustomError(bridge, "MerkleRootNotPending");
        });

        it("Should require quorum attestations before finalizing Merkle root removals", async function () {
            const { bridge, tokenContract, governance, validator1, governanceExecutor } = await loadFixture(deployBridgeFixture);

            const stake = ethers.parseEther("10000");
            const validatorCommitment = testHelpers.generateUniqueCommitment("root-remove-validator");
            await tokenContract.connect(governance).transfer(validator1.address, stake);
            await mintShield(tokenContract, validator1, validatorCommitment, stake, testHelpers);

            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "addValidator",
                [validator1.address, validatorCommitment, stake]
            );

            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "setMerkleRootActivationDelay",
                [SIX_HOURS]
            );

            const merkleRoot = testHelpers.generateUniqueCommitment("active-root");
            await governanceExecute(bridge, governanceExecutor, governance, "addMerkleRoot", [merkleRoot]);
            await time.increase(SIX_HOURS + 1);
            await bridge.connect(validator1).attestMerkleRoot(merkleRoot);
            await bridge.activateMerkleRoot(merkleRoot);

            await governanceExecute(bridge, governanceExecutor, governance, "removeMerkleRoot", [merkleRoot]);
            await time.increase(SIX_HOURS + 1);

            await expect(bridge.finalizeMerkleRootRemoval(merkleRoot))
                .to.be.revertedWithCustomError(bridge, "InsufficientMerkleRootRemovalAttestations");

            await bridge.connect(validator1).attestMerkleRootRemoval(merkleRoot);

            await expect(bridge.finalizeMerkleRootRemoval(merkleRoot))
                .to.emit(bridge, "MerkleRootUpdated")
                .withArgs(merkleRoot, false);

            expect(await bridge.validMerkleRoots(merkleRoot)).to.be.false;
        });
    });

    describe("Security: Integer Underflow Tests", function () {
        it("Should handle pendingTransfersCount decrements correctly", async function () {
            const context = await loadFixture(deployBridgeFixture);
            const { bridge, validator1 } = context;
            const setup = await setupBridgeForTransfer(context);

            let count = await bridge.pendingTransfersCount();
            expect(count).to.equal(0n);
            
            const tx = await bridge.initiateTransfer(setup.transferParams);
            const receipt = await tx.wait();
            
            // Get transfer ID from event
            const transferInitiatedEvent = receipt.logs.find(log => {
                try {
                    const parsed = bridge.interface.parseLog(log);
                    return parsed && parsed.name === "TransferInitiated";
                } catch {
                    return false;
                }
            });
            
            if (!transferInitiatedEvent) {
                throw new Error("TransferInitiated event not found");
            }
            
            const parsed = bridge.interface.parseLog(transferInitiatedEvent);
            const transferId = parsed.args.transferId;
            
            // Count should increment
            count = await bridge.pendingTransfersCount();
            expect(count).to.equal(1n);
            
            // Validate transfer
            await bridge.connect(validator1).validateTransfer(
                transferId,
                true,
                ethers.keccak256(ethers.toUtf8Bytes("validation")),
                "0x"
            );
            
            // Wait for validation threshold check
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Advance time past challenge period
            await time.increase(86400 + 1);
            
            // Execute transfer - count should decrement
            await bridge.executeTransfer(transferId);
            
            // Count should be back to 0
            count = await bridge.pendingTransfersCount();
            expect(count).to.equal(0n);
            
            // Verify count never went below 0
            expect(count).to.be.gte(0n);
        });

        it("Should prevent underflow when decrementing pendingTransfersCount", async function () {
            const { bridge } = await loadFixture(deployBridgeFixture);
            
            // Verify initial state is 0
            let count = await bridge.pendingTransfersCount();
            expect(count).to.equal(0n);
            
            // The contract protects against decrementing below zero by checking
            // `if (pendingTransfersCount > 0)` before decrementing
            // Create a truly non-existent transfer ID using bytes32(0) or a random hash
            // that won't match any existing transfer
            const fakeTransferId = ethers.keccak256(ethers.toUtf8Bytes("non-existent-transfer-" + Date.now()));
            
            // This should revert - could be TransferNotFound or TransferNotValidated
            // The key is that it won't cause underflow
            await expect(
                bridge.executeTransfer(fakeTransferId)
            ).to.be.reverted; // Can be TransferNotFound or TransferNotValidated
            
            // Verify count is still 0 (no underflow occurred)
            count = await bridge.pendingTransfersCount();
            expect(count).to.equal(0n);
            expect(count).to.be.gte(0n);
        });
    });

    describe("Historical Exploit Regression", function () {
        it("Should reject zero-value Merkle roots to prevent Nomad-style default root attacks", async function () {
            const { bridge, governance, governanceExecutor } = await loadFixture(deployBridgeFixture);

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "addMerkleRoot",
                    [ethers.ZeroHash]
                )
            ).to.be.revertedWithCustomError(bridge, "InvalidMerkleRootValue");
        });

        it("Should block nullifier replays to mitigate Orbit-style replay drains", async function () {
            const context = await loadFixture(deployBridgeFixture);
            const { bridge } = context;
            const { transferParams } = await setupBridgeForTransfer(context);

            await bridge.initiateTransfer(transferParams);

            await expect(
                bridge.initiateTransfer(transferParams)
            ).to.be.revertedWithCustomError(bridge, "DuplicateNullifier");
        });

        it("Should enforce ZK proof verification to prevent Wormhole-style forged messages", async function () {
            const context = await loadFixture(deployBridgeFixture);
            const { bridge, verifierFactory } = context;
            const { transferParams } = await setupBridgeForTransfer(context);

            const bridgeVerifier = await verifierFactory.verifiers("bridge");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", bridgeVerifier);
            await mockVerifier.setShouldVerify(false);

            await expect(
                bridge.initiateTransfer(transferParams)
            ).to.be.revertedWithCustomError(bridge, "ProofVerificationFailed");
        });

        it("Should require governance delegates to be contracts to resist key-compromise takeovers", async function () {
            const { bridge, governance, governanceExecutor } = await loadFixture(deployBridgeFixture);

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "updateGovernance",
                    [governance.address]
                )
            ).to.be.revertedWithCustomError(bridge, "GovernanceMustBeContract");
        });

        it("Should prevent liquidity nullifier reuse to cover Multichain-style approval drains", async function () {
            const {
                bridge,
                tokenContract,
                verifierFactory,
                governance,
                governanceExecutor
            } = await loadFixture(deployBridgeFixture);

            const chainId = 42161;
            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "addSupportedChain",
                [
                    chainId,
                    "Arbitrum",
                    await bridge.getAddress(),
                    12,
                    ethers.parseEther("1"),
                    ethers.parseEther("1000000"),
                    10
                ]
            );

            const liquidityProof = testHelpers.generateMockZKProof("liquidity-challenge");
            const liquidityAmount = ethers.parseEther("50000");
            await mintShield(tokenContract, governance, liquidityProof.commitment, liquidityAmount, testHelpers);

            const liquidityParams = {
                chainId,
                amount: liquidityAmount,
                providerCommitment: liquidityProof.commitment,
                nullifier: liquidityProof.nullifier,
                zkProof: ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256[8]"],
                    [[
                        liquidityProof.a[0],
                        liquidityProof.a[1],
                        liquidityProof.b[0][0],
                        liquidityProof.b[0][1],
                        liquidityProof.b[1][0],
                        liquidityProof.b[1][1],
                        liquidityProof.c[0],
                        liquidityProof.c[1]
                    ]]
                )
            };

            const bridgeVerifier = await verifierFactory.verifiers("bridge");
            const mockVerifier = await ethers.getContractAt("MockZKVerifier", bridgeVerifier);
            await mockVerifier.setShouldVerify(true);

            await governanceExecute(
                bridge,
                governanceExecutor,
                governance,
                "addLiquidity",
                [liquidityParams]
            );

            await expect(
                governanceExecute(
                    bridge,
                    governanceExecutor,
                    governance,
                    "addLiquidity",
                    [liquidityParams]
                )
            ).to.be.revertedWithCustomError(bridge, "NullifierAlreadyUsed");
        });
    });
});

