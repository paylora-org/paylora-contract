const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("InvoiceProcessor (Upgradeable)", function () {
  let owner, merchant, client, signer, other;
  let contract, token, merchantId;
  const INITIAL_FEE_BPS = 50n; // 0.5%
  const MAX_BPS = 10000n;

  const createPaymentSignature = async (
    invoiceId,
    amount,
    tokenAddress,
    merchantId
  ) => {
    const contractAddress = await contract.getAddress();
    const { chainId } = await ethers.provider.getNetwork();
    const messageHash = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes32", "uint256", "address", "bytes32", "address", "uint256"],
        [invoiceId, amount, tokenAddress, merchantId, contractAddress, chainId]
      )
    );

    const signature = await signer.signMessage(ethers.getBytes(messageHash));
    return signature;
  };

  const calcAmounts = (amount) => {
    const fee = (amount * INITIAL_FEE_BPS) / MAX_BPS;
    return { fee, merchantAmount: amount - fee };
  };

  beforeEach(async function () {
    [owner, merchant, client, signer, other] = await ethers.getSigners();

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

    merchantId = ethers.id("merchant-1");
    await contract
      .connect(owner)
      .addMerchant(merchantId, merchant.address, signer.address);

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
  describe("Signature Validation", function () {
    it("should revert a payment with an invalid signature", async () => {
      const invoiceId = ethers.id("ETH_BAD_SIG");
      const amount = ethers.parseEther("1.0");

      const messageHash = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "uint256", "address", "bytes32", "address", "uint256"],
          [
            invoiceId,
            amount,
            ethers.ZeroAddress,
            merchantId,
            await contract.getAddress(),
            (await ethers.provider.getNetwork()).chainId,
          ]
        )
      );

      const badSignature = await other.signMessage(
        ethers.getBytes(messageHash)
      );

      await expect(
        contract
          .connect(client)
          .payInvoiceETH(invoiceId, merchantId, amount, badSignature, {
            value: amount,
          })
      ).to.be.revertedWith("Invalid signature");
    });
  });

  // ─────────────────────────────
  describe("ETH Payments", function () {
    it("should process a valid ETH invoice and revert on duplication", async () => {
      const invoiceId = ethers.id("ETH1");
      const amount = ethers.parseEther("1.0");
      const { fee, merchantAmount } = calcAmounts(amount);
      const signature = await createPaymentSignature(
        invoiceId,
        amount,
        ethers.ZeroAddress,
        merchantId
      );

      await expect(() =>
        contract
          .connect(client)
          .payInvoiceETH(invoiceId, merchantId, amount, signature, {
            value: amount,
          })
      ).to.changeEtherBalances([merchant, owner], [merchantAmount, fee]);

      await expect(
        contract
          .connect(client)
          .payInvoiceETH(invoiceId, merchantId, amount, signature, {
            value: amount,
          })
      ).to.be.revertedWithCustomError(
        contract,
        "InvoiceProcessor__InvoiceAlreadyProcessed"
      );
    });

    it("should revert if insufficient ETH is sent", async () => {
      const invoiceId = ethers.id("ETH_LOW");
      const amount = ethers.parseEther("1.0");
      const signature = await createPaymentSignature(
        invoiceId,
        amount,
        ethers.ZeroAddress,
        merchantId
      );

      await expect(
        contract
          .connect(client)
          .payInvoiceETH(invoiceId, merchantId, amount, signature, {
            value: ethers.parseEther("0.9"),
          })
      ).to.be.revertedWithCustomError(
        contract,
        "InvoiceProcessor__InsufficientETH"
      );
    });

    it("should correctly process a zero-amount ETH invoice", async () => {
      const invoiceId = ethers.id("ETH_ZERO");
      const amount = 0n;
      const signature = await createPaymentSignature(
        invoiceId,
        amount,
        ethers.ZeroAddress,
        merchantId
      );

      await expect(() =>
        contract
          .connect(client)
          .payInvoiceETH(invoiceId, merchantId, amount, signature, { value: 0 })
      ).to.changeEtherBalances([merchant, owner], [0, 0]);
    });

    it("should emit an InvoicePaid event on ETH payment", async function () {
      const invoiceId = ethers.id("EVENT-TEST-1");
      const amount = ethers.parseEther("0.1");
      const { fee } = calcAmounts(amount);
      const signature = await createPaymentSignature(
        invoiceId,
        amount,
        ethers.ZeroAddress,
        merchantId
      );

      await expect(
        contract
          .connect(client)
          .payInvoiceETH(invoiceId, merchantId, amount, signature, {
            value: amount,
          })
      )
        .to.emit(contract, "InvoicePaid")
        .withArgs(
          invoiceId,
          merchantId,
          client.address,
          amount,
          fee,
          ethers.ZeroAddress
        );
    });
  });

  // ─────────────────────────────
  describe("ERC20 Payments", function () {
    it("should process a valid ERC20 invoice", async () => {
      const invoiceId = ethers.id("ERC20-1");
      const amount = ethers.parseEther("100");
      const { fee, merchantAmount } = calcAmounts(amount);
      const tokenAddress = await token.getAddress();
      const signature = await createPaymentSignature(
        invoiceId,
        amount,
        tokenAddress,
        merchantId
      );

      await token.connect(client).approve(await contract.getAddress(), amount);

      await expect(() =>
        contract
          .connect(client)
          .payInvoiceERC20(
            invoiceId,
            merchantId,
            amount,
            tokenAddress,
            signature
          )
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
      const invoiceId = ethers.id("BAD-TOK");
      const amount = ethers.parseEther("100");
      const badTokenAddress = await badToken.getAddress();
      const signature = await createPaymentSignature(
        invoiceId,
        amount,
        badTokenAddress,
        merchantId
      );

      await badToken
        .connect(client)
        .approve(await contract.getAddress(), amount);

      await expect(
        contract
          .connect(client)
          .payInvoiceERC20(
            invoiceId,
            merchantId,
            amount,
            badTokenAddress,
            signature
          )
      ).to.be.revertedWithCustomError(
        contract,
        "InvoiceProcessor__TokenNotWhitelisted"
      );
    });

    it("should revert if allowance is too low", async () => {
      const invoiceId = ethers.id("LOW-ALLOW");
      const amount = ethers.parseEther("100");
      const tokenAddress = await token.getAddress();
      const signature = await createPaymentSignature(
        invoiceId,
        amount,
        tokenAddress,
        merchantId
      );

      await token
        .connect(client)
        .approve(await contract.getAddress(), ethers.parseEther("50"));

      await expect(
        contract
          .connect(client)
          .payInvoiceERC20(
            invoiceId,
            merchantId,
            amount,
            tokenAddress,
            signature
          )
      ).to.be.revertedWithCustomError(
        contract,
        "InvoiceProcessor__InsufficientAmount"
      );
    });
  });

  // ─────────────────────────────
  describe("Admin Functions", function () {
    describe("Merchant Management", function () {
      it("should allow owner to add, update, and remove merchants", async () => {
        const newId = ethers.id("merchant2");
        await expect(
          contract
            .connect(owner)
            .addMerchant(newId, other.address, signer.address)
        )
          .to.emit(contract, "MerchantAdded")
          .withArgs(newId, other.address, signer.address);

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
        const newId = ethers.id("merchant2");
        await expect(
          contract
            .connect(client)
            .addMerchant(newId, other.address, signer.address)
        ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
      });

      it("should revert when adding an existing merchant", async () => {
        await expect(
          contract
            .connect(owner)
            .addMerchant(merchantId, other.address, signer.address)
        ).to.be.revertedWithCustomError(
          contract,
          "InvoiceProcessor__MerchantAlreadyExists"
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
        const invoiceId = ethers.id("PAUSE-TEST");
        const amount = ethers.parseEther("1.0");
        const signature = await createPaymentSignature(
          invoiceId,
          amount,
          ethers.ZeroAddress,
          merchantId
        );

        await contract.connect(owner).pause();

        await expect(
          contract
            .connect(client)
            .payInvoiceETH(invoiceId, merchantId, amount, signature, {
              value: amount,
            })
        ).to.be.revertedWithCustomError(contract, "EnforcedPause");
      });
    });
  });

  // ─────────────────────────────
  describe("Sweeping & Upgrades", function () {
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

    it("allows the owner to upgrade the contract", async () => {
      const InvoiceProcessorV2 = await ethers.getContractFactory(
        "InvoiceProcessor"
      );
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
