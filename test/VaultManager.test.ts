import { expect } from "chai";
import { ethers } from "hardhat";
import { MockUSDC, VaultManager } from "../typechain-types";

describe("VaultManager", () => {
  let usdc: MockUSDC;
  let vault: VaultManager;
  let owner: any;
  let addr1: any;
  let feeReceiver: any;
  let coreAddress: any;

  const MINT_AMOUNT = ethers.parseUnits("100000", 6);
  const FUND_AMOUNT = ethers.parseUnits("10000", 6);

  before(async () => {
    [owner, addr1, feeReceiver, coreAddress] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const VaultManager = await ethers.getContractFactory("VaultManager");
    vault = await VaultManager.deploy(await usdc.getAddress(), feeReceiver.address);
    await vault.waitForDeployment();

    await usdc.mint(owner.address, MINT_AMOUNT);
  });

  describe("Deployment", () => {
    it("should set the correct token", async () => {
      expect(await vault.token()).to.equal(await usdc.getAddress());
    });

    it("should set the correct fee receiver", async () => {
      expect(await vault.feeReceiver()).to.equal(feeReceiver.address);
    });

    it("should set the correct owner", async () => {
      expect(await vault.owner()).to.equal(owner.address);
    });
  });

  describe("setFeeReceiver", () => {
    it("should update fee receiver", async () => {
      await vault.setFeeReceiver(addr1.address);
      expect(await vault.feeReceiver()).to.equal(addr1.address);
    });

    it("should revert when non-owner calls", async () => {
      await expect(
        vault.connect(addr1).setFeeReceiver(addr1.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should revert for zero address", async () => {
      await expect(
        vault.setFeeReceiver(ethers.ZeroAddress)
      ).to.be.revertedWith("VaultManager: zero address");
    });
  });

  describe("setCoreAddress", () => {
    it("should update core address", async () => {
      await vault.setCoreAddress(coreAddress.address);
      expect(await vault.coreAddress()).to.equal(coreAddress.address);
    });

    it("should revert when non-owner calls", async () => {
      await expect(
        vault.connect(addr1).setCoreAddress(addr1.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("fundVault", () => {
    it("should fund vault with tokens", async () => {
      await usdc.approve(await vault.getAddress(), FUND_AMOUNT);
      await vault.fundVault(FUND_AMOUNT);
      expect(await vault.vaultBalance()).to.equal(FUND_AMOUNT);
    });

    it("should revert for zero amount", async () => {
      await expect(vault.fundVault(0)).to.be.revertedWith("VaultManager: zero amount");
    });

    it("should revert when paused", async () => {
      await vault.pause();
      await usdc.approve(await vault.getAddress(), FUND_AMOUNT);
      await expect(vault.fundVault(FUND_AMOUNT)).to.be.revertedWithCustomError(
        vault,
        "EnforcedPause"
      );
      await vault.unpause();
    });
  });

  describe("withdrawVault", () => {
    it("should withdraw from vault", async () => {
      const balanceBefore = await usdc.balanceOf(owner.address);
      await vault.withdrawVault(FUND_AMOUNT);
      const balanceAfter = await usdc.balanceOf(owner.address);
      expect(balanceAfter - balanceBefore).to.equal(FUND_AMOUNT);
      expect(await vault.vaultBalance()).to.equal(0n);
    });

    it("should revert when non-owner calls", async () => {
      await expect(
        vault.connect(addr1).withdrawVault(FUND_AMOUNT)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should revert for zero amount", async () => {
      await expect(vault.withdrawVault(0)).to.be.revertedWith("VaultManager: zero amount");
    });

    it("should revert for insufficient balance", async () => {
      await expect(vault.withdrawVault(FUND_AMOUNT)).to.be.revertedWith(
        "VaultManager: insufficient balance"
      );
    });

    it("should revert when paused", async () => {
      await usdc.approve(await vault.getAddress(), FUND_AMOUNT);
      await vault.fundVault(FUND_AMOUNT);
      await vault.pause();
      await expect(vault.withdrawVault(FUND_AMOUNT)).to.be.revertedWithCustomError(
        vault,
        "EnforcedPause"
      );
      await vault.unpause();
      await vault.withdrawVault(FUND_AMOUNT);
    });
  });

  describe("payInterest", () => {
    beforeEach(async () => {
      await usdc.approve(await vault.getAddress(), FUND_AMOUNT);
      await vault.fundVault(FUND_AMOUNT);
    });

    it("should pay interest from core address", async () => {
      const amount = ethers.parseUnits("100", 6);
      await vault.connect(coreAddress).payInterest(addr1.address, amount);
      expect(await usdc.balanceOf(addr1.address)).to.equal(amount);
    });

    it("should revert when non-core calls", async () => {
      const amount = ethers.parseUnits("100", 6);
      await expect(
        vault.connect(addr1).payInterest(addr1.address, amount)
      ).to.be.revertedWith("VaultManager: caller is not the core");
    });

    it("should revert for zero amount", async () => {
      await expect(
        vault.connect(coreAddress).payInterest(addr1.address, 0)
      ).to.be.revertedWith("VaultManager: zero amount");
    });

    it("should revert for insufficient balance", async () => {
      const tooMuch = ethers.parseUnits("100000", 6);
      await expect(
        vault.connect(coreAddress).payInterest(addr1.address, tooMuch)
      ).to.be.revertedWith("VaultManager: insufficient balance");
    });

    afterEach(async () => {
      const balance = await vault.vaultBalance();
      if (balance > 0n) {
        await vault.withdrawVault(balance);
      }
    });
  });

  describe("pause/unpause", () => {
    it("should pause and unpause", async () => {
      await vault.pause();
      expect(await vault.paused()).to.be.true;
      await vault.unpause();
      expect(await vault.paused()).to.be.false;
    });

    it("should revert when non-owner pauses", async () => {
      await expect(vault.connect(addr1).pause()).to.be.revertedWithCustomError(
        vault,
        "OwnableUnauthorizedAccount"
      );
    });

    it("should revert when non-owner unpauses", async () => {
      await vault.pause();
      await expect(vault.connect(addr1).unpause()).to.be.revertedWithCustomError(
        vault,
        "OwnableUnauthorizedAccount"
      );
      await vault.unpause();
    });
  });
});
