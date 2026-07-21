import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { MockUSDC, VaultManager, SavingCore } from "../typechain-types";

describe("SavingCore — Day 2", () => {
  let usdc: MockUSDC;
  let vault: VaultManager;
  let core: SavingCore;
  let owner: any;
  let alice: any;
  let bob: any;

  const DECIMALS = 6;
  const MINT_AMOUNT = ethers.parseUnits("1000000", DECIMALS);
  const VAULT_FUND = ethers.parseUnits("500000", DECIMALS);

  // Personal variant values (MSSV=33): A=3, B=3
  const APR_BPS = 275; // 2.75%
  const TENOR_DAYS = 180;
  const PENALTY_BPS = 450; // 4.5%
  const GRACE_PERIOD_DAYS = 2;

  before(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const VaultManager = await ethers.getContractFactory("VaultManager");
    vault = await VaultManager.deploy(await usdc.getAddress(), owner.address);
    await vault.waitForDeployment();

    const SavingCore = await ethers.getContractFactory("SavingCore");
    core = await SavingCore.deploy(await usdc.getAddress(), await vault.getAddress());
    await core.waitForDeployment();

    // Setup: fund vault and link core
    await usdc.mint(owner.address, MINT_AMOUNT);
    await usdc.approve(await vault.getAddress(), VAULT_FUND);
    await vault.fundVault(VAULT_FUND);
    await vault.setCoreAddress(await core.getAddress());

    // Give alice some USDC
    await usdc.mint(alice.address, ethers.parseUnits("100000", DECIMALS));
  });

  // ──────────────────────────── Plan Creation ────────────────────────────

  describe("createPlan", () => {
    it("should create a plan with valid params", async () => {
      await core.createPlan(TENOR_DAYS, APR_BPS, ethers.parseUnits("100", DECIMALS), ethers.parseUnits("50000", DECIMALS), PENALTY_BPS);
      const plan = await core.getPlan(0);
      expect(plan.tenorDays).to.equal(TENOR_DAYS);
      expect(plan.aprBps).to.equal(APR_BPS);
      expect(plan.enabled).to.be.true;
    });

    it("should revert for non-owner", async () => {
      await expect(
        core.connect(alice).createPlan(TENOR_DAYS, APR_BPS, ethers.parseUnits("100", DECIMALS), ethers.parseUnits("50000", DECIMALS), PENALTY_BPS)
      ).to.be.revertedWithCustomError(core, "OwnableUnauthorizedAccount");
    });

    it("should revert for zero tenor", async () => {
      await expect(
        core.createPlan(0, APR_BPS, ethers.parseUnits("100", DECIMALS), ethers.parseUnits("50000", DECIMALS), PENALTY_BPS)
      ).to.be.revertedWith("SavingCore: tenor must be > 0");
    });

    it("should revert for zero APR", async () => {
      await expect(
        core.createPlan(TENOR_DAYS, 0, ethers.parseUnits("100", DECIMALS), ethers.parseUnits("50000", DECIMALS), PENALTY_BPS)
      ).to.be.revertedWith("SavingCore: invalid APR");
    });

    it("should revert for APR > 10000 bps", async () => {
      await expect(
        core.createPlan(TENOR_DAYS, 10001, ethers.parseUnits("100", DECIMALS), ethers.parseUnits("50000", DECIMALS), PENALTY_BPS)
      ).to.be.revertedWith("SavingCore: invalid APR");
    });

    it("should revert when max < min", async () => {
      await expect(
        core.createPlan(TENOR_DAYS, APR_BPS, ethers.parseUnits("50000", DECIMALS), ethers.parseUnits("100", DECIMALS), PENALTY_BPS)
      ).to.be.revertedWith("SavingCore: max < min");
    });

    it("should emit PlanCreated event", async () => {
      await expect(
        core.createPlan(TENOR_DAYS, APR_BPS, ethers.parseUnits("100", DECIMALS), ethers.parseUnits("50000", DECIMALS), PENALTY_BPS)
      ).to.emit(core, "PlanCreated");
    });
  });

  // ──────────────────────────── Plan Update ────────────────────────────

  describe("updatePlan", () => {
    before(async () => {
      // Plan 0 already exists from createPlan tests
    });

    it("should update a plan", async () => {
      await core.updatePlan(0, 90, 500, ethers.parseUnits("200", DECIMALS), ethers.parseUnits("100000", DECIMALS), 300);
      const plan = await core.getPlan(0);
      expect(plan.tenorDays).to.equal(90);
      expect(plan.aprBps).to.equal(500);
    });

    it("should revert for invalid plan id", async () => {
      await expect(
        core.updatePlan(99, TENOR_DAYS, APR_BPS, ethers.parseUnits("100", DECIMALS), ethers.parseUnits("50000", DECIMALS), PENALTY_BPS)
      ).to.be.revertedWith("SavingCore: invalid plan");
    });

    it("should emit PlanUpdated event", async () => {
      await expect(
        core.updatePlan(0, TENOR_DAYS, APR_BPS, ethers.parseUnits("100", DECIMALS), ethers.parseUnits("50000", DECIMALS), PENALTY_BPS)
      ).to.emit(core, "PlanUpdated");
    });
  });

  // ──────────────────────────── Enable/Disable Plan ────────────────────────────

  describe("enablePlan / disablePlan", () => {
    it("should disable a plan", async () => {
      await core.disablePlan(0);
      const plan = await core.getPlan(0);
      expect(plan.enabled).to.be.false;
    });

    it("should emit PlanDisabled", async () => {
      await expect(core.disablePlan(0)).to.emit(core, "PlanDisabled");
    });

    it("should enable a plan", async () => {
      await core.enablePlan(0);
      const plan = await core.getPlan(0);
      expect(plan.enabled).to.be.true;
    });

    it("should emit PlanEnabled", async () => {
      await expect(core.enablePlan(0)).to.emit(core, "PlanEnabled");
    });

    it("should revert for non-owner", async () => {
      await expect(
        core.connect(alice).disablePlan(0)
      ).to.be.revertedWithCustomError(core, "OwnableUnauthorizedAccount");
    });
  });

  // ──────────────────────────── openDeposit ────────────────────────────

  describe("openDeposit", () => {
    const DEPOSIT_AMOUNT = ethers.parseUnits("1000", DECIMALS);

    it("should open a deposit and mint NFT", async () => {
      await usdc.connect(alice).approve(await core.getAddress(), DEPOSIT_AMOUNT);
      const tx = await core.connect(alice).openDeposit(0, DEPOSIT_AMOUNT);
      await tx.wait();

      expect(await core.ownerOf(0)).to.equal(alice.address);
      const dep = await core.deposits(0);
      expect(dep.principal).to.equal(DEPOSIT_AMOUNT);
      expect(dep.planId).to.equal(0);
      expect(dep.status).to.equal(0); // Active
    });

    it("should emit DepositOpened", async () => {
      await usdc.connect(alice).approve(await core.getAddress(), DEPOSIT_AMOUNT);
      await expect(
        core.connect(alice).openDeposit(0, DEPOSIT_AMOUNT)
      ).to.emit(core, "DepositOpened");
    });

    it("should revert for disabled plan", async () => {
      await core.disablePlan(0);
      await usdc.connect(alice).approve(await core.getAddress(), DEPOSIT_AMOUNT);
      await expect(
        core.connect(alice).openDeposit(0, DEPOSIT_AMOUNT)
      ).to.be.revertedWith("SavingCore: plan disabled");
      await core.enablePlan(0);
    });

    it("should revert for amount below min", async () => {
      const tooLow = ethers.parseUnits("1", DECIMALS); // min is 100
      await usdc.connect(alice).approve(await core.getAddress(), tooLow);
      await expect(
        core.connect(alice).openDeposit(0, tooLow)
      ).to.be.revertedWith("SavingCore: amount out of range");
    });

    it("should revert for amount above max", async () => {
      const tooHigh = ethers.parseUnits("100000", DECIMALS); // max is 50000
      await usdc.connect(alice).approve(await core.getAddress(), tooHigh);
      await expect(
        core.connect(alice).openDeposit(0, tooHigh)
      ).to.be.revertedWith("SavingCore: amount out of range");
    });

    it("should revert for invalid plan id", async () => {
      await expect(
        core.connect(alice).openDeposit(99, DEPOSIT_AMOUNT)
      ).to.be.revertedWith("SavingCore: invalid plan");
    });
  });

  // ──────────────────────────── withdrawAtMaturity ────────────────────────────

  describe("withdrawAtMaturity", () => {
    const DEPOSIT_AMOUNT = ethers.parseUnits("1000", DECIMALS);

    it("should withdraw with correct interest", async () => {
      // Alice already has deposit 0 from openDeposit test
      // Fast-forward to maturity (180 days)
      await time.increase(TENOR_DAYS * 86400);

      const aliceBefore = await usdc.balanceOf(alice.address);
      const vaultBefore = await vault.vaultBalance();

      await core.connect(alice).withdrawAtMaturity(0);

      const aliceAfter = await usdc.balanceOf(alice.address);
      const vaultAfter = await vault.vaultBalance();

      // Interest = (principal * aprBps * tenorSeconds) / (365 days * 10000)
      //          = (1000e6 * 275 * 180 * 86400) / (365 * 86400 * 10000)
      //          = (1000e6 * 275 * 180) / (365 * 10000)
      const principal = 1000n * 10n ** 6n;
      const expectedInterest = (principal * 275n * 180n) / (365n * 10000n);
      const expectedTotal = principal + expectedInterest;

      expect(aliceAfter - aliceBefore).to.equal(expectedTotal);
      expect(vaultBefore - vaultAfter).to.equal(expectedInterest);
    });

    it("should revert if already withdrawn", async () => {
      await expect(
        core.connect(alice).withdrawAtMaturity(0)
      ).to.be.revertedWith("SavingCore: not active");
    });

    it("should revert if caller is not owner of deposit 1", async () => {
      // Deposit 1 was opened in openDeposit tests, not matured yet
      await expect(
        core.connect(bob).withdrawAtMaturity(1)
      ).to.be.revertedWith("SavingCore: not owner");
    });

    it("should revert if not matured", async () => {
      // Open a new deposit (deposit 2) — will mature in 180 days
      await usdc.connect(alice).approve(await core.getAddress(), DEPOSIT_AMOUNT);
      await core.connect(alice).openDeposit(0, DEPOSIT_AMOUNT);

      await expect(
        core.connect(alice).withdrawAtMaturity(2)
      ).to.be.revertedWith("SavingCore: not matured");
    });
  });
});
