const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("InvoiceProcessor (Upgradeable)", function () {
  let owner, merchant, client, other;
  let contract, token, merchantId;
  const INITIAL_FEE_BPS = 50n;
  const MAX_BPS = 10000n;

  const calcAmounts = (amount) => {
    const fee = (amount * INITIAL_FEE_BPS) / MAX_BPS;
    return { fee, merchantAmount: amount - fee };
  };

  beforeEach(async function () {
    [owner, merchant, client, other] = await ethers.getSigners();

    const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
    token = await ERC20Mock.deploy(
      "MockUSDC",
      "mUSDC",
      client.address,
      ethers.parseEther("1000")
    );
    await token.waitForDeployment();

    const InvoiceProcessor = await ethers.getContractFactory(
      "InvoiceProcessor"
    );
    contract = await upgrades.deployProxy(
      InvoiceProcessor,
      [owner.address, INITIAL_FEE_BPS],
      {
        kind: "uups",
        initializer: "initialize",
      }
    );
    await contract.waitForDeployment();

    merchantId = ethers.keccak256(ethers.toUtf8Bytes("merchant-1"));
    await contract.connect(owner).addMerchant(merchantId, merchant.address);
    // ✅ FIX: Use await getAddress() for the token
    await contract
      .connect(owner)
      .setTokenWhitelist(await token.getAddress(), true);
  });

  // ─────────────────────────────
  describe("Deployment & Initialization", function () {
    it("should set the correct owner and initial fee", async () => {
      expect(await contract.owner()).to.equal(owner.address);
      expect(await contract.platformFeeBps()).to.equal(INITIAL_FEE_BPS);
    });

    it("should prevent initializing a second time", async () => {
      await expect(
        contract.initialize(owner.address, 100)
      ).to.be.revertedWithCustomError(contract, "InvalidInitialization");
    });
  });

  // ─────────────────────────────
  describe("ETH Payments", function () {
    it("should process a valid ETH invoice and check for duplication", async () => {
      const invoiceId = ethers.keccak256(ethers.toUtf8Bytes("ETH1"));
      const amount = ethers.parseEther("1.0");
      const { fee, merchantAmount } = calcAmounts(amount);

      await expect(() =>
        contract
          .connect(client)
          .payInvoiceETH(invoiceId, merchantId, amount, { value: amount })
      ).to.changeEtherBalances([merchant, owner], [merchantAmount, fee]);

      await expect(
        contract
          .connect(client)
          .payInvoiceETH(invoiceId, merchantId, amount, { value: amount })
      ).to.be.revertedWithCustomError(
        contract,
        "InvoiceProcessor__InvoiceAlreadyProcessed"
      );
    });

    it("should revert if insufficient ETH is sent", async () => {
      const invoiceId = ethers.keccak256(ethers.toUtf8Bytes("ETH_LOW"));
      const amount = ethers.parseEther("1.0");
      await expect(
        contract.connect(client).payInvoiceETH(invoiceId, merchantId, amount, {
          value: ethers.parseEther("0.9"),
        })
      ).to.be.revertedWithCustomError(
        contract,
        "InvoiceProcessor__InsufficientETH"
      );
    });

    it("should revert if paying to a non-active merchant", async () => {
      const badId = ethers.keccak256(ethers.toUtf8Bytes("no-merchant"));
      const invoiceId = ethers.keccak256(ethers.toUtf8Bytes("ETH_BAD"));
      const amount = ethers.parseEther("1.0");
      await expect(
        contract
          .connect(client)
          .payInvoiceETH(invoiceId, badId, amount, { value: amount })
      ).to.be.revertedWithCustomError(
        contract,
        "InvoiceProcessor__MerchantNotActive"
      );
    });

    // NEW: Edge case for zero amount invoices
    it("should correctly process a zero-amount ETH invoice", async () => {
      const invoiceId = ethers.keccak256(ethers.toUtf8Bytes("ETH_ZERO"));
      await expect(() =>
        contract
          .connect(client)
          .payInvoiceETH(invoiceId, merchantId, 0, { value: 0 })
      ).to.changeEtherBalances([merchant, owner], [0, 0]);
    });
  });

  // ─────────────────────────────
  describe("ERC20 Payments", function () {
    it("should process a valid ERC20 invoice", async () => {
      const invoiceId = ethers.keccak256(ethers.toUtf8Bytes("ERC20-1"));
      const amount = ethers.parseEther("100");
      const { fee, merchantAmount } = calcAmounts(amount);
      const contractAddress = await contract.getAddress();
      const tokenAddress = await token.getAddress();

      await token.connect(client).approve(contractAddress, amount);

      await expect(() =>
        contract
          .connect(client)
          .payInvoiceERC20(invoiceId, merchantId, amount, tokenAddress)
      ).to.changeTokenBalances(
        token,
        [client, merchant, owner],
        [-amount, merchantAmount, fee]
      );
    });

    it("should revert if token not whitelisted", async () => {
      const badToken = await (
        await ethers.getContractFactory("ERC20Mock")
      ).deploy("BAD", "BAD", client.address, ethers.parseEther("100"));
      await badToken.waitForDeployment();
      const invoiceId = ethers.keccak256(ethers.toUtf8Bytes("BAD-TOK"));
      const amount = ethers.parseEther("100");
      const contractAddress = await contract.getAddress(); // ✅ FIX: Resolve address first
      const badTokenAddress = await badToken.getAddress(); // ✅ FIX: Resolve address first

      await badToken.connect(client).approve(contractAddress, amount);
      await expect(
        contract
          .connect(client)
          .payInvoiceERC20(invoiceId, merchantId, amount, badTokenAddress)
      ).to.be.revertedWithCustomError(
        contract,
        "InvoiceProcessor__TokenNotWhitelisted"
      );
    });

    it("should revert if allowance is too low", async () => {
      const invoiceId = ethers.keccak256(ethers.toUtf8Bytes("LOW-ALLOW"));
      const amount = ethers.parseEther("100");
      const contractAddress = await contract.getAddress();
      const tokenAddress = await token.getAddress();

      await token
        .connect(client)
        .approve(contractAddress, ethers.parseEther("50"));
      await expect(
        contract
          .connect(client)
          .payInvoiceERC20(invoiceId, merchantId, amount, tokenAddress)
      ).to.be.revertedWithCustomError(
        contract,
        "InvoiceProcessor__InsufficientAmount"
      );
    });
  });

  // ─────────────────────────────
  describe("Admin Functions", function () {
    // IMPROVED: More granular tests for merchant management
    describe("Merchant Management", function () {
      it("should allow owner to add, update, and remove merchants", async () => {
        const newId = ethers.keccak256(ethers.toUtf8Bytes("merchant2"));
        await expect(contract.connect(owner).addMerchant(newId, other.address))
          .to.emit(contract, "MerchantAdded")
          .withArgs(newId, other.address);

        await expect(
          contract.connect(owner).updateMerchantWallet(newId, merchant.address)
        )
          .to.emit(contract, "MerchantWalletUpdated")
          .withArgs(newId, merchant.address);

        await expect(contract.connect(owner).removeMerchant(newId))
          .to.emit(contract, "MerchantRemoved")
          .withArgs(newId);
      });

      it("should prevent non-owners from managing merchants", async () => {
        const newId = ethers.keccak256(ethers.toUtf8Bytes("merchant2"));
        await expect(
          contract.connect(client).addMerchant(newId, other.address)
        ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
      });

      // NEW: Negative path tests
      it("should revert when adding an existing merchant", async () => {
        await expect(
          contract.connect(owner).addMerchant(merchantId, other.address)
        ).to.be.revertedWithCustomError(
          contract,
          "InvoiceProcessor__MerchantAlreadyExists"
        );
      });

      it("should revert when updating a non-existent merchant", async () => {
        const badId = ethers.keccak256(ethers.toUtf8Bytes("no-merchant"));
        await expect(
          contract.connect(owner).updateMerchantWallet(badId, other.address)
        ).to.be.revertedWithCustomError(
          contract,
          "InvoiceProcessor__MerchantNotFound"
        );
      });
    });

    describe("Fee Management", function () {
      it("should allow owner to update fee", async () => {
        await expect(contract.connect(owner).setFee(200))
          .to.emit(contract, "FeeUpdated")
          .withArgs(200);
        expect(await contract.platformFeeBps()).to.equal(200);
      });

      it("should revert if fee is set too high", async () => {
        await expect(
          contract.connect(owner).setFee(2000)
        ).to.be.revertedWithCustomError(
          contract,
          "InvoiceProcessor__FeeTooHigh"
        );
      });
    });

    describe("Pausable", function () {
      it("should allow owner to pause and unpause", async () => {
        await contract.connect(owner).pause();
        expect(await contract.paused()).to.be.true;
        await contract.connect(owner).unpause();
        expect(await contract.paused()).to.be.false;
      });

      it("should revert payments when paused", async () => {
        const invoiceId = ethers.keccak256(ethers.toUtf8Bytes("PAUSE-TEST"));
        const amount = ethers.parseEther("1.0");
        await contract.connect(owner).pause();
        await expect(
          contract
            .connect(client)
            .payInvoiceETH(invoiceId, merchantId, amount, {
              value: amount,
            })
        ).to.be.revertedWithCustomError(contract, "EnforcedPause");
      });
    });
  });

  // ─────────────────────────────
  describe("Sweeping", function () {
    it("owner can sweep ETH", async () => {
      await owner.sendTransaction({
        to: await contract.getAddress(),
        value: ethers.parseEther("1.5"),
      });
      await expect(() =>
        contract.connect(owner).sweepETH()
      ).to.changeEtherBalances(
        [contract, owner],
        [-ethers.parseEther("1.5"), ethers.parseEther("1.5")]
      );
    });

    it("owner can sweep ERC20", async () => {
      const amount = ethers.parseEther("100");
      await token.connect(client).transfer(await contract.getAddress(), amount);
      await expect(async () =>
        contract.connect(owner).sweepERC20(await token.getAddress())
      ).to.changeTokenBalances(token, [contract, owner], [-amount, amount]);
    });
  });

  // ─────────────────────────────
  describe("Upgradeable", function () {
    it("allows the owner to upgrade the contract", async () => {
      const InvoiceProcessorV2 = await ethers.getContractFactory(
        "InvoiceProcessor"
      ); // Using same for test
      const upgradedContract = await upgrades.upgradeProxy(
        await contract.getAddress(),
        InvoiceProcessorV2
      );
      expect(await upgradedContract.getAddress()).to.equal(
        await contract.getAddress()
      );
    });

    it("reverts an upgrade attempt from a non-owner", async () => {
      const InvoiceProcessorV2 = await ethers.getContractFactory(
        "InvoiceProcessor"
      );
      await expect(
        upgrades.upgradeProxy(
          await contract.getAddress(),
          InvoiceProcessorV2.connect(client)
        )
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });
});
