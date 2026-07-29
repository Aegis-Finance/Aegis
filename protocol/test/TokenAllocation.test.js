const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TokenAllocation", function () {
    async function deployTokenAllocationFixture() {
        const [owner, governance, user1, user2, treasury, ecosystem] = await ethers.getSigners();
        
        // Deploy TokenAllocation - constructor takes initialOwner, which should be owner
        const TokenAllocation = await ethers.getContractFactory("TokenAllocation");
        const tokenAllocation = await TokenAllocation.deploy(owner.address);
        await tokenAllocation.waitForDeployment();
        
        // Deploy mock token for testing
        const MockERC20 = await ethers.getContractFactory("contracts/test/TokenDistributionMocks.sol:MockERC20");
        const mockToken = await MockERC20.deploy("Aegis Token", "AGS", ethers.parseEther("21000000"));
        await mockToken.waitForDeployment();
        
        return {
            tokenAllocation,
            mockToken,
            owner,
            governance,
            user1,
            user2,
            treasury,
            ecosystem
        };
    }
    
    describe("Deployment", function () {
        it("Should deploy with correct owner", async function () {
            const { tokenAllocation, owner } = await loadFixture(deployTokenAllocationFixture);
            
            expect(await tokenAllocation.owner()).to.equal(owner.address);
        });
        
        it("Should deploy successfully with owner address", async function () {
            const TokenAllocation = await ethers.getContractFactory("TokenAllocation");
            const [owner] = await ethers.getSigners();
            
            const tokenAllocation = await TokenAllocation.deploy(owner.address);
            await tokenAllocation.waitForDeployment();
            
            expect(await tokenAllocation.owner()).to.equal(owner.address);
        });
    });
    
    describe("Token Setup", function () {
        it("Should allow owner to set token contract", async function () {
            const { tokenAllocation, mockToken, owner } = await loadFixture(deployTokenAllocationFixture);
            
            await expect(
                tokenAllocation.connect(owner).setToken(await mockToken.getAddress())
            ).to.emit(tokenAllocation, "AllocationAddressSet")
                .withArgs("token", await mockToken.getAddress());
            
            expect(await tokenAllocation.token()).to.equal(await mockToken.getAddress());
            expect(await tokenAllocation.tokenSet()).to.be.true;
        });
        
        it("Should prevent setting token twice", async function () {
            const { tokenAllocation, mockToken, owner } = await loadFixture(deployTokenAllocationFixture);
            
            await tokenAllocation.connect(owner).setToken(await mockToken.getAddress());
            
            await expect(
                tokenAllocation.connect(owner).setToken(await mockToken.getAddress())
            ).to.be.revertedWithCustomError(tokenAllocation, "TokenAlreadySet");
        });
        
        it("Should prevent setting zero address as token", async function () {
            const { tokenAllocation, owner } = await loadFixture(deployTokenAllocationFixture);
            
            await expect(
                tokenAllocation.connect(owner).setToken(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(tokenAllocation, "InvalidAddress");
        });
    });
    
    describe("Allocation Address Setup", function () {
        it("Should allow owner to set public sale contract", async function () {
            const { tokenAllocation, owner, user1 } = await loadFixture(deployTokenAllocationFixture);
            
            await expect(
                tokenAllocation.connect(owner).setPublicSaleContract(user1.address)
            ).to.emit(tokenAllocation, "AllocationAddressSet")
                .withArgs("public", user1.address);
            
            expect(await tokenAllocation.publicSaleContract()).to.equal(user1.address);
        });
        
        it("Should allow owner to set ecosystem rewards contract", async function () {
            const { tokenAllocation, owner, user1 } = await loadFixture(deployTokenAllocationFixture);
            
            await expect(
                tokenAllocation.connect(owner).setEcosystemRewardsContract(user1.address)
            ).to.emit(tokenAllocation, "AllocationAddressSet")
                .withArgs("ecosystem", user1.address);
            
            expect(await tokenAllocation.ecosystemRewardsContract()).to.equal(user1.address);
        });
        
        it("Should allow owner to set treasury wallet", async function () {
            const { tokenAllocation, owner, treasury } = await loadFixture(deployTokenAllocationFixture);
            
            await expect(
                tokenAllocation.connect(owner).setTreasuryWallet(treasury.address)
            ).to.emit(tokenAllocation, "AllocationAddressSet")
                .withArgs("treasury", treasury.address);
            
            expect(await tokenAllocation.treasuryWallet()).to.equal(treasury.address);
        });
    });
    
    describe("Token Allocation", function () {
        it("Should allow owner to allocate public tokens", async function () {
            const { tokenAllocation, mockToken, owner, user1 } = await loadFixture(deployTokenAllocationFixture);
            
            // Setup
            await tokenAllocation.connect(owner).setToken(await mockToken.getAddress());
            await tokenAllocation.connect(owner).setPublicSaleContract(user1.address);
            
            // Mint tokens to allocation contract
            const publicAmount = await tokenAllocation.publicAllocation();
            await mockToken.mint(await tokenAllocation.getAddress(), publicAmount);
            
            await expect(
                tokenAllocation.connect(owner).allocatePublicTokens()
            ).to.emit(tokenAllocation, "TokensAllocated")
                .withArgs("public", user1.address, publicAmount);
            
            expect(await mockToken.balanceOf(user1.address)).to.equal(publicAmount);
            expect(await tokenAllocation.allocationCompleted("public")).to.be.true;
        });
        
        it("Should allow owner to allocate ecosystem tokens", async function () {
            const { tokenAllocation, mockToken, owner, ecosystem } = await loadFixture(deployTokenAllocationFixture);
            
            // Setup
            await tokenAllocation.connect(owner).setToken(await mockToken.getAddress());
            await tokenAllocation.connect(owner).setEcosystemRewardsContract(ecosystem.address);
            
            // Mint tokens to allocation contract
            const ecosystemAmount = await tokenAllocation.ecosystemAllocation();
            await mockToken.mint(await tokenAllocation.getAddress(), ecosystemAmount);
            
            await expect(
                tokenAllocation.connect(owner).allocateEcosystemTokens()
            ).to.emit(tokenAllocation, "TokensAllocated")
                .withArgs("ecosystem", ecosystem.address, ecosystemAmount);
            
            expect(await mockToken.balanceOf(ecosystem.address)).to.equal(ecosystemAmount);
        });
        
        it("Should allow owner to allocate treasury tokens", async function () {
            const { tokenAllocation, mockToken, owner, treasury } = await loadFixture(deployTokenAllocationFixture);
            
            // Setup
            await tokenAllocation.connect(owner).setToken(await mockToken.getAddress());
            await tokenAllocation.connect(owner).setTreasuryWallet(treasury.address);
            
            // Mint tokens to allocation contract
            const treasuryAmount = await tokenAllocation.treasuryAllocation();
            await mockToken.mint(await tokenAllocation.getAddress(), treasuryAmount);
            
            await expect(
                tokenAllocation.connect(owner).allocateTreasuryTokens()
            ).to.emit(tokenAllocation, "TokensAllocated")
                .withArgs("treasury", treasury.address, treasuryAmount);
            
            expect(await mockToken.balanceOf(treasury.address)).to.equal(treasuryAmount);
        });
        
        it("Should prevent allocating when address not set", async function () {
            const { tokenAllocation, mockToken, owner } = await loadFixture(deployTokenAllocationFixture);
            
            await tokenAllocation.connect(owner).setToken(await mockToken.getAddress());
            
            await expect(
                tokenAllocation.connect(owner).allocatePublicTokens()
            ).to.be.revertedWithCustomError(tokenAllocation, "AllocationAddressNotSet");
        });
        
        it("Should prevent double allocation", async function () {
            const { tokenAllocation, mockToken, owner, user1 } = await loadFixture(deployTokenAllocationFixture);
            
            // Setup
            await tokenAllocation.connect(owner).setToken(await mockToken.getAddress());
            await tokenAllocation.connect(owner).setPublicSaleContract(user1.address);
            
            const publicAmount = await tokenAllocation.publicAllocation();
            await mockToken.mint(await tokenAllocation.getAddress(), publicAmount);
            
            await tokenAllocation.connect(owner).allocatePublicTokens();
            
            // Try to allocate again
            await expect(
                tokenAllocation.connect(owner).allocatePublicTokens()
            ).to.be.revertedWithCustomError(tokenAllocation, "AllocationAlreadyCompleted");
        });
        
        it("Should allow allocating all tokens at once", async function () {
            const { tokenAllocation, mockToken, owner, user1, ecosystem, treasury } = await loadFixture(deployTokenAllocationFixture);
            
            // Setup
            await tokenAllocation.connect(owner).setToken(await mockToken.getAddress());
            await tokenAllocation.connect(owner).setPublicSaleContract(user1.address);
            await tokenAllocation.connect(owner).setEcosystemRewardsContract(ecosystem.address);
            await tokenAllocation.connect(owner).setTreasuryWallet(treasury.address);
            
            // Mint all tokens
            const totalAllocation = await tokenAllocation.TOTAL_ALLOCATION();
            await mockToken.mint(await tokenAllocation.getAddress(), totalAllocation);
            
            await expect(
                tokenAllocation.connect(owner).allocateAllTokens()
            ).to.emit(tokenAllocation, "TokensAllocated");
            
            const publicAmount = await tokenAllocation.publicAllocation();
            const ecosystemAmount = await tokenAllocation.ecosystemAllocation();
            const treasuryAmount = await tokenAllocation.treasuryAllocation();
            
            expect(await mockToken.balanceOf(user1.address)).to.equal(publicAmount);
            expect(await mockToken.balanceOf(ecosystem.address)).to.equal(ecosystemAmount);
            expect(await mockToken.balanceOf(treasury.address)).to.equal(treasuryAmount);
        });
    });
    
    describe("Allocation Queries", function () {
        it("Should return correct allocation amounts", async function () {
            const { tokenAllocation } = await loadFixture(deployTokenAllocationFixture);
            
            const [publicAmount, ecosystemAmount, treasuryAmount] = await tokenAllocation.getAllocationAmounts();
            
            expect(publicAmount).to.equal(ethers.parseEther("10500000")); // 50% of 21M
            expect(ecosystemAmount).to.equal(ethers.parseEther("6300000")); // 30% of 21M
            expect(treasuryAmount).to.equal(ethers.parseEther("4200000")); // 20% of 21M
            
            const total = publicAmount + ecosystemAmount + treasuryAmount;
            expect(total).to.equal(ethers.parseEther("21000000"));
        });
        
        it("Should return correct allocation status", async function () {
            const { tokenAllocation } = await loadFixture(deployTokenAllocationFixture);
            
            const [publicCompleted, ecosystemCompleted, treasuryCompleted] = await tokenAllocation.getAllocationStatus();
            
            expect(publicCompleted).to.be.false;
            expect(ecosystemCompleted).to.be.false;
            expect(treasuryCompleted).to.be.false;
        });
    });
    
    describe("Access Control", function () {
        it("Should allow owner to set governance contract", async function () {
            const { tokenAllocation, owner, user1 } = await loadFixture(deployTokenAllocationFixture);
            
            await expect(
                tokenAllocation.connect(owner).setGovernanceContract(user1.address)
            ).to.emit(tokenAllocation, "GovernanceUpdated")
                .withArgs(ethers.ZeroAddress, user1.address);
            
            expect(await tokenAllocation.governanceContract()).to.equal(user1.address);
        });
        
        it("Should prevent setting governance twice", async function () {
            const { tokenAllocation, owner, user1, user2 } = await loadFixture(deployTokenAllocationFixture);
            
            await tokenAllocation.connect(owner).setGovernanceContract(user1.address);
            
            await expect(
                tokenAllocation.connect(owner).setGovernanceContract(user2.address)
            ).to.be.reverted;
        });
        
        it("Should allow governance to recover tokens", async function () {
            const { tokenAllocation, mockToken, owner, governance, user1 } = await loadFixture(deployTokenAllocationFixture);
            
            // Setup
            await tokenAllocation.connect(owner).setToken(await mockToken.getAddress());
            await tokenAllocation.connect(owner).setGovernanceContract(governance.address);
            
            // Mint some tokens to contract
            const amount = ethers.parseEther("1000");
            await mockToken.mint(await tokenAllocation.getAddress(), amount);
            
            await expect(
                tokenAllocation.connect(governance).emergencyRecoverTokens(user1.address)
            ).to.emit(tokenAllocation, "EmergencyTokenRecovery")
                .withArgs(user1.address, amount);
            
            expect(await mockToken.balanceOf(user1.address)).to.equal(amount);
        });
        
        it("Should prevent non-governance from recovering tokens", async function () {
            const { tokenAllocation, mockToken, owner, governance, user1 } = await loadFixture(deployTokenAllocationFixture);
            
            // Setup token and governance
            await tokenAllocation.connect(owner).setToken(await mockToken.getAddress());
            await tokenAllocation.connect(owner).setGovernanceContract(governance.address);
            
            // Try to recover tokens as non-governance user
            await expect(
                tokenAllocation.connect(user1).emergencyRecoverTokens(user1.address)
            ).to.be.revertedWithCustomError(tokenAllocation, "UnauthorizedAccess");
        });
    });
    
    describe("Constants", function () {
        it("Should have correct allocation percentages", async function () {
            const { tokenAllocation } = await loadFixture(deployTokenAllocationFixture);
            
            expect(await tokenAllocation.PUBLIC_ALLOCATION_BP()).to.equal(5000); // 50%
            expect(await tokenAllocation.ECOSYSTEM_ALLOCATION_BP()).to.equal(3000); // 30%
            expect(await tokenAllocation.TREASURY_ALLOCATION_BP()).to.equal(2000); // 20%
            expect(await tokenAllocation.TOTAL_ALLOCATION()).to.equal(ethers.parseEther("21000000"));
        });
    });
});

