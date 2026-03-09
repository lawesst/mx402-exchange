import { readFile } from "node:fs/promises";

import {
  Account,
  Address,
  AddressComputer,
  AddressType,
  AddressValue,
  ArgSerializer,
  BigUIntType,
  BigUIntValue,
  BinaryCodec,
  BooleanType,
  BytesType,
  BytesValue,
  Field,
  FieldDefinition,
  List,
  ListType,
  ProxyNetworkProvider,
  SmartContractQuery,
  SmartContractTransactionsFactory,
  SmartContractTransactionsOutcomeParser,
  Struct,
  StructType,
  TokenIdentifierValue,
  Transaction,
  TransactionOnNetwork,
  U16Type,
  U16Value,
  UserSecretKey
} from "@multiversx/sdk-core";

import { buildChainReadHeaders, loadChainReadRuntimeConfig, loadSharedRuntimeConfig } from "@mx402/config";

export type SignerSession = {
  account: Account;
  provider: ProxyNetworkProvider;
  nextNonce: bigint;
  networkChainId: string;
  networkMinGasPrice: bigint;
  networkMinGasLimit: bigint;
  networkGasPerDataByte: bigint;
};

export type SettlementBuyerDebit = {
  buyerWalletAddress: string;
  amountAtomic: string;
};

export type SettlementProviderCredit = {
  providerId: string;
  amountAtomic: string;
};

export type ObservedTransaction = {
  txHash: string;
  status: string;
  timestamp: number;
  nonce: string;
  blockNonce: string;
  sender: string;
  receiver: string;
  raw: {
    hash: string;
    status: string;
    timestamp: number;
    nonce: string;
    blockNonce: string;
    round: string;
    epoch: number;
    sender: string;
    receiver: string;
    gasLimit: string;
    gasPrice: string;
    function: string;
    data: string;
    miniblockHash: string;
    blockHash: string;
  };
};

export type DeployLedgerInput = {
  wasmPath: string;
  supportedTokenIdentifier: string;
  feeBps: number;
  operatorAddress: string;
  treasuryAddress: string;
  gasLimit?: bigint;
};

export type DeployLedgerResult = {
  txHash: string;
  contractAddress: string;
};

const buyerDebitType = new StructType("BuyerDebit", [
  new FieldDefinition("buyer", "", new AddressType()),
  new FieldDefinition("amount", "", new BigUIntType())
]);

const providerCreditType = new StructType("ProviderCredit", [
  new FieldDefinition("provider_id", "", new BytesType()),
  new FieldDefinition("amount", "", new BigUIntType())
]);

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildProvider() {
  const { gatewayUrl } = loadChainReadRuntimeConfig();

  return new ProxyNetworkProvider(gatewayUrl, {
    headers: buildChainReadHeaders()
  });
}

function requireAddress(value: string, label: string) {
  try {
    return Address.newFromBech32(value);
  } catch (error) {
    throw new Error(`Invalid ${label}: ${value}. ${error instanceof Error ? error.message : "Address parse failed"}`);
  }
}

function buildFactory(session: SignerSession) {
  return new SmartContractTransactionsFactory({
    config: {
      chainID: session.networkChainId,
      addressHrp: "erd",
      minGasLimit: session.networkMinGasLimit,
      gasLimitPerByte: session.networkGasPerDataByte,
      gasLimitClaimDeveloperRewards: 50_000_000n,
      gasLimitChangeOwnerAddress: 50_000_000n
    }
  });
}

function buildBuyerDebitValue(input: SettlementBuyerDebit) {
  return new Struct(buyerDebitType, [
    new Field(new AddressValue(requireAddress(input.buyerWalletAddress, "buyer wallet address")), "buyer"),
    new Field(new BigUIntValue(BigInt(input.amountAtomic)), "amount")
  ]);
}

function buildProviderCreditValue(input: SettlementProviderCredit) {
  return new Struct(providerCreditType, [
    new Field(new BytesValue(Buffer.from(input.providerId, "utf8")), "provider_id"),
    new Field(new BigUIntValue(BigInt(input.amountAtomic)), "amount")
  ]);
}

function computeSettlementGasLimit(buyerLineCount: number, providerLineCount: number) {
  const totalLines = buyerLineCount + providerLineCount;
  return 60_000_000n + BigInt(totalLines) * 12_000_000n;
}

