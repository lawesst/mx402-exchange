"use client";

import { Address } from "@multiversx/sdk-core/out/core/address";
import { Transaction } from "@multiversx/sdk-core/out/core/transaction";
import { initApp } from "@multiversx/sdk-dapp/out/methods/initApp/initApp";
import type { InitAppType } from "@multiversx/sdk-dapp/out/methods/initApp/initApp.types";
import { getAccount } from "@multiversx/sdk-dapp/out/methods/account/getAccount";
import { getLoginInfo } from "@multiversx/sdk-dapp/out/methods/loginInfo/getLoginInfo";
import { TransactionManager } from "@multiversx/sdk-dapp/out/managers/TransactionManager";
import { getAccountProvider } from "@multiversx/sdk-dapp/out/providers/helpers/accountProvider";
import { ProviderFactory } from "@multiversx/sdk-dapp/out/providers/ProviderFactory";
import { ProviderTypeEnum } from "@multiversx/sdk-dapp/out/providers/types/providerFactory.types";
import type { SignedTransactionType } from "@multiversx/sdk-dapp/out/types/transactions.types";
import { refreshAccount } from "@multiversx/sdk-dapp/out/utils/account/refreshAccount";
import { EnvironmentsEnum } from "@multiversx/sdk-dapp/out/types/enums.types";

import type { PreparedTransactionCall } from "@mx402/multiversx";

let initPromise: Promise<void> | null = null;

type WalletSummary = {
  address: string | null;
  nonce: number;
  providerType: string | null;
  nativeAuthToken: string | null;
  networkAccountMissing?: boolean;
  warningMessage?: string | null;
};

declare global {
  interface Window {
    elrondWallet?: {
      extensionId?: string;
    };
    multiversxWallet?: {
      extensionId?: string;
    };
  }
}

function flattenSentTransactions(
  sentTransactions: SignedTransactionType[] | SignedTransactionType[][]
): SignedTransactionType[] {
  return Array.isArray(sentTransactions[0])
    ? (sentTransactions as SignedTransactionType[][]).flat()
    : (sentTransactions as SignedTransactionType[]);
}

function resolveEnvironment(): EnvironmentsEnum {
  const value = (process.env.NEXT_PUBLIC_MULTIVERSX_ENV ?? "devnet").toLowerCase();

  if (value === "mainnet") {
    return EnvironmentsEnum.mainnet;
  }

  if (value === "testnet") {
    return EnvironmentsEnum.testnet;
  }

  return EnvironmentsEnum.devnet;
}

function getEnvironmentLabel() {
  const environment = resolveEnvironment();

  if (environment === EnvironmentsEnum.mainnet) {
    return "Mainnet";
  }

  if (environment === EnvironmentsEnum.testnet) {
    return "Testnet";
  }

  return "Devnet";
}

function buildMissingAccountMessage() {
  return `Connected, but this wallet does not have an account on MultiversX ${getEnvironmentLabel()} yet. Switch the extension to ${getEnvironmentLabel()} or fund this address on ${getEnvironmentLabel()}, then retry.`;
}

function isMissingAccountError(error: unknown) {
  return error instanceof Error && error.message === "Account not found";
}

async function resolveProviderAddress(provider: Awaited<ReturnType<typeof ProviderFactory.create>>) {
  try {
    return (await provider.getProvider().getAddress()) ?? null;
  } catch {
    return null;
  }
}

function hasInjectedExtensionProvider(): boolean {
  return Boolean(window.multiversxWallet || window.elrondWallet);
}

async function waitForInjectedExtensionProvider(timeoutMs = 2_500) {
  if (hasInjectedExtensionProvider()) {
    return true;
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));

    if (hasInjectedExtensionProvider()) {
      return true;
    }
  }

  return false;
}

export async function ensureDappReady() {
  if (!initPromise) {
    const config: InitAppType = {
      storage: {
        getStorageCallback: () => window.sessionStorage
      },
      dAppConfig: {
        environment: resolveEnvironment(),
        nativeAuth: {
          apiAddress: process.env.NEXT_PUBLIC_MULTIVERSX_API_URL,
          expirySeconds: Number(process.env.NEXT_PUBLIC_NATIVE_AUTH_EXPIRY_SECONDS ?? "86400")
        },
        network: {
          chainId: process.env.NEXT_PUBLIC_MULTIVERSX_CHAIN_ID,
          apiAddress: process.env.NEXT_PUBLIC_MULTIVERSX_API_URL,
          walletAddress: process.env.NEXT_PUBLIC_MULTIVERSX_WALLET_URL,
          explorerAddress: process.env.NEXT_PUBLIC_MULTIVERSX_EXPLORER_URL
        }
      }
    };

    initPromise = initApp(config).then(() => undefined);
  }

  await initPromise;
}

