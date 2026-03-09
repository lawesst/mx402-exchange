export type PreparedContractCall = {
  contractAddress: string;
  chainId: string;
  function: string;
  tokenIdentifier?: string;
  amountAtomic?: string;
  gasLimit: number;
  arguments?: string[];
};

export function prepareDepositCall(input: {
  contractAddress: string;
  chainId: string;
  tokenIdentifier: string;
  amountAtomic: string;
}): PreparedContractCall {
  return {
    contractAddress: input.contractAddress,
    chainId: input.chainId,
    function: "deposit",
    tokenIdentifier: input.tokenIdentifier,
    amountAtomic: input.amountAtomic,
    gasLimit: 12_000_000
  };
}

export function prepareWithdrawCall(input: {
  contractAddress: string;
  chainId: string;
  amountAtomic: string;
}): PreparedContractCall {
  return {
    contractAddress: input.contractAddress,
    chainId: input.chainId,
    function: "withdraw",
    amountAtomic: input.amountAtomic,
    gasLimit: 12_000_000,
    arguments: [input.amountAtomic]
  };
}
