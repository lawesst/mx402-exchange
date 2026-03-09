'use client';

import { atomicToEGLD } from '../../lib/format';
import { useMemo } from 'react';

import { AppShell } from '../app-shell';
import { DataState } from '../data-state';
import { Panel } from '../panel';
import { UsageChart } from '../usage-chart';
import { formatCompactNumber, formatEGLD, formatLatency } from '../../lib/format';
import { useProviderEarningsQuery, useProviderProductsQuery, useViewerQuery } from '../../lib/hooks';

export function AnalyticsScreen() {
  const { data: viewer, isLoading, error } = useViewerQuery();
  const { data: providerProducts } = useProviderProductsQuery(Boolean(viewer?.provider));
  const { data: earnings } = useProviderEarningsQuery(Boolean(viewer?.provider));

  const revenueSeries = useMemo(() => {
    const buckets = new Map<string, number>();
    (earnings?.recentUsage ?? []).forEach((entry) => {
      const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(entry.occurredAt));
      buckets.set(label, (buckets.get(label) ?? 0) + atomicToEGLD(entry.amountAtomic).toNumber());
    });
    return Array.from(buckets.entries()).map(([label, value]) => ({ label, value }));
  }, [earnings?.recentUsage]);

  return (
    <AppShell>
      <div className="space-y-6">
        <Panel className="p-7">
          <div className="display-eyebrow">Publisher analytics</div>
          <h1 className="mt-4 text-4xl font-semibold md:text-5xl">Measure revenue, call flow, and provider performance</h1>
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
            </div>

            <div className="space-y-6">
              <Panel title="Top consumers" kicker="Demand surface">
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5">
                  <p className="text-sm text-sub">Consumer ranking will appear once more paid traffic lands. The current API only exposes provider-side recent usage, so this slot remains intentionally empty.</p>
                  <a href="/marketplace" className="action-button mt-4 inline-flex">Drive demand from marketplace</a>
                </div>
              </Panel>

              <Panel title="Recent provider usage" kicker="Latency heatmap">
                <DataState
                  empty={(earnings?.recentUsage ?? []).length === 0}
                  emptyTitle="No latency samples yet"
                  emptyCopy="Latency heatmap cells will fill once the gateway records enough provider executions."
                  emptyCtaHref="/publish"
                  emptyCtaLabel="Keep your listing live →"
                >
                  <div className="grid grid-cols-2 gap-3">
                    {(earnings?.recentUsage ?? []).slice(0, 8).map((entry) => (
                      <div key={entry.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted">Charge</p>
                        <p className="mt-2 font-mono text-sm text-ink">{formatEGLD(entry.amountAtomic)}</p>
                        <p className="mt-3 text-xs text-sub">Status: {entry.requestStatus}</p>
                        <p className="mt-1 text-xs text-sub">Observed: {formatLatency(null)}</p>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-surface p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="mt-2 font-mono text-lg text-ink">{value}</p>
    </div>
  );
}