function normalizeStatus(status: string) {
  return status.trim().toLowerCase();
}

function isPendingStatus(status: string) {
  const normalized = normalizeStatus(status);
  return normalized === "pending" || normalized === "received" || normalized === "queued";
}

export function isSuccessfulStatus(status: string) {
  const normalized = normalizeStatus(status);
  return normalized === "success" || normalized === "executed";
}

export function isFailureStatus(status: string) {
  const normalized = normalizeStatus(status);
  return !isPendingStatus(normalized) && !isSuccessfulStatus(normalized);
}

function serializeTransactionOnNetwork(transaction: TransactionOnNetwork): ObservedTransaction {
  return {
    txHash: transaction.hash,
    status: transaction.status.toString(),
    timestamp: transaction.timestamp,
    nonce: transaction.nonce.toString(),
    blockNonce: transaction.round.toString(),
    sender: transaction.sender.toBech32(),
    receiver: transaction.receiver.toBech32(),
    raw: {
      hash: transaction.hash,
      status: transaction.status.toString(),
      timestamp: transaction.timestamp,
      nonce: transaction.nonce.toString(),
      blockNonce: transaction.round.toString(),
      round: transaction.round.toString(),
      epoch: transaction.epoch,
      sender: transaction.sender.toBech32(),
      receiver: transaction.receiver.toBech32(),
      gasLimit: transaction.gasLimit.toString(),
      gasPrice: transaction.gasPrice.toString(),
      function: transaction.function,
      data: transaction.data.toString("utf8"),
      miniblockHash: transaction.miniblockHash,
      blockHash: transaction.blockHash
    }
  };
}

async function signAndSendTransaction(session: SignerSession, transaction: Transaction) {
  transaction.nonce = session.nextNonce;
  transaction.gasPrice = session.networkMinGasPrice;
  transaction.signature = await session.account.signTransaction(transaction);
  const txHash = await session.provider.sendTransaction(transaction);
  session.nextNonce += 1n;
  return txHash;
}

function getSingleReturnDataBuffer(queryResponse: Awaited<ReturnType<ProxyNetworkProvider["queryContract"]>>) {
  if (queryResponse.returnCode !== "ok") {
    throw new Error(queryResponse.returnMessage || `Contract query failed with return code ${queryResponse.returnCode}`);
  }

  return queryResponse.returnDataParts[0] ? Buffer.from(queryResponse.returnDataParts[0]) : Buffer.alloc(0);
}

function getTokenIdentifierTypedValue(identifier: string) {
  return identifier === "EGLD"
    ? TokenIdentifierValue.egld()
    : TokenIdentifierValue.esdtTokenIdentifier(identifier);
}

export async function createSignerSession(secretKeyHex: string): Promise<SignerSession> {
  const provider = buildProvider();
  const secretKey = UserSecretKey.fromString(secretKeyHex);
  const account = new Account(secretKey);
  const [networkConfig, accountOnNetwork] = await Promise.all([
    provider.getNetworkConfig(),
    provider.getAccount(account.address)
  ]);

  return {
    account,
    provider,
    nextNonce: accountOnNetwork.nonce,
    networkChainId: networkConfig.chainID,
    networkMinGasPrice: networkConfig.minGasPrice,
    networkMinGasLimit: networkConfig.minGasLimit,
    networkGasPerDataByte: networkConfig.gasPerDataByte
  };
}

export function getSignerAddressBech32(session: SignerSession) {
  return session.account.address.toBech32();
}

export async function contractHasProvider(input: {
  contractAddress: string;
  providerId: string;
}) {
  const provider = buildProvider();
  const serializer = new ArgSerializer();
  const response = await provider.queryContract(
    new SmartContractQuery({
      contract: requireAddress(input.contractAddress, "ledger contract address"),
      function: "hasProvider",
      arguments: serializer.valuesToBuffers([new BytesValue(Buffer.from(input.providerId, "utf8"))])
    })
  );

  const codec = new BinaryCodec();
  return codec.decodeTopLevel(getSingleReturnDataBuffer(response), new BooleanType()).valueOf() as boolean;
}