export async function connectWallet(providerType: typeof ProviderTypeEnum.extension | typeof ProviderTypeEnum.crossWindow) {
  await ensureDappReady();

  const isLoopbackHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);

  if (providerType === ProviderTypeEnum.extension && !window.isSecureContext && !isLoopbackHost) {
    throw new Error(`Extension login requires a secure context. Open MX402 on https or localhost. Current origin: ${window.location.origin}`);
  }

  if (providerType === ProviderTypeEnum.extension) {
    const hasExtensionProvider = await waitForInjectedExtensionProvider();

    if (!hasExtensionProvider) {
      throw new Error(
        "MultiversX Browser Extension was not detected. Install or enable the extension, allow it on this site, then reload https://localhost:3002."
      );
    }
  }

  const provider = await ProviderFactory.create({
    type: providerType
  });

  if (!provider.isInitialized()) {
    await provider.init();
  }

  if (providerType === ProviderTypeEnum.extension && !provider.isInitialized()) {
    throw new Error(
      "MultiversX Browser Extension is installed but did not initialize on this page. Reload the page and confirm the extension has access to localhost."
    );
  }

  try {
    const loginResult = await provider.login();
    const refreshed = await refreshAccount();
    const loginInfo = getLoginInfo();

    return {
      providerType: loginInfo.providerType ?? providerType,
      address: refreshed?.address ?? loginResult?.address ?? null,
      nativeAuthToken: loginInfo.tokenLogin?.nativeAuthToken ?? null,
      networkAccountMissing: false,
      warningMessage: null
    };
  } catch (error) {
    if (!isMissingAccountError(error)) {
      throw error;
    }

    const loginInfo = getLoginInfo();
    const address = await resolveProviderAddress(provider);
    const nativeAuthToken = loginInfo.tokenLogin?.nativeAuthToken ?? null;

    if (!address || !nativeAuthToken) {
      throw new Error(buildMissingAccountMessage());
    }

    return {
      providerType: loginInfo.providerType ?? providerType,
      address,
      nativeAuthToken,
      networkAccountMissing: true,
      warningMessage: buildMissingAccountMessage()
    };
  }
}

export async function disconnectWallet() {
  await ensureDappReady();

  try {
    await getAccountProvider().logout({
      shouldBroadcastLogoutAcrossTabs: true
    });
  } catch {
    return;
  }
}

export async function getConnectedWallet(): Promise<WalletSummary> {
  await ensureDappReady();
  const refreshed = await refreshAccount().catch(() => null);
  const account = getAccount();
  const loginInfo = getLoginInfo();
  const providerAddress = await resolveProviderAddress(getAccountProvider());
  const address = refreshed?.address ?? account.address ?? providerAddress ?? null;
  const networkAccountMissing = Boolean(address && loginInfo.tokenLogin?.nativeAuthToken && !refreshed?.address && !account.address);

  return {
    address,
    nonce: refreshed?.nonce ?? account.nonce ?? 0,
    providerType: loginInfo.providerType ?? null,
    nativeAuthToken: loginInfo.tokenLogin?.nativeAuthToken ?? null,
    networkAccountMissing,
    warningMessage: networkAccountMissing ? buildMissingAccountMessage() : null
  };
}

export async function signAndSendPreparedTransaction(input: {
  preparedCall: PreparedTransactionCall;
  expectedSender: string;
}) {
  await ensureDappReady();
  const refreshed = await refreshAccount();
  const account = getAccount();
  const senderAddress = refreshed?.address ?? account.address;
  const senderNonce = refreshed?.nonce ?? account.nonce ?? 0;

  if (!senderAddress) {
    throw new Error("Connect a MultiversX wallet before submitting a deposit");
  }

  if (senderAddress !== input.expectedSender) {
    throw new Error("Connected wallet does not match the authenticated buyer session");
  }

  const transaction = new Transaction({
    nonce: BigInt(senderNonce),
    value: BigInt(input.preparedCall.value),
    sender: Address.newFromBech32(senderAddress),
    receiver: Address.newFromBech32(input.preparedCall.receiver),
    gasPrice: BigInt(input.preparedCall.gasPrice),
    gasLimit: BigInt(input.preparedCall.gasLimit),
    data: new TextEncoder().encode(input.preparedCall.data),
    chainID: input.preparedCall.chainId,
    version: input.preparedCall.version
  });

  const provider = getAccountProvider();
  const signedTransactions = await provider.signTransactions([transaction]);
  const transactionManager = TransactionManager.getInstance();
  const sentTransactions = await transactionManager.send(signedTransactions);
  const flattenedTransactions = flattenSentTransactions(sentTransactions);

  await transactionManager.track(flattenedTransactions, {
    transactionsDisplayInfo: {
      processingMessage: "Submitting deposit transaction",
      successMessage: "Deposit transaction submitted",
      errorMessage: "Deposit transaction failed"
    }
  });

  const [firstTransaction] = flattenedTransactions;
  if (!firstTransaction?.hash) {
    throw new Error("Transaction was sent but no hash was returned");
  }

  return {
    txHash: firstTransaction.hash
  };
}
