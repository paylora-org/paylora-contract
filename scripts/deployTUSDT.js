const hre = require("hardhat");
const { ethers } = hre;
require("dotenv").config();

async function main() {

  const recipientAddress = process.env.WALLET_ADDRESS; 

  const initialSupply = ethers.parseEther("1000000");

  const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
  
  console.log("Deploying TUSDT (ERC20Mock) contract...");
  
  const token = await ERC20Mock.deploy(
    "Test USD Token", 
    "TUSDT", 
    recipientAddress, 
    initialSupply
  );

  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  console.log(`✅ TUSDT successfully deployed to: ${tokenAddress}`);
  console.log(`${ethers.formatEther(initialSupply)} TUSDT minted to ${recipientAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});