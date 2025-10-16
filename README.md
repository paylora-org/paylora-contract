# Paylora Smart Contract (Upgradeable)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Audit Status](https://img.shields.io/badge/Audit-Pending-orange.svg)]()

This repository contains the source code for `InvoiceProcessor.sol`, the core smart contract for the Paylora payment gateway. This contract is built using the UUPS proxy pattern, allowing for future upgrades without changing the contract address.

## 📖 Overview

**Paylora** is a non-custodial, upgradeable crypto payment gateway designed for low-cost L2 network **Arbitrum**.

The `InvoiceProcessor` contract securely processes payments, calculates a flexible service fee, and instantly transfers funds to the merchant's wallet. The project's goal is to provide a secure, flexible, and developer-friendly solution for businesses to integrate crypto payments.

## ✨ Features

*   **Upgradeable (UUPS):** The contract logic can be updated in the future to fix bugs or add new features without requiring merchants to change their integration.
*   **Pausable:** A critical security feature that allows the owner to temporarily halt all payment functions in case of an emergency.
*   **Flexible Fees:** The service fee is not hardcoded and can be adjusted by the owner via a secure, time-delayed governance process (using a Timelock).
*   **Token Whitelist:** To protect merchants, payments are only allowed in a curated list of approved ERC20 tokens (e.g., USDC, USDT), preventing scam token payments.
*   **Granular Merchant Management:** The owner has dedicated functions to add, remove, and update merchant wallet addresses, providing clear and secure control.
*   **Non-Custodial & Secure:** Funds are never held by the contract. The architecture is protected from re-entrancy attacks using OpenZeppelin's `ReentrancyGuard`.
*   **Sweep Functions:** Admin functions (`sweepETH`, `sweepERC20`) allow the owner to rescue any funds that are accidentally sent directly to the contract's address.

## 🚀 Getting Started

This project uses [Hardhat](https://hardhat.org/) and the [OpenZeppelin Upgrades](https://docs.openzeppelin.com/upgrades-plugins/1.x/) plugin.

### Prerequisites

*   [Node.js](https://nodejs.org/en/) (v18+)
*   [Yarn](https://yarnpkg.com/) or [NPM](https://www.npmjs.com/)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/paylora-project/paylora-contract.git
    cd paylora-contract
    ```
2.  Install dependencies, including OpenZeppelin's contracts and upgrades plugin:
    ```bash
    npm install
    ```

### Configuration

Create a `.env` file in the project root. This file should not be committed to Git.

```env
# RPC URL for Arbitrum Network (e.g., Sepolia Testnet)
ARBITRUM_URL="https://arbitrum-sepolia.infura.io/v3/YOUR_INFURA_KEY"
ARBITRUM_MAINNET_URL="https://arbitrum-mainnet.infura.io/v3/YOUR_INFURA_KEY"

# Private key of the wallet you will use for deployment
PRIVATE_KEY="0x..."

# API key for contract verification on Arbiscan
ETHERSCAN_API_KEY="YOUR_ARBISCAN_API_KEY"
```

### Testing
To run the full test suite, execute the following command:

```bash
npx run test
```


### Deployment
The contract is deployed as a UUPS proxy. The script `scripts/deploy.js` handles the deployment of the proxy and its initial logic.

```bash
# Example for Arbitrum Sepolia
npm run deploy:arb
# Example for Arbitrum Mainnet
npm run deploy:arb-mainnet
```
The script will output two addresses: the Proxy Address (which you use in your app) and the Implementation Address (which you use for verification).

### Verifying the Contract
Verification for a proxy is a two-step process:

1.  **Verify the Implementation:** Run the Hardhat verify task with the Implementation Address.
    ```bash
    npx hardhat verify --network arbSepolia <IMPLEMENTATION_ADDRESS>
    npx hardhat verify --network arbitrum <IMPLEMENTATION_ADDRESS>
    ```
2.  **Link the Proxy:** Go to the Proxy Address on the block explorer (e.g., Arbiscan). Navigate to the "Contract" tab and use the UI to mark it as a Proxy, linking it to the verified Implementation Address.

## ⚙️ Core Contract Functions
### For Users (Payers)
*   `payInvoiceETH(bytes32 invoiceId, bytes32 merchantId, uint256 amount, bytes calldata signature)`: Pays an invoice using the network's native currency (ETH).
*   `payInvoiceERC20(bytes32 invoiceId, bytes32 merchantId, uint256 amount, address token, bytes calldata signature)`: Pays an invoice using a whitelisted ERC20 token.

### For the Contract Owner
These functions can only be called by the owner (which should be a Timelock contract for production).

*   `pause() / unpause()`: Pauses or unpauses all payment functions.
*   `setFee(uint256 newFeeBps)`: Updates the platform's service fee.
*   `addMerchant(bytes32 merchantId, address walletAddress, address signerAddress)`: Adds a new merchant and activates them.
*   `removeMerchant(bytes32 merchantId)`: Deletes a merchant from the system.
*   `updateMerchantWallet(bytes32 merchantId, address newWalletAddress)`: Updates the receiving wallet for a merchant.
*   `setTokenWhitelist(address token, bool isWhitelisted)`: Adds or removes an ERC20 token from the payment whitelist.
*   `sweepETH() / sweepERC20(address token)`: Rescues funds accidentally sent to the contract address.

## 🛡️ Security
*   **Upgradeable (UUPS):** Allows for secure bug fixes and feature additions. For production, the owner should be a TimelockController to provide a time delay for all upgrades.
*   **Pausable:** Provides an emergency stop mechanism.
*   **Built with OpenZeppelin:** Relies on heavily audited and battle-tested contracts for Ownable, Pausable, ReentrancyGuard, and UUPS.
*   **Audit:** We are applying for a grant from the Arbitrum Audit Program to conduct an independent security audit.

## 🤝 Contributing
We welcome contributions of all kinds. Please open an Issue for bug reports or a Pull Request for suggestions.

## 📜 License
This project is licensed under the MIT License. See the LICENSE file for details.