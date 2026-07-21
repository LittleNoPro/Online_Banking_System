import { expect } from "chai";
import { ethers } from "hardhat";
import { MockUSDC } from "../typechain-types";

describe("MockUSDC", () => {
  let usdc: MockUSDC;
  let owner: any;
  let addr1: any;

  before(async () => {
    [owner, addr1] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("MockUSDC");
    usdc = await factory.deploy();
    await usdc.waitForDeployment();
  });

  it("should have correct name and symbol", async () => {
    expect(await usdc.name()).to.equal("Mock USDC");
    expect(await usdc.symbol()).to.equal("USDC");
  });

  it("should have 6 decimals", async () => {
    expect(await usdc.decimals()).to.equal(6);
  });

  it("should start with 0 total supply", async () => {
    expect(await usdc.totalSupply()).to.equal(0n);
  });

  it("should mint tokens to any address", async () => {
    const amount = ethers.parseUnits("1000", 6);
    await usdc.mint(addr1.address, amount);
    expect(await usdc.balanceOf(addr1.address)).to.equal(amount);
    expect(await usdc.totalSupply()).to.equal(amount);
  });

  it("should mint additional tokens", async () => {
    const amount = ethers.parseUnits("500", 6);
    await usdc.mint(owner.address, amount);
    expect(await usdc.balanceOf(owner.address)).to.equal(amount);
  });
});
