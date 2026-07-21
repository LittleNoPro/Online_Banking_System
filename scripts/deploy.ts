import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("Deploying with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  const Example = await ethers.getContractFactory("Example");
  const contract = await Example.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("Contract deployed to:", address);
  console.log("Network:", await ethers.provider.getNetwork().then(n => n.name));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
