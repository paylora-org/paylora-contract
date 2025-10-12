const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const networkName = hre.network.name;
  const rpcUrls = {
    arbSepolia: process.env.ARBITRUM_URL,
    arbitrium: process.env.ARBITRUM_MAINNET_URL,
  };
  const rpcUrl = rpcUrls[networkName];
  const pk = process.env.PRIVATE_KEY;

  if (!rpcUrl) {
    throw new Error(
      `Missing RPC URL for network ${networkName}. Set ARBITRUM_URL or ARBITRUM_MAINNET_URL in .env`
    );
  }
  if (!pk) {
    throw new Error("Missing PRIVATE_KEY in .env");
  }

  // Basic validation that URL likely contains an API key/token (supports Alchemy v2 and Infura v3)
  const parsed = new URL(rpcUrl);
  const hasAuthToken =
    /(v2|v3)\/[A-Za-z0-9_-]{8,}/.test(parsed.pathname) ||
    parsed.search.includes("apikey=") ||
    (!!parsed.username && parsed.username.length > 0) ||
    parsed.hostname.includes("infura.io");
  if (!hasAuthToken) {
    throw new Error(
      `RPC URL for ${networkName} may be missing an API key. Example Alchemy: https://arb-sepolia.g.alchemy.com/v2/YOUR_KEY or Infura: https://arbitrum-sepolia.infura.io/v3/YOUR_PROJECT_ID (got: ${parsed.origin})`
    );
  }

  let deployer;
  try {
    [deployer] = await hre.ethers.getSigners();
    console.log(
      "Account balance:",
      (await hre.ethers.provider.getBalance(deployer.address)).toString()
    );
  } catch (e) {
    if (String(e && e.message).includes("Must be authenticated")) {
      throw new Error(
        `Provider rejected connection: Must be authenticated. Ensure ${
          networkName === "arbSepolia" ? "ARBITRUM_URL" : "ARBITRUM_MAINNET_URL"
        } includes a valid API key and PRIVATE_KEY is set.`
      );
    }
    throw e;
  }
  const INITIAL_FEE_BPS = 50; // 0.5%

  console.log("\nDeploying InvoiceProcessor proxy...");
  const InvoiceProcessor = await hre.ethers.getContractFactory(
    "InvoiceProcessor"
  );
  const contractProxy = await hre.upgrades.deployProxy(
    InvoiceProcessor,
    [deployer.address, INITIAL_FEE_BPS],
    {
      kind: "uups",
      initializer: "initialize",
    }
  );
  await contractProxy.waitForDeployment();
  const contractAddress = await contractProxy.getAddress();
  const implementationAddress = await hre.upgrades.getImplementationAddress(proxyAddress);
  console.log("✅ InvoiceProcessor proxy deployed to:", contractAddress);
  console.log("✅ Implementation Address (Use this for verification):", implementationAddress);

}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
