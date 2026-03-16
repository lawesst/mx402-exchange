'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { prepareProviderClaim, refreshProviderClaimState, trackProviderClaim } from '../../lib/api';
import { atomicToEGLD, formatCompactNumber, formatDate, formatEGLD, truncateAddress } from '../../lib/format';
import { useProviderEarningsQuery, useProviderProductsQuery, useViewerQuery } from '../../lib/hooks';
import { signAndSendPreparedTransaction } from '../../lib/multiversx';
import { useWalletController } from '../../app/wallet-provider';
import { AppShell } from '../app-shell';
import { DataState } from '../data-state';
import { Panel } from '../panel';
import { UsageChart } from '../usage-chart';

function getExplorerBaseUrl() {
  return process.env.NEXT_PUBLIC_MULTIVERSX_EXPLORER_URL ?? 'https://devnet-explorer.multiversx.com';
}

export function AnalyticsScreen() {
  const queryClient = useQueryClient();
  const { wallet } = useWalletController();
  const { data: viewer, isLoading, error } = useViewerQuery();
  const { data: providerProducts } = useProviderProductsQuery(Boolean(viewer?.provider));
  const { data: earnings } = useProviderEarningsQuery(Boolean(viewer?.provider));
  const [claimBusy, setClaimBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [claimTxHash, setClaimTxHash] = useState<string | null>(null);

  const revenueSeries = useMemo(() => {
    const buckets = new Map<string, number>();
    (earnings?.recentUsage ?? []).forEach((entry) => {
      const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(entry.occurredAt));
      buckets.set(label, (buckets.get(label) ?? 0) + atomicToEGLD(entry.amountAtomic).toNumber());
    });
    return Array.from(buckets.entries()).map(([label, value]) => ({ label, value }));
  }, [earnings?.recentUsage]);

  async function refreshProviderViews() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['viewer'] }),
      queryClient.invalidateQueries({ queryKey: ['provider-earnings'] }),
      queryClient.invalidateQueries({ queryKey: ['provider-products'] }),
      queryClient.invalidateQueries({ queryKey: ['mirror-transactions'] })
    ]);
  }

  async function handleClaimAll() {
    setClaimBusy(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const prepared = await prepareProviderClaim();
      if (!prepared) {
        throw new Error('Provider claim preparation returned no payload');
      }

      const submitted = await signAndSendPreparedTransaction({
        preparedCall: prepared,
        expectedSender: prepared.payoutWalletAddress,
        displayInfo: {
          processingMessage: 'Submitting provider earnings claim',
          successMessage: 'Provider claim submitted',
          errorMessage: 'Provider claim failed'
        }
      });

      await trackProviderClaim({
        txHash: submitted.txHash,
        amountAtomic: prepared.amountAtomic ?? prepared.claimableAtomic
      });

      setClaimTxHash(submitted.txHash);
      setMessage(`Claim transaction submitted. Refresh claim state after confirmation to update balances.`);
      await refreshProviderViews();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to submit provider claim');
    } finally {
      setClaimBusy(false);
    }
  }

  async function handleRefreshClaimState() {
    setRefreshBusy(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const refreshed = await refreshProviderClaimState();
      await refreshProviderViews();
      setMessage(
        `Claim refresh complete. Confirmed ${refreshed?.confirmation.confirmed ?? 0}, pending ${refreshed?.confirmation.pending ?? 0}, failed ${refreshed?.confirmation.failed ?? 0}.`
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to refresh provider claim state');
    } finally {
      setRefreshBusy(false);
    }
  }

  const explorerTxHref = claimTxHash ? `${getExplorerBaseUrl()}/transactions/${claimTxHash}` : null;

  return (
    <AppShell>
      <div className="space-y-6">
        <Panel className="p-7">
          <div className="display-eyebrow">Publisher analytics</div>
          <h1 className="mt-4 text-4xl font-semibold md:text-5xl">Measure revenue, claims, and provider performance</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-sub md:text-lg">
            Follow unsettled earnings, claimable balances, and paid call flow from the provider side of the marketplace.
          </p>
        </Panel>

        <DataState
          isLoading={isLoading}
          error={error as Error | null}
          empty={!viewer?.provider}
          emptyTitle="No provider profile attached to this wallet"
          emptyCopy="You need an approved provider profile before MX402 can surface publisher analytics and claimable earnings."
          emptyCtaHref="/publish"
          emptyCtaLabel="Start the publish flow →"
        >
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                <Metric label="Products" value={formatCompactNumber(providerProducts?.length ?? 0)} />
                <Metric label="Unsettled" value={formatEGLD(earnings?.balances.unsettledEarnedAtomic)} />
                <Metric label="Claimable" value={formatEGLD(earnings?.balances.claimableOnchainAtomic)} />
                <Metric label="Claimed" value={formatEGLD(earnings?.balances.claimedTotalAtomic)} />
              </div>

              <Panel title="Revenue / call volume" kicker="Provider trend">
                <DataState
                  empty={revenueSeries.length === 0}
                  emptyTitle="No provider traffic yet"
                  emptyCopy="Once consumers start routing paid calls to your APIs, revenue and call volume will trend here."
                  emptyCtaHref="/marketplace"
                  emptyCtaLabel="See marketplace demand →"
                >
                  <UsageChart data={revenueSeries} stroke="#F0C040" />
                </DataState>
              </Panel>

              <Panel title="Recent provider usage" kicker="Executed receipts">
                <DataState
                  empty={(earnings?.recentUsage ?? []).length === 0}
                  emptyTitle="No provider traffic yet"
                  emptyCopy="Recent charged calls will appear here after consumers route traffic through the gateway."
                  emptyCtaHref="/marketplace"
                  emptyCtaLabel="Keep the listing active →"
                >
                  <div className="space-y-3">
                    {(earnings?.recentUsage ?? []).slice(0, 10).map((entry) => (
                      <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-ink">Usage event {entry.id.slice(0, 8)}</p>
                            <p className="mt-1 text-xs text-sub">Observed {formatDate(entry.occurredAt)}</p>
                          </div>
                          <div className="font-mono text-xs text-right text-sub">
                            <div>{formatEGLD(entry.amountAtomic)}</div>
                            <div className={entry.requestStatus === 'success' ? 'text-success' : 'text-danger'}>{entry.requestStatus}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </DataState>
              </Panel>
            </div>

            <div className="space-y-6">
              <Panel title="Claim earnings" kicker="On-chain payout">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-sub">
                    <p>Connected wallet: <span className="font-mono text-ink">{truncateAddress(wallet.address ?? viewer?.user?.walletAddress ?? null)}</span></p>
                    <p className="mt-2">Claims must be signed by the configured payout wallet. If the wallet is wrong, the prepare step will reject the claim.</p>
                  </div>

                  <div className="rounded-2xl border border-accent/15 bg-accent/5 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted">Claimable balance</p>
                    <p className="mt-2 font-mono text-2xl text-accent">{formatEGLD(earnings?.balances.claimableOnchainAtomic)}</p>
                    <p className="mt-2 text-xs text-sub">Claiming submits `claimProviderEarnings` on the ledger contract and then tracks the tx in MX402.</p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      className="action-button-primary"
                      disabled={claimBusy || BigInt(earnings?.balances.claimableOnchainAtomic ?? '0') <= 0n}
                      onClick={() => void handleClaimAll()}
                    >
                      {claimBusy ? 'Submitting claim…' : 'Claim all'}
                    </button>
                    <button className="action-button" disabled={refreshBusy} onClick={() => void handleRefreshClaimState()}>
                      {refreshBusy ? 'Refreshing…' : 'Refresh claim state'}
                    </button>
                  </div>

                  {message ? <p className="text-sm text-success">{message}</p> : null}
                  {errorMessage ? <p className="text-sm text-danger">{errorMessage}</p> : null}
                  {explorerTxHref ? (
                    <a href={explorerTxHref} target="_blank" rel="noreferrer" className="action-button inline-flex">
                      View latest claim tx →
                    </a>
                  ) : null}
                </div>
              </Panel>

              <Panel title="Publisher state" kicker="Operations">
                <div className="space-y-3 text-sm text-sub">
                  <p>Provider status: <span className="text-ink">{viewer?.provider?.status ?? 'unknown'}</span></p>
                  <p>Provider slug: <span className="font-mono text-ink">{viewer?.provider?.slug ?? 'n/a'}</span></p>
                  <p>Recent usage samples: <span className="text-ink">{formatCompactNumber(earnings?.recentUsage.length ?? 0)}</span></p>
                  <p>Last claim tx: <span className="font-mono text-ink">{claimTxHash ? truncateAddress(claimTxHash) : 'none submitted in this session'}</span></p>
                </div>
              </Panel>
            </div>
          </div>
        </DataState>
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-surface p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="mt-2 font-mono text-lg text-ink">{value}</p>
    </div>
  );
}
