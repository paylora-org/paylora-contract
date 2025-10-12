// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";


/// @title Paylora InvoiceProcessor (Upgradeable)
/// @notice An upgradeable, pausable contract to process payments for multiple merchants.
contract InvoiceProcessor is 
    Initializable, 
    OwnableUpgradeable, 
    ReentrancyGuardUpgradeable, 
    PausableUpgradeable, 
    UUPSUpgradeable 
{
   using SafeERC20 for IERC20;

    // --- Constants ---
    uint256 public constant MAX_BPS = 10_000;

    // --- State ---
    uint256 public platformFeeBps;
    mapping(bytes32 => address) public merchants;
    mapping(bytes32 => bool) private processedInvoice;
    mapping(address => bool) public whitelistedTokens;

    event InvoicePaid(bytes32 indexed invoiceId, bytes32 indexed merchantId, address indexed client, uint256 amount, uint256 feeAmount, address token);
    event MerchantAdded(bytes32 indexed merchantId, address walletAddress);
    event MerchantRemoved(bytes32 indexed merchantId);
    event MerchantWalletUpdated(bytes32 indexed merchantId, address newWalletAddress);
    event TokenWhitelistUpdated(address indexed token, bool isWhitelisted);
    event FeeUpdated(uint256 newFeeBps);
    error InvoiceProcessor__ZeroAddress();
    error InvoiceProcessor__InvalidMerchantId();
    error InvoiceProcessor__InvoiceAlreadyProcessed();
    error InvoiceProcessor__MerchantNotActive();
    error InvoiceProcessor__MerchantAlreadyExists();
    error InvoiceProcessor__MerchantNotFound();
    error InvoiceProcessor__TokenNotWhitelisted();
    error InvoiceProcessor__InsufficientAmount();
    error InvoiceProcessor__TransferFailed();
    error InvoiceProcessor__InsufficientETH();
    error InvoiceProcessor__FeeTooHigh();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, uint256 _initialFeeBps) public initializer {
        __Ownable_init(initialOwner);
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        
        if (_initialFeeBps > 1000) revert InvoiceProcessor__FeeTooHigh();
        platformFeeBps = _initialFeeBps;
        emit FeeUpdated(_initialFeeBps);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    modifier onlyActiveMerchant(bytes32 merchantId) {
        if (merchants[merchantId] == address(0)) revert InvoiceProcessor__MerchantNotActive();
        _;
    }

    function payInvoiceETH(bytes32 invoiceId, bytes32 merchantId, uint256 amount)
        external payable whenNotPaused nonReentrant onlyActiveMerchant(merchantId) {
        _processPayment(invoiceId, merchantId, amount, address(0));
    }

    function payInvoiceERC20(bytes32 invoiceId, bytes32 merchantId, uint256 amount, address token)
        external whenNotPaused nonReentrant onlyActiveMerchant(merchantId) {
        if (!whitelistedTokens[token]) revert InvoiceProcessor__TokenNotWhitelisted();
        _processPayment(invoiceId, merchantId, amount, token);
    }

    function _processPayment(bytes32 invoiceId, bytes32 merchantId, uint256 amount, address token) internal {
        if (processedInvoice[invoiceId]) revert InvoiceProcessor__InvoiceAlreadyProcessed();
        processedInvoice[invoiceId] = true;
        address client = msg.sender;
        address merchantWallet = merchants[merchantId];
        uint256 feeAmount = (amount * platformFeeBps) / MAX_BPS;
        uint256 merchantAmount = amount - feeAmount;

        if (token == address(0)) {
            _payETH(merchantWallet, merchantAmount, feeAmount, amount);
        } else {
            _payERC20(token, client, merchantWallet, merchantAmount, feeAmount, amount);
        }
        emit InvoicePaid(invoiceId, merchantId, client, amount, feeAmount, token);
    }

    function _payETH(address merchantWallet, uint256 merchantAmount, uint256 feeAmount, uint256 requiredAmount) internal {
        if (msg.value < requiredAmount) revert InvoiceProcessor__InsufficientETH();
        (bool success, ) = merchantWallet.call{value: merchantAmount}("");
        if (!success) revert InvoiceProcessor__TransferFailed();
        if (feeAmount > 0) {
            (success, ) = owner().call{value: feeAmount}("");
            if (!success) revert InvoiceProcessor__TransferFailed();
        }
    }

    function _payERC20(address token, address client, address merchantWallet, uint256 merchantAmount, uint256 feeAmount, uint256 requiredAmount) internal {
        IERC20 erc20 = IERC20(token);
        if (erc20.allowance(client, address(this)) < requiredAmount) revert InvoiceProcessor__InsufficientAmount();
        erc20.safeTransferFrom(client, merchantWallet, merchantAmount);
        if (feeAmount > 0) {
            erc20.safeTransferFrom(client, owner(), feeAmount);
        }
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setFee(uint256 _newFeeBps) public onlyOwner {
        if (_newFeeBps > 1000) revert InvoiceProcessor__FeeTooHigh();
        platformFeeBps = _newFeeBps;
        emit FeeUpdated(_newFeeBps);
    }
    
    function addMerchant(bytes32 merchantId, address walletAddress) external onlyOwner {
        if (merchants[merchantId] != address(0)) revert InvoiceProcessor__MerchantAlreadyExists();
        if (walletAddress == address(0)) revert InvoiceProcessor__ZeroAddress();
        merchants[merchantId] = walletAddress;
        emit MerchantAdded(merchantId, walletAddress);
    }

    function removeMerchant(bytes32 merchantId) external onlyOwner {
        if (merchants[merchantId] == address(0)) revert InvoiceProcessor__MerchantNotFound();
        delete merchants[merchantId];
        emit MerchantRemoved(merchantId);
    }

    function updateMerchantWallet(bytes32 merchantId, address newWalletAddress) external onlyOwner {
        if (merchants[merchantId] == address(0)) revert InvoiceProcessor__MerchantNotFound();
        if (newWalletAddress == address(0)) revert InvoiceProcessor__ZeroAddress();
        merchants[merchantId] = newWalletAddress;
        emit MerchantWalletUpdated(merchantId, newWalletAddress);
    }
    
    function setTokenWhitelist(address token, bool isWhitelisted) external onlyOwner {
        if (token == address(0)) revert InvoiceProcessor__ZeroAddress();
        whitelistedTokens[token] = isWhitelisted;
        emit TokenWhitelistUpdated(token, isWhitelisted);
    }
    
    function sweepETH() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = owner().call{value: balance}("");
            if (!success) revert InvoiceProcessor__TransferFailed();
        }
    }

    function sweepERC20(address token) external onlyOwner {
        if (token == address(0)) revert InvoiceProcessor__ZeroAddress();
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).safeTransfer(owner(), balance);
        }
    }

    receive() external payable {}
}
