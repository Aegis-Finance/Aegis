const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("ValidationLibrary (via ValidationLibraryHarness)", function () {
  async function deployHarness() {
    const LibFactory = await ethers.getContractFactory("ValidationLibrary");
    const lib = await LibFactory.deploy();
    await lib.waitForDeployment();
    const libAddress = await lib.getAddress();
    const Factory = await ethers.getContractFactory("ValidationLibraryHarness", {
      libraries: {
        "contracts/libraries/ValidationLibrary.sol:ValidationLibrary": libAddress,
      },
    });
    const harness = await Factory.deploy();
    await harness.waitForDeployment();
    return { harness, libAddress };
  }

  describe("bond and address guards", function () {
    it("validateBondAmount accepts exactly 0.1 ether", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateBondAmount(ethers.parseEther("0.1"))).to.not.be.reverted;
    });

    it("validateBondAmount reverts below minimum bond", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateBondAmount(ethers.parseEther("0.099"))).to.be.reverted;
    });

    it("validateAddress reverts on zero address", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateAddress(ethers.ZeroAddress)).to.be.reverted;
    });

    it("validateNonEmptyArray reverts on zero length", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateNonEmptyArray(0)).to.be.reverted;
    });

    it("validateNonEmptyArray accepts positive length", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateNonEmptyArray(1)).to.not.be.reverted;
    });
  });

  describe("string and rating bounds", function () {
    it("validateStringLength accepts boundary min/max", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateStringLength("abc", 3, 10)).to.not.be.reverted;
      await expect(harness.exValidateStringLength("abcdefghij", 3, 10)).to.not.be.reverted;
    });

    it("validateStringLength reverts when too short", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateStringLength("ab", 3, 10)).to.be.reverted;
    });

    it("validateStringLength reverts when too long", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateStringLength("abcdefghijk", 3, 10)).to.be.reverted;
    });

    it("validateRating accepts 1 and 5", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateRating(1)).to.not.be.reverted;
      await expect(harness.exValidateRating(5)).to.not.be.reverted;
    });

    it("validateRating reverts for 0 and 6", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateRating(0)).to.be.reverted;
      await expect(harness.exValidateRating(6)).to.be.reverted;
    });
  });

  describe("profile and feedback bundles", function () {
    it("validateProfileInputs accepts valid name and description lengths", async function () {
      const { harness } = await loadFixture(deployHarness);
      const name = "Alice";
      const desc = "1234567890"; // 10 chars — min description length
      await expect(harness.exValidateProfileInputs(name, desc)).to.not.be.reverted;
    });

    it("validateProfileInputs reverts on short profile name", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateProfileInputs("Al", "1234567890")).to.be.reverted;
    });

    it("validateFeedbackInputs accepts all ratings 3 with short text", async function () {
      const { harness } = await loadFixture(deployHarness);
      const text = "1234567890"; // 10 chars — min endorsement-style bound for feedback text
      await expect(harness.exValidateFeedbackInputs(3, 3, 3, 3, text)).to.not.be.reverted;
    });

    it("validateFeedbackInputs reverts when any rating out of range", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateFeedbackInputs(0, 3, 3, 3, "1234567890")).to.be.reverted;
    });

    it("validateSkillEndorsement accepts valid skill and endorsement", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateSkillEndorsement("Rust", "1234567890")).to.not.be.reverted;
    });

    it("validateSkillEndorsement reverts on too-short skill name", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateSkillEndorsement("R", "1234567890")).to.be.reverted;
    });
  });

  describe("campaign, bond parameters, verification types", function () {
    it("validateCampaignRegistration reverts for id zero", async function () {
      const { harness } = await loadFixture(deployHarness);
      const [, signer] = await ethers.getSigners();
      await expect(harness.exValidateCampaignRegistration(0, signer.address)).to.be.reverted;
    });

    it("validateCampaignRegistration reverts for zero creator", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateCampaignRegistration(1, ethers.ZeroAddress)).to.be.reverted;
    });

    it("validateBondParameters accepts type 2 with valid amount and duration", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateBondParameters(2, ethers.parseEther("1"), 7 * 24 * 3600)).to.not.be.reverted;
    });

    it("validateBondParameters reverts for bond type > 2", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateBondParameters(3, ethers.parseEther("1"), 7 * 24 * 3600)).to.be.reverted;
    });

    it("validateBondParameters reverts for duration under 1 day", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateBondParameters(0, ethers.parseEther("1"), 3600)).to.be.reverted;
    });

    it("validateVerificationUpdate accepts known verification type hashes", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateVerificationUpdate("identity", true)).to.not.be.reverted;
      await expect(harness.exValidateVerificationUpdate("social", false)).to.not.be.reverted;
    });

    it("validateVerificationUpdate reverts for unknown type", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateVerificationUpdate("unknown", true)).to.be.reverted;
    });
  });

  describe("profile metadata graph", function () {
    it("validateProfileMetadata accepts single valid skill", async function () {
      const { harness } = await loadFixture(deployHarness);
      const md = {
        skills: ["Rust"],
        industries: [],
        location: "",
        timezone: "",
        preferredLanguages: "",
        experience: "",
        education: "",
        certifications: "",
      };
      await expect(harness.exValidateProfileMetadata(md)).to.not.be.reverted;
    });

    it("validateProfileMetadata reverts when skills array empty", async function () {
      const { harness } = await loadFixture(deployHarness);
      const md = {
        skills: [],
        industries: [],
        location: "",
        timezone: "",
        preferredLanguages: "",
        experience: "",
        education: "",
        certifications: "",
      };
      await expect(harness.exValidateProfileMetadata(md)).to.be.reverted;
    });

    it("validateProfileMetadata reverts when a skill name is too short", async function () {
      const { harness } = await loadFixture(deployHarness);
      const md = {
        skills: ["A"],
        industries: [],
        location: "",
        timezone: "",
        preferredLanguages: "",
        experience: "",
        education: "",
        certifications: "",
      };
      await expect(harness.exValidateProfileMetadata(md)).to.be.reverted;
    });
  });

  describe("feedback submission gate", function () {
    it("validateFeedbackSubmission accepts happy path", async function () {
      const { harness } = await loadFixture(deployHarness);
      const [, , , signer] = await ethers.getSigners();
      await expect(
        harness.exValidateFeedbackSubmission(
          1,
          signer.address,
          "12345678901234567890",
          false,
          true,
          "0x0000000000000000000000000000000000000001"
        )
      ).to.not.be.reverted;
    });

    it("validateFeedbackSubmission reverts when feedback already provided", async function () {
      const { harness } = await loadFixture(deployHarness);
      const [, , , signer] = await ethers.getSigners();
      await expect(
        harness.exValidateFeedbackSubmission(
          1,
          signer.address,
          "12345678901234567890",
          true,
          true,
          "0x0000000000000000000000000000000000000001"
        )
      ).to.be.reverted;
    });

    it("validateFeedbackSubmission reverts when creator inactive", async function () {
      const { harness } = await loadFixture(deployHarness);
      const [, , , signer] = await ethers.getSigners();
      await expect(
        harness.exValidateFeedbackSubmission(
          1,
          signer.address,
          "12345678901234567890",
          false,
          false,
          "0x0000000000000000000000000000000000000001"
        )
      ).to.be.reverted;
    });

    it("validateFeedbackSubmission reverts when campaign id is zero", async function () {
      const { harness } = await loadFixture(deployHarness);
      const [, , , signer] = await ethers.getSigners();
      await expect(
        harness.exValidateFeedbackSubmission(
          0,
          signer.address,
          "12345678901234567890",
          false,
          true,
          "0x0000000000000000000000000000000000000001"
        )
      ).to.be.reverted;
    });

    it("validateFeedbackSubmission reverts when feedback text is too short", async function () {
      const { harness } = await loadFixture(deployHarness);
      const [, , , signer] = await ethers.getSigners();
      await expect(
        harness.exValidateFeedbackSubmission(
          1,
          signer.address,
          "123456789",
          false,
          true,
          "0x0000000000000000000000000000000000000001"
        )
      ).to.be.reverted;
    });

    it("validateFeedbackSubmission reverts when crowdShield is zero", async function () {
      const { harness } = await loadFixture(deployHarness);
      const [, , , signer] = await ethers.getSigners();
      await expect(
        harness.exValidateFeedbackSubmission(1, signer.address, "12345678901234567890", false, true, ethers.ZeroAddress)
      ).to.be.reverted;
    });
  });

  describe("additional profile feedback and bond cases", function () {
    it("validateProfileInputs reverts when profile name exceeds max length", async function () {
      const { harness } = await loadFixture(deployHarness);
      const name = "a".repeat(51);
      const desc = "1234567890";
      await expect(harness.exValidateProfileInputs(name, desc)).to.be.reverted;
    });

    it("validateProfileInputs reverts when description is below minimum length", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateProfileInputs("Alice", "123456789")).to.be.reverted;
    });

    it("validateProfileInputs reverts when description exceeds max length", async function () {
      const { harness } = await loadFixture(deployHarness);
      const desc = "x".repeat(501);
      await expect(harness.exValidateProfileInputs("Alice", desc)).to.be.reverted;
    });

    it("validateFeedbackInputs reverts when feedback text exceeds max length", async function () {
      const { harness } = await loadFixture(deployHarness);
      const text = "z".repeat(201);
      await expect(harness.exValidateFeedbackInputs(3, 3, 3, 3, text)).to.be.reverted;
    });

    it("validateBondParameters reverts when duration exceeds one year", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateBondParameters(0, ethers.parseEther("1"), 366 * 24 * 3600)).to.be.reverted;
    });

    it("validateCampaignRegistration accepts non-zero id and non-zero creator", async function () {
      const { harness } = await loadFixture(deployHarness);
      const [, signer] = await ethers.getSigners();
      await expect(harness.exValidateCampaignRegistration(42, signer.address)).to.not.be.reverted;
    });

    it("validateSkillEndorsement reverts when endorsement text is too short", async function () {
      const { harness } = await loadFixture(deployHarness);
      await expect(harness.exValidateSkillEndorsement("Rust", "123456789")).to.be.reverted;
    });

    it("validateProfileMetadata reverts when a skill name is too long", async function () {
      const { harness } = await loadFixture(deployHarness);
      const md = {
        skills: ["a".repeat(31)],
        industries: [],
        location: "",
        timezone: "",
        preferredLanguages: "",
        experience: "",
        education: "",
        certifications: "",
      };
      await expect(harness.exValidateProfileMetadata(md)).to.be.reverted;
    });
  });
});
