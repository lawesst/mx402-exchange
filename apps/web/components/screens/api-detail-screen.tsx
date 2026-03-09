'use client';

import { AppShell } from '../app-shell';
import { ApiPlayground } from '../api-playground';
import { ChainStatus } from '../chain-status';
import { DataState } from '../data-state';
import { Panel } from '../panel';
import { PriceTag } from '../price-tag';
import { useChainOverviewQuery, useProductDetailQuery } from '../../lib/hooks';

export function ApiDetailScreen({ slug }: { slug: string }) {
  const { data: product, isLoading, error } = useProductDetailQuery(slug);
  const { data: chain } = useChainOverviewQuery();

  return (
    <AppShell>
      <DataState
        isLoading={isLoading}
        error={error as Error | null}
        empty={!product}
        emptyTitle="API listing not found"
        emptyCopy="This slug is not active in the MX402 registry right now. Return to the marketplace or publish a new endpoint."
        emptyCtaHref="/marketplace"
        emptyCtaLabel="Back to marketplace →"
      >
        {product ? (
          <div className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
              <Panel className="p-7">
                <div className="display-eyebrow">API detail</div>
                <h1 className="mt-4 text-4xl font-semibold md:text-5xl">{product.name}</h1>
                <p className="mt-3 max-w-3xl text-base leading-7 text-sub md:text-lg">{product.description || product.shortDescription}</p>
                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <PriceTag amountAtomic={product.priceAtomic} egldUsd={chain?.egldUsd ?? 0} emphasis />
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-xs text-sub">{product.upstreamMethod}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.16em] text-sub">{product.provider.displayName}</span>
                </div>
              </Panel>
              <ChainStatus />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-6">
                <Panel title="Integration docs" kicker="Request contract">
                  <div className="space-y-4 text-sm leading-7 text-sub">
                    <p>Endpoint template: <span className="font-mono text-ink">{product.upstreamPathTemplate}</span></p>
                    <p>Base URL: <span className="font-mono text-ink">{product.baseUrl}</span></p>
                    <p>Timeout budget: <span className="font-mono text-ink">{product.timeoutMs} ms</span></p>
                    <p>Rate limit: <span className="font-mono text-ink">{product.rateLimitPerMinute} req/min</span></p>
                    <p>
                      Billing model: one EGLD-denominated charge is recorded per successful request. Gateway reservations protect provider settlement before upstream forwarding.
                    </p>
                  </div>
                </Panel>

                <Panel title="Reviews" kicker="Reputation surface">
                  <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5">
                    <p className="text-sm text-sub">No reviews on this listing yet. The first builders to integrate can leave quality notes after a successful paid call.</p>
                    <a href="/marketplace" className="action-button mt-4 inline-flex">Find another API</a>
                  </div>
                </Panel>
              </div>

              <div className="space-y-6">
                <Panel title="Live playground" kicker="Metered execution">
                  <ApiPlayground product={product} egldUsd={chain?.egldUsd ?? 0} />
                </Panel>
                <Panel title="Publisher info" kicker="Counterparty">
                  <div className="space-y-3 text-sm text-sub">
                    <p>Publisher: <span className="text-ink">{product.provider.displayName}</span></p>
                    <p>Provider slug: <span className="font-mono text-ink">{product.provider.slug}</span></p>
                    <p>The provider is routed through the MX402 gateway and only receives settlement after metered execution is recorded.</p>
                  </div>
                </Panel>
              </div>
            </div>
          </div>
        ) : null}
      </DataState>
    </AppShell>
  );
}
