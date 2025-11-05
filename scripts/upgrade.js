const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const NewInvoiceProcessor = await hre.ethers.getContractFactory("InvoiceProcessor");
  const proxyAddress = process.env.INVOICE_PROCESSOR_PROXY_ADDRESS;
  await hre.upgrades.upgradeProxy(proxyAddress, NewInvoiceProcessor);
}

main();