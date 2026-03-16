'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import BigNumber from 'bignumber.js';

import { AppShell } from '../app-shell';
import { DataState } from '../data-state';
import { Panel } from '../panel';
import { formatCompactNumber, formatDate, formatEGLD, truncateAddress } from '../../lib/format';
import { useMirrorTransactionsQuery, useUsageEventsQuery, useViewerQuery, useWalletAccountQuery, useWalletTransactionsQuery } from '../../lib/hooks';
import { useWalletController } from '../../app/wallet-provider';
import { prepareDeposit, trackDeposit } from '../../lib/api';
import { signAndSendPreparedTransaction } from '../../lib/multiversx';

export function WalletScreen() {
  const queryClient = useQueryClient();
  const { wallet } = useWalletController();
  const { data: viewer } = useViewerQuery();
  const { data: usageEvents } = useUsageEventsQuery(Boolean(viewer?.user));
  const { data: account, isLoading: walletLoading, error } = useWalletAccountQuery(wallet.address);
  const { data: walletTransactions } = useWalletTransactionsQuery(wallet.address);
  const { data: mirrorTransactions } = useMirrorTransactionsQuery(Boolean(viewer?.user));
  const [depositAmount, setDepositAmount] = useState('0.02');
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositMessage, setDepositMessage] = useState<string | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [latestDepositTxHash, setLatestDepositTxHash] = useState<string | null>(null);

  const spentAtomic = useMemo(
    () => (usageEvents ?? []).reduce((sum, item) => sum + Number(item.amountAtomic), 0),
    [usageEvents]
  );
  const explorerBaseUrl = process.env.NEXT_PUBLIC_MULTIVERSX_EXPLORER_URL ?? 'https://devnet-explorer.multiversx.com';
  const latestDepositHref = latestDepositTxHash ? `${explorerBaseUrl}/transactions/${latestDepositTxHash}` : null;

  async function refreshWalletViews() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['viewer'] }),
      queryClient.invalidateQueries({ queryKey: ['wallet-account', wallet.address] }),
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions', wallet.address] }),
      queryClient.invalidateQueries({ queryKey: ['mirror-transactions'] })
    ]);
  }

  async function handleDeposit() {
    if (!viewer?.user?.walletAddress) {
      setDepositError('Authenticate the buyer session before funding the MX402 ledger.');
      return;
    }

    const normalizedAmount = new BigNumber(depositAmount);
    if (!normalizedAmount.isFinite() || normalizedAmount.lte(0)) {
      setDepositError('Enter a valid EGLD amount before funding the ledger.');
      return;
    }

    setDepositBusy(true);
    setDepositMessage(null);
    setDepositError(null);

    try {
      const amountAtomic = normalizedAmount.multipliedBy('1e18').integerValue(BigNumber.ROUND_FLOOR).toFixed(0);
      const prepared = await prepareDeposit({ amountAtomic });
      if (!prepared) {
        throw new Error('Deposit preparation returned no payload');
      }

      const submitted = await signAndSendPreparedTransaction({
        preparedCall: prepared,
        expectedSender: viewer.user.walletAddress,
        displayInfo: {
          processingMessage: 'Submitting buyer deposit',
          successMessage: 'Buyer deposit submitted',
          errorMessage: 'Buyer deposit failed'
        }
      });

      await trackDeposit({
        txHash: submitted.txHash,
        amountAtomic
      });

      setLatestDepositTxHash(submitted.txHash);
      setDepositMessage('Deposit transaction submitted. Wait for confirmation, then refresh the mirrored transaction list.');
      await refreshWalletViews();
    } catch (depositFailure) {
      setDepositError(depositFailure instanceof Error ? depositFailure.message : 'Failed to submit buyer deposit');
    } finally {
      setDepositBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <Panel className="p-7">
          <div className="display-eyebrow">Wallet overview</div>
          <h1 className="mt-4 text-4xl font-semibold md:text-5xl">Track EGLD balance, spend, and mirrored settlement flow</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-sub md:text-lg">
            Use the header widget to connect a wallet, then inspect on-chain account state alongside MX402 mirrored deposits and usage receipts.
          </p>
        </Panel>

        <DataState
          isLoading={walletLoading}
          error={error as Error | null}
          empty={!wallet.address}
          emptyTitle="No wallet connected"
          emptyCopy="Connect a MultiversX wallet from the header to inspect EGLD balance, transaction history, and MX402 settlement mirrors."
          emptyCtaHref="/marketplace"
          emptyCtaLabel="Open marketplace →"
        >
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-6">
              {wallet.networkAccountMissing ? (
                <Panel className="border-gold/30 bg-gold/5 p-5">
                  <div className="display-eyebrow text-gold">Network account missing</div>
                  <h2 className="mt-3 text-xl font-semibold text-ink">This wallet is connected, but it does not exist on the selected network yet.</h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-sub">
                    {wallet.warningMessage ?? 'Switch the wallet to the correct MultiversX network or fund this address first. Until then, on-chain balance and transaction history will stay empty even though the backend session is active.'}
                  </p>
                </Panel>
              ) : null}

              <div className="grid gap-4 md:grid-cols-4">
                <Metric label="Address" value={truncateAddress(wallet.address)} mono />
                <Metric label="On-chain balance" value={formatEGLD(account?.balance)} />
                <Metric label="Nonce" value={formatCompactNumber(account?.nonce ?? 0)} mono />
                <Metric label="Spent via MX402" value={formatEGLD(spentAtomic)} />
              </div>

              <Panel title="Fund buyer balance" kicker="Ledger deposit">
                <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-3">
                    <label className="text-xs uppercase tracking-[0.16em] text-muted" htmlFor="deposit-egld">
                      Deposit amount (EGLD)
                    </label>
                    <input
                      id="deposit-egld"
                      className="w-full rounded-2xl border border-white/10 bg-panel/80 px-4 py-3 font-mono text-sm text-ink outline-none transition focus:border-accent/40"
                      value={depositAmount}
                      onChange={(event) => setDepositAmount(event.target.value)}
                      inputMode="decimal"
                    />
                    <button className="action-button-primary" disabled={depositBusy || !wallet.address} onClick={() => void handleDeposit()}>
                      {depositBusy ? 'Submitting deposit…' : 'Deposit EGLD'}
                    </button>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-sub">
                    <p>Connected wallet: <span className="font-mono text-ink">{truncateAddress(wallet.address)}</span></p>
                    <p className="mt-2">This signs the `deposit` call against the active MX402 ledger contract and tracks the resulting tx for the mirrored buyer balance.</p>
                    {depositMessage ? <p className="mt-3 text-success">{depositMessage}</p> : null}
                    {depositError ? <p className="mt-3 text-danger">{depositError}</p> : null}
                    {latestDepositHref ? (
                      <a href={latestDepositHref} target="_blank" rel="noreferrer" className="action-button mt-4 inline-flex">
                        View latest deposit tx →
                      </a>
                    ) : null}
                  </div>
                </div>
              </Panel>

              <Panel title="Wallet transactions" kicker="Chain history">
                <DataState
                  empty={(walletTransactions ?? []).length === 0}
                  emptyTitle="No wallet transactions loaded"
                  emptyCopy="Once the connected address broadcasts devnet transactions, they will appear here."
                  emptyCtaHref="/marketplace"
                  emptyCtaLabel="Trigger a call →"
                >
                  <div className="space-y-3">
                    {(walletTransactions ?? []).slice(0, 8).map((transaction) => (
                      <div key={transaction.txHash} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="font-mono text-sm text-ink">{transaction.function ?? transaction.txHash.slice(0, 12)}</h3>
                            <p className="mt-1 text-xs text-sub">{formatDate(transaction.timestamp)}</p>
                          </div>
                          <div className="font-mono text-xs text-right text-sub">
                            <div>{formatEGLD(transaction.value)}</div>
                            <div className={transaction.status === 'success' ? 'text-success' : 'text-danger'}>{transaction.status}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </DataState>
              </Panel>
            </div>

            <div className="space-y-6">
              <Panel title="MX402 mirrored ledger" kicker="Marketplace balance">
                <div className="space-y-3 text-sm text-sub">
                  <p>Spendable: <span className="font-mono text-ink">{formatEGLD(viewer?.balance?.spendableAtomic)}</span></p>
                  <p>Reserved: <span className="font-mono text-ink">{formatEGLD(viewer?.balance?.reservedAtomic)}</span></p>
                  <p>Confirmed: <span className="font-mono text-ink">{formatEGLD(viewer?.balance?.onchainConfirmedAtomic)}</span></p>
                </div>
              </Panel>
              <Panel title="Mirrored tx history" kicker="Deposits and syncs">
                <DataState
                  empty={(mirrorTransactions ?? []).length === 0}
                  emptyTitle="No mirrored transactions yet"
                  emptyCopy="Deposits tracked through the MX402 ledger worker will show here once indexed."
                  emptyCtaHref="/dashboard"
                  emptyCtaLabel="Open dashboard →"
                >
                  <div className="space-y-3">
                    {(mirrorTransactions ?? []).slice(0, 8).map((transaction) => (
                      <div key={transaction.txHash} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="font-mono text-sm text-ink">{transaction.txHash.slice(0, 12)}…</h3>
                            <p className="mt-1 text-xs text-sub">{transaction.status}</p>
                          </div>
                          <div className="font-mono text-xs text-right text-sub">{formatEGLD(transaction.amountAtomic ?? 0)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </DataState>
              </Panel>
            </div>
          </div>
        </DataState>
      </div>
    </AppShell>
  );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="panel-surface p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className={`mt-2 text-lg text-ink ${mono ? 'font-mono text-sm' : 'font-mono'}`}>{value}</p>
    </div>
  );
}