export async function getContractProviderPayoutAddress(input: {
  contractAddress: string;
  providerId: string;
}) {
  const provider = buildProvider();
  const serializer = new ArgSerializer();
  const response = await provider.queryContract(
    new SmartContractQuery({
      contract: requireAddress(input.contractAddress, "ledger contract address"),
      function: "getProviderPayoutAddress",
      arguments: serializer.valuesToBuffers([new BytesValue(Buffer.from(input.providerId, "utf8"))])
    })
  );

  const codec = new BinaryCodec();
  const decoded = codec.decodeTopLevel(getSingleReturnDataBuffer(response), new AddressType());
  return (decoded.valueOf() as Address).toBech32();
}

export async function getContractFeeBps(input: {
  contractAddress: string;
}) {
  const provider = buildProvider();
  const response = await provider.queryContract(
    new SmartContractQuery({
      contract: requireAddress(input.contractAddress, "ledger contract address"),
      function: "getFeeBps"
    })
  );

  const codec = new BinaryCodec();
  return codec.decodeTopLevel(getSingleReturnDataBuffer(response), new U16Type()).valueOf() as number;
}

export async function registerProviderOnChain(session: SignerSession, input: {
  contractAddress: string;
  providerId: string;
  payoutWalletAddress: string;
}) {
  const factory = buildFactory(session);
  const transaction = await factory.createTransactionForExecute(session.account.address, {
    contract: requireAddress(input.contractAddress, "ledger contract address"),
    function: "registerProvider",
    arguments: [
      new BytesValue(Buffer.from(input.providerId, "utf8")),
      new AddressValue(requireAddress(input.payoutWalletAddress, "provider payout wallet address"))
    ],
    gasLimit: 30_000_000n
  });

  return signAndSendTransaction(session, transaction);
}

export async function depositToLedgerOnChain(session: SignerSession, input: {
  contractAddress: string;
  assetIdentifier: string;
  amountAtomic: string;
}) {
  const factory = buildFactory(session);
  const executeInput = input.assetIdentifier === "EGLD"
    ? {
        contract: requireAddress(input.contractAddress, "ledger contract address"),
        function: "deposit",
        arguments: [],
        gasLimit: 20_000_000n,
        nativeTransferAmount: BigInt(input.amountAtomic)
      }
    : (() => {
        throw new Error("Only EGLD deposits are supported by the devnet execution helper at the moment.");
      })();

  const transaction = await factory.createTransactionForExecute(session.account.address, executeInput);
  return signAndSendTransaction(session, transaction);
}

export async function updateProviderPayoutOnChain(session: SignerSession, input: {
  contractAddress: string;
  providerId: string;
  payoutWalletAddress: string;
}) {
  const factory = buildFactory(session);
  const transaction = await factory.createTransactionForExecute(session.account.address, {
    contract: requireAddress(input.contractAddress, "ledger contract address"),
    function: "updateProviderPayout",
    arguments: [
      new BytesValue(Buffer.from(input.providerId, "utf8")),
      new AddressValue(requireAddress(input.payoutWalletAddress, "provider payout wallet address"))
    ],
    gasLimit: 30_000_000n
  });

  return signAndSendTransaction(session, transaction);
}

export async function applySettlementBatchOnChain(session: SignerSession, input: {
  contractAddress: string;
  batchId: string;
  buyerDebits: SettlementBuyerDebit[];
  providerCredits: SettlementProviderCredit[];
  feeAmountAtomic: string;
}) {
  const factory = buildFactory(session);
  const transaction = await factory.createTransactionForExecute(session.account.address, {
    contract: requireAddress(input.contractAddress, "ledger contract address"),
    function: "applySettlementBatch",
    arguments: [
      new BytesValue(Buffer.from(input.batchId, "utf8")),
      new List(new ListType(buyerDebitType), input.buyerDebits.map(buildBuyerDebitValue)),
      new List(new ListType(providerCreditType), input.providerCredits.map(buildProviderCreditValue)),
      new BigUIntValue(BigInt(input.feeAmountAtomic))
    ],
    gasLimit: computeSettlementGasLimit(input.buyerDebits.length, input.providerCredits.length)
  });

  return signAndSendTransaction(session, transaction);
}

