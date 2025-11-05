const { keccak256, toUtf8Bytes } = require("ethers");

const errorsWithMessages = [
  ["InvoiceProcessor__ZeroAddress()", "Invalid zero address provided"],
  ["InvoiceProcessor__InvalidMerchantId()", "Invalid merchant identifier"],
  ["InvoiceProcessor__InvoiceAlreadyProcessed()", "Invoice has already been processed"],
  ["InvoiceProcessor__MerchantNotActive()", "Merchant is not active"],
  ["InvoiceProcessor__MerchantAlreadyExists()", "Merchant already exists"],
  ["InvoiceProcessor__MerchantNotFound()", "Merchant not found"],
  ["InvoiceProcessor__TokenNotWhitelisted()", "This token is not approved for payments"],
  ["InvoiceProcessor__InsufficientAmount()", "Insufficient balance or allowance"],
  ["InvoiceProcessor__TransferFailed()", "Payment transfer failed"],
  ["InvoiceProcessor__InsufficientETH()", "Insufficient ETH balance"],
  ["InvoiceProcessor__FeeTooHigh()", "Fee percentage exceeds maximum allowed"],
  ["InvoiceProcessor__SignerNotSet()", "Signer address not set for merchant"],
  ["InvoiceProcessor__InvalidSignature()", "Invalid payment signature"],
  ["InvoiceProcessor__ECDSAInvalidSignature()", "Invalid ECDSA signature format"]
];

const ERROR_SIGNATURES = {};
const ERROR_MESSAGES = {};

for (const [errorName, message] of errorsWithMessages) {
  const key = errorName.replace("()", "");
  const selector = keccak256(toUtf8Bytes(errorName)).slice(0, 10);
  ERROR_SIGNATURES[key] = selector;
  ERROR_MESSAGES[key] = message;
}

console.log("export const ERROR_SIGNATURES =", JSON.stringify(ERROR_SIGNATURES, null, 2), ";");
console.log("\nexport const ERROR_MESSAGES =", JSON.stringify(ERROR_MESSAGES, null, 2), ";");
