'use client';

import { useMemo } from 'react';

import { AppShell } from '../app-shell';
import { DataState } from '../data-state';
import { Panel } from '../panel';
import { formatCompactNumber, formatDate, formatEGLD, truncateAddress } from '../../lib/format';
import { useMirrorTransactionsQuery, useUsageEventsQuery, useViewerQuery, useWalletAccountQuery, useWalletTransactionsQuery } from '../../lib/hooks';
import { useWalletController } from '../../app/wallet-provider';

export function WalletScreen() {
  const { wallet } = useWalletController();
  const { data: viewer } = useViewerQuery();
  const { data: usageEvents } = useUsageEventsQuery(Boolean(viewer?.user));
  const { data: account, isLoading: walletLoading, error } = useWalletAccountQuery(wallet.address);
  const { data: walletTransactions } = useWalletTransactionsQuery(wallet.address);
  const { data: mirrorTransactions } = useMirrorTransactionsQuery(Boolean(viewer?.user));

  const spentAtomic = useMemo(
    () => (usageEvents ?? []).reduce((sum, item) => sum + Number(item.amountAtomic), 0),
    [usageEvents]
  );

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