export async function claimProviderEarningsOnChain(session: SignerSession, input: {
  contractAddress: string;
  providerId: string;
  amountAtomic?: string | null;
}) {
  const factory = buildFactory(session);
  const argumentsList: Array<BytesValue | BigUIntValue> = [new BytesValue(Buffer.from(input.providerId, "utf8"))];

  if (input.amountAtomic && BigInt(input.amountAtomic) > 0n) {
    argumentsList.push(new BigUIntValue(BigInt(input.amountAtomic)));
  }

  const transaction = await factory.createTransactionForExecute(session.account.address, {
    contract: requireAddress(input.contractAddress, "ledger contract address"),
    function: "claimProviderEarnings",
    arguments: argumentsList,
    gasLimit: 25_000_000n
  });

  return signAndSendTransaction(session, transaction);
}

export async function deployLedgerContract(session: SignerSession, input: DeployLedgerInput): Promise<DeployLedgerResult> {
  const factory = buildFactory(session);
  const bytecode = await readFile(input.wasmPath);
  const predictedAddress = new AddressComputer().computeContractAddress(session.account.address, session.nextNonce);
  const transaction = await factory.createTransactionForDeploy(session.account.address, {
    bytecode,
    arguments: [
      getTokenIdentifierTypedValue(input.supportedTokenIdentifier),
      new U16Value(input.feeBps),
      new AddressValue(requireAddress(input.operatorAddress, "operator address")),
      new AddressValue(requireAddress(input.treasuryAddress, "treasury address"))
    ],
    gasLimit: input.gasLimit ?? 120_000_000n,
    isUpgradeable: true,
    isReadable: true,
    isPayable: false,
    isPayableBySmartContract: false
  });

  const txHash = await signAndSendTransaction(session, transaction);

  return {
    txHash,
    contractAddress: predictedAddress.toBech32()
  };
}

export async function getTransactionStatus(txHash: string): Promise<ObservedTransaction> {
  const provider = buildProvider();
  const transaction = await provider.getTransaction(txHash);
  return serializeTransactionOnNetwork(transaction);
}

export async function waitForTransactionFinality(input: {
  txHash: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}) {
  const timeoutMs = input.timeoutMs ?? 120_000;
  const pollIntervalMs = input.pollIntervalMs ?? 6_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      const observed = await getTransactionStatus(input.txHash);
      if (!isPendingStatus(observed.status)) {
        return observed;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unexpected transaction poll failure");
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `Timed out while waiting for transaction ${input.txHash}. ${lastError ? `Last error: ${lastError.message}` : ""}`.trim()
  );
}

export async function parseDeployedContractAddress(input: {
  txHash: string;
}) {
  const provider = buildProvider();
  const parser = new SmartContractTransactionsOutcomeParser();
  const transaction = await provider.getTransaction(input.txHash);
  const outcome = parser.parseDeploy({
    transactionOnNetwork: transaction
  });

  return outcome.contracts[0]?.address.toBech32() ?? null;
}

export async function getAccountNonce(address: string) {
  const provider = buildProvider();
  const account = await provider.getAccount(requireAddress(address, "account address"));
  return account.nonce;
}

export function getDefaultSettlementSecretKey() {
  return process.env.MX402_SETTLEMENT_PRIVATE_KEY
    ?? process.env.MX402_OPERATOR_PRIVATE_KEY
    ?? process.env.MX402_OWNER_PRIVATE_KEY
    ?? "";
}

export function getDefaultClaimSecretKey() {
  return process.env.MX402_PROVIDER_PRIVATE_KEY ?? "";
}

export function getSharedChainConfig() {
  const runtimeConfig = loadSharedRuntimeConfig();

  return {
    chainId: runtimeConfig.chainId,
    contractAddress: process.env.MX402_LEDGER_CONTRACT ?? "",
    assetIdentifier: runtimeConfig.assetIdentifier
  };
}

export function requireSharedChainConfig() {
  const config = getSharedChainConfig();

  if (!config.contractAddress) {
    throw new Error("MX402_LEDGER_CONTRACT is not configured");
  }

  return config;
}

export function requireSettlementSecretKey() {
  const secretKey = getDefaultSettlementSecretKey();
  if (!secretKey) {
    throw new Error("Missing settlement signer secret key. Set MX402_SETTLEMENT_PRIVATE_KEY or MX402_OWNER_PRIVATE_KEY.");
  }

  return secretKey;
}

export function requireClaimSecretKey() {
  const secretKey = getDefaultClaimSecretKey();
  if (!secretKey) {
    throw new Error("Missing provider claim signer secret key. Set MX402_PROVIDER_PRIVATE_KEY.");
  }

  return secretKey;
}
