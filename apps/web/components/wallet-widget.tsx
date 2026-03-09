'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useMemo } from 'react';

import { ProviderTypeEnum } from '@multiversx/sdk-dapp/out/providers/types/providerFactory.types';

import { atomicToEGLD, formatEGLD, formatUsd, truncateAddress } from '../lib/format';
import { useChainOverviewQuery, useViewerQuery, useWalletAccountQuery } from '../lib/hooks';
import { useMx402UiStore } from '../lib/store/ui-store';
import { useWalletController } from '../app/wallet-provider';

type WalletWidgetProps = {
  variant?: 'nav' | 'panel';
  dialogEnabled?: boolean;
};

export function WalletWidget({ variant = 'nav', dialogEnabled = true }: WalletWidgetProps) {
  const { wallet, isBooting, isBusy, errorMessage, noticeMessage, connect, disconnect, clearError } = useWalletController();
  const walletDialogOpen = useMx402UiStore((state) => state.walletDialogOpen);
  const setWalletDialogOpen = useMx402UiStore((state) => state.setWalletDialogOpen);
  const viewerQuery = useViewerQuery();
  const viewer = viewerQuery.data;
  const { data: walletAccount } = useWalletAccountQuery(wallet.address);
  const { data: chain } = useChainOverviewQuery();

  const displayBalance = useMemo(() => {
    if (!walletAccount?.balance) {
      return '0.0000 EGLD';
    }

    return formatEGLD(walletAccount.balance);
  }, [walletAccount?.balance]);

  const usdBalance = useMemo(() => {
    if (!walletAccount?.balance || !chain?.egldUsd) {
      return null;
    }

    return formatUsd(atomicToEGLD(walletAccount.balance).multipliedBy(chain.egldUsd).toNumber());
  }, [chain?.egldUsd, walletAccount?.balance]);

  async function handleConnect(providerType: typeof ProviderTypeEnum.extension | typeof ProviderTypeEnum.crossWindow) {
    clearError();

    try {
      await connect(providerType);
      setWalletDialogOpen(false);
    } catch {
      return;
    }
  }

  async function handleDisconnect() {
    try {
      await disconnect();
    } catch {
      return;
    }
  }

  const content = variant === 'panel'
    ? (
      <div className="rounded-[12px] border border-accent/20 bg-[linear-gradient(135deg,rgba(35,247,221,0.07)_0%,rgba(35,247,221,0.02)_100%)] p-4">
        <div className="flex items-center gap-2 font-mono text-[11px] text-sub">
          <span className={`h-1.5 w-1.5 rounded-full ${wallet.address ? 'bg-success shadow-[0_0_6px_rgba(34,229,106,0.95)] animate-pulse' : 'bg-muted'}`} />
          <span>{wallet.address ? truncateAddress(wallet.address) : 'Wallet disconnected'}</span>
        </div>
        <p className="mt-3 font-mono text-[28px] font-semibold tracking-[-0.02em] text-ink">
          {wallet.address && !isBooting ? displayBalance.replace(' EGLD', '') : '0.0000'}
          <span className="ml-2 text-sm text-accent">EGLD</span>
        </p>
        <p className="mt-1 font-mono text-[11px] text-sub">
          {wallet.address ? `${usdBalance ?? '$0.00'} USD · Available to spend` : 'Connect a wallet to fund paid API calls'}
        </p>
        <div className="mt-4 flex gap-2">
          {wallet.address ? (
            <button className="action-button" disabled={isBusy} onClick={() => void handleDisconnect()}>
              {isBusy ? '...' : 'Disconnect'}
            </button>
          ) : (
            <button className="action-button-primary" onClick={() => setWalletDialogOpen(true)}>
              Connect wallet
            </button>
          )}
          <a href="/wallet" className="action-button">
            Wallet view
          </a>
        </div>
        {noticeMessage ? (
          <div className="mt-4 rounded-[12px] border border-gold/20 bg-gold/10 p-3 text-xs leading-5 text-gold">
            {noticeMessage}
          </div>
        ) : null}
      </div>
      )
    : (
      <button
        className={`inline-flex items-center gap-2 rounded-[7px] border px-3 py-1.5 text-[13px] font-medium transition ${wallet.address ? 'border-accent/20 bg-accent/10 text-accent' : 'border-white/10 text-sub hover:border-accent/25 hover:text-accent'}`}
        disabled={isBusy}
        onClick={() => setWalletDialogOpen(true)}
        type="button"
      >
        <span className={`h-2 w-2 rounded-full ${wallet.address ? 'bg-success shadow-[0_0_6px_rgba(34,229,106,0.85)]' : 'bg-muted'}`} />
        <span>{wallet.address ? truncateAddress(wallet.address) : 'Connect Wallet'}</span>
      </button>
      );

  if (!dialogEnabled) {
    return content;
  }

  return (
    <Dialog.Root
      open={walletDialogOpen}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          clearError();
        }

        setWalletDialogOpen(nextOpen);
      }}
    >
      {content}

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[18px] border border-white/10 bg-panel p-6 shadow-panel">
          <Dialog.Title className="text-2xl font-semibold text-ink">Connect a MultiversX wallet</Dialog.Title>
          <Dialog.Description className="mt-2 max-w-lg text-sm leading-6 text-sub">
            Authenticate with Native Auth, sync the backend session, and unlock pay-per-call settlement for MX402 Exchange.
          </Dialog.Description>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <button className="action-button-primary w-full justify-start" disabled={isBusy} onClick={() => void handleConnect(ProviderTypeEnum.extension)}>
              {isBusy ? 'Connecting…' : 'Connect extension'}
            </button>
            <button className="action-button w-full justify-start" disabled={isBusy} onClick={() => void handleConnect(ProviderTypeEnum.crossWindow)}>
              Connect web wallet
            </button>
          </div>

          <div className="mt-5 rounded-[12px] border border-white/[0.06] bg-black/20 p-4 text-sm text-sub">
            <p className="display-eyebrow">Session rail</p>
            <p className="mt-2">Backend session: {viewer?.user ? 'Active' : 'Not authenticated'}</p>
            <p className="mt-1">Connected address: {wallet.address ? truncateAddress(wallet.address) : 'None'}</p>
            <p className="mt-1">Balance: {isBooting ? 'Booting…' : displayBalance}</p>
            <p className="mt-1">Provider: {wallet.providerType ?? 'None'}</p>
          </div>

          {wallet.address ? (
            <div className="mt-5 flex items-center justify-between gap-3 rounded-[12px] border border-accent/10 bg-accent/5 p-4">
              <div>
                <p className="font-mono text-xs text-sub">Connected</p>
                <p className="mt-1 font-mono text-sm text-ink">{truncateAddress(wallet.address)}</p>
              </div>
              <button className="action-button" disabled={isBusy} onClick={() => void handleDisconnect()}>
                {isBusy ? '...' : 'Disconnect'}
              </button>
            </div>
          ) : null}

          {noticeMessage ? (
            <div className="mt-4 rounded-[12px] border border-gold/20 bg-gold/10 p-3 text-sm leading-6 text-gold">
              {noticeMessage}
            </div>
          ) : null}

          {errorMessage ? <p className="mt-4 text-sm text-danger">{errorMessage}</p> : null}

          <div className="mt-6 flex justify-end">
            <Dialog.Close asChild>
              <button className="action-button">Close</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
