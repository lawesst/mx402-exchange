export type PreparedTransactionCall = {
  receiver: string;
  chainId: string;
  function: string;
  data: string;
  value: string;
  gasPrice: number;
  version: number;
  tokenIdentifier?: string;
  amountAtomic?: string;
  gasLimit: number;
  arguments?: string[];
};

function asciiToHex(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

function bigintToHex(value: bigint | string): string {
  const hex = BigInt(value).toString(16);
  return hex.length % 2 === 0 ? hex : `0${hex}`;
}

function buildDepositData(input: { tokenIdentifier: string; amountAtomic: string }) {
  if (input.tokenIdentifier === "EGLD") {
    return "deposit";
  }

  return ["ESDTTransfer", asciiToHex(input.tokenIdentifier), bigintToHex(input.amountAtomic), asciiToHex("deposit")].join(
    "@"
  );
}

function buildWithdrawData(input: { amountAtomic: string }) {
  return ["withdraw", bigintToHex(input.amountAtomic)].join("@");
}

function buildClaimProviderEarningsData(input: {
  providerId: string;
  amountAtomic?: string | null;
}) {
  const args = ["claimProviderEarnings", asciiToHex(input.providerId)];

  if (input.amountAtomic && BigInt(input.amountAtomic) > 0n) {
    args.push(bigintToHex(input.amountAtomic));
  }

  return args.join("@");
}

export function prepareDepositCall(input: {
  contractAddress: string;
  chainId: string;
  tokenIdentifier: string;
  amountAtomic: string;
}): PreparedTransactionCall {
  const isEgld = input.tokenIdentifier === "EGLD";

  return {
    receiver: input.contractAddress,
    chainId: input.chainId,
    function: "deposit",
    data: buildDepositData({
      tokenIdentifier: input.tokenIdentifier,
      amountAtomic: input.amountAtomic
    }),
    value: isEgld ? input.amountAtomic : "0",
    gasPrice: 1_000_000_000,
    version: 2,
    tokenIdentifier: input.tokenIdentifier,
    amountAtomic: input.amountAtomic,
    gasLimit: isEgld ? 20_000_000 : 12_000_000
  };
}

export function prepareWithdrawCall(input: {
  contractAddress: string;
  chainId: string;
  amountAtomic: string;
}): PreparedTransactionCall {
  return {
    receiver: input.contractAddress,
    chainId: input.chainId,
    function: "withdraw",
    data: buildWithdrawData(input),
    value: "0",
    gasPrice: 1_000_000_000,
    version: 2,
    amountAtomic: input.amountAtomic,
    gasLimit: 12_000_000,
    arguments: [input.amountAtomic]
  };
}

export function prepareClaimProviderEarningsCall(input: {
  contractAddress: string;
  chainId: string;
  providerId: string;
  amountAtomic?: string | null;
}): PreparedTransactionCall {
  return {
    receiver: input.contractAddress,
    chainId: input.chainId,
    function: "claimProviderEarnings",
    data: buildClaimProviderEarningsData({
      providerId: input.providerId,
      amountAtomic: input.amountAtomic
    }),
    value: "0",
    gasPrice: 1_000_000_000,
    version: 2,
    amountAtomic: input.amountAtomic ?? undefined,
    gasLimit: 25_000_000,
    arguments: input.amountAtomic ? [input.providerId, input.amountAtomic] : [input.providerId]
  };
}
