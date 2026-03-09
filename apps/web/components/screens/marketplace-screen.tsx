'use client';

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';

import { ActivityFeed } from '../activity-feed';
import { ApiCard } from '../api-card';
import { AppShell } from '../app-shell';
import { ChainStatus } from '../chain-status';
import { DataState } from '../data-state';
import { WalletWidget } from '../wallet-widget';
import {
  categoryLabels,
  hasFreeTier,
  inferProductCategory,
  inferProductIcon as featuredIcon,
  isProductVerified
} from '../../lib/catalog';
import { atomicToEGLD, formatCompactNumber, formatUsd } from '../../lib/format';
import { useChainOverviewQuery, useMarketplaceProductsQuery, useRecentActivityQuery } from '../../lib/hooks';
import { useMx402UiStore, type MarketplaceCategory } from '../../lib/store/ui-store';

const browseItems: Array<{ key: MarketplaceCategory; label: string; icon: string; pill?: 'new' }> = [
  { key: 'all', label: 'All APIs', icon: '⬡' },
  { key: 'blockchain', label: 'Blockchain Data', icon: '🔗' },
  { key: 'defi', label: 'DeFi & Prices', icon: '💱' },
  { key: 'nft', label: 'NFT & Tokens', icon: '🪙' },
  { key: 'ai', label: 'AI & ML', icon: '🤖', pill: 'new' },
  { key: 'oracles', label: 'Data Oracles', icon: '📡' },
  { key: 'identity', label: 'Identity & Auth', icon: '🔐' },
  { key: 'analytics', label: 'Analytics', icon: '📊' },
  { key: 'crosschain', label: 'Cross-chain', icon: '🌐' }
];

const categoryTabs: MarketplaceCategory[] = ['all', 'blockchain', 'defi', 'nft', 'ai', 'oracles', 'identity'];

const accountLinks = [
  { href: '/dashboard', label: 'Subscriptions', icon: '💎' },
  { href: '/publish', label: 'My Published', icon: '📂' },
  { href: '/dashboard', label: 'API Keys', icon: '🔑' },
  { href: '/wallet', label: 'Usage', icon: '⚡' }
];

export function MarketplaceScreen() {
  const search = useMx402UiStore((state) => state.search);
  const category = useMx402UiStore((state) => state.category);
  const onChainOnly = useMx402UiStore((state) => state.onChainOnly);
  const trendingOnly = useMx402UiStore((state) => state.trendingOnly);
  const verifiedOnly = useMx402UiStore((state) => state.verifiedOnly);
  const freeTierOnly = useMx402UiStore((state) => state.freeTierOnly);
  const setSearch = useMx402UiStore((state) => state.setSearch);
  const setCategory = useMx402UiStore((state) => state.setCategory);
  const toggleOnChainOnly = useMx402UiStore((state) => state.toggleOnChainOnly);
  const toggleTrendingOnly = useMx402UiStore((state) => state.toggleTrendingOnly);
  const toggleVerifiedOnly = useMx402UiStore((state) => state.toggleVerifiedOnly);
  const toggleFreeTierOnly = useMx402UiStore((state) => state.toggleFreeTierOnly);

  const { data: products, isLoading, error } = useMarketplaceProductsQuery();
  const { data: chain } = useChainOverviewQuery();
  const { data: activity, isLoading: activityLoading, error: activityError } = useRecentActivityQuery();

  const providerCount = useMemo(() => new Set((products ?? []).map((product) => product.provider.id)).size, [products]);
  const publishedThisWeek = useMemo(
    () => (products ?? []).filter((product) => Date.now() - new Date(product.createdAt).getTime() < 7 * 24 * 3_600_000).length,
    [products]
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<MarketplaceCategory, number>();
    browseItems.forEach((item) => counts.set(item.key, 0));

    for (const product of products ?? []) {
      const key = inferProductCategory(product);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      counts.set('all', (counts.get('all') ?? 0) + 1);
    }

    return counts;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const next = (products ?? []).filter((product) => {
      const matchesSearch = [product.name, product.shortDescription, product.provider.displayName, product.slug]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesCategory = category === 'all' || inferProductCategory(product) === category;
      const matchesVerified = !verifiedOnly || isProductVerified(product);
      const matchesFreeTier = !freeTierOnly || hasFreeTier(product);
      const matchesOnChain = !onChainOnly || true;

      return matchesSearch && matchesCategory && matchesVerified && matchesFreeTier && matchesOnChain;
    });

    next.sort((left, right) => {
      const leftTime = new Date(trendingOnly ? left.updatedAt : left.createdAt).getTime();
      const rightTime = new Date(trendingOnly ? right.updatedAt : right.createdAt).getTime();
      return rightTime - leftTime;
    });

    return next;
  }, [category, freeTierOnly, onChainOnly, products, search, trendingOnly, verifiedOnly]);

  const featuredProduct = filteredProducts[0] ?? products?.[0] ?? null;
  const featuredPrice = featuredProduct ? atomicToEGLD(featuredProduct.priceAtomic) : null;
  const featuredUsd = featuredProduct && chain ? formatUsd(featuredPrice?.multipliedBy(chain.egldUsd).toNumber() ?? 0) : null;

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-0">
        <aside className="border-white/[0.06] py-6 lg:sticky lg:top-[84px] lg:self-start lg:border-r lg:pr-4">
          <div className="space-y-2">
            <div className="sidebar-label">Browse</div>
            {browseItems.map((item) => {
              const active = category === item.key;
              const count = categoryCounts.get(item.key) ?? 0;
              return (
                <button
                  key={item.key}
                  className={`sidebar-link w-full text-left ${active ? 'sidebar-link-active' : ''}`}
                  onClick={() => setCategory(item.key)}
                  type="button"
                >
                  <span className="text-base leading-none">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.pill === 'new' ? <span className="sidebar-pill sidebar-pill-gold">New</span> : null}
                  {item.key === 'all' ? <span className="sidebar-pill">{formatCompactNumber(count)}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="mt-6 space-y-2">
            <div className="sidebar-label">Account</div>
            {accountLinks.map((item) => (
              <Link key={item.label} href={item.href} className="sidebar-link">
                <span className="text-base leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        </aside>

        <div className="min-w-0 lg:pl-6 xl:pl-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-0">
            <section className="min-w-0 py-6 xl:pr-8">
              <div className="flex flex-col gap-4 border-white/[0.06] pb-6 md:flex-row md:items-end md:justify-between">
                <div>
                  <h1 className="text-[26px] font-extrabold tracking-[-0.03em] text-ink">API Marketplace</h1>
                  <p className="mt-1 text-[13px] text-sub">
                    Pay-per-call APIs settled natively on MultiversX. No subscriptions, no lock-in.
                  </p>
                </div>
                <button className="filter-chip font-mono text-[11px] text-sub" type="button">
                  Sort: {trendingOnly ? 'Trending' : 'Latest'} ▾
                </button>
              </div>

              <div className="featured-card mt-6">
                {featuredProduct ? (
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[14px] border border-accent/20 bg-accent/10 text-[26px] text-accent">
                      {featuredIcon(featuredProduct)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[17px] font-extrabold tracking-[-0.02em] text-ink">{featuredProduct.name}</h2>
                      <p className="mt-1 text-[12.5px] leading-6 text-sub">{featuredProduct.shortDescription}</p>
                    </div>
                    <div className="flex flex-col items-start gap-2 lg:items-end">
                      <p className="font-mono text-[18px] text-accent">
                        {featuredPrice?.toFormat(4)} <span className="text-[11px] text-sub">EGLD / call</span>
                      </p>
                      <p className="font-mono text-[11px] text-sub">{featuredUsd ?? '$0.00'} equivalent</p>
                      <Link href={`/api/${featuredProduct.slug}`} className="action-button-primary text-[12px]">
                        Explore API →
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[14px] border border-accent/20 bg-accent/10 text-[26px] text-accent">
                      ⚡
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[17px] font-extrabold tracking-[-0.02em] text-ink">List the first metered API on MX402</h2>
                      <p className="mt-1 text-[12.5px] leading-6 text-sub">
                        Publish a chain-aware API endpoint, set an EGLD price per call, and make it discoverable for MultiversX builders.
                      </p>
                    </div>
                    <Link href="/publish" className="action-button-primary text-[12px]">
                      Publish API →
                    </Link>
                  </div>
                )}
              </div>

              <div className="mt-6 flex flex-col gap-3 xl:flex-row">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.35-4.35" />
                    </svg>
                  </span>
                  <input
                    className="input-shell pl-10"
                    placeholder="Search APIs, providers, endpoints…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <ToggleChip active={onChainOnly} onClick={toggleOnChainOnly}>⬡ On-chain only</ToggleChip>
                  <ToggleChip active={trendingOnly} onClick={toggleTrendingOnly}>📈 Trending</ToggleChip>
                  <ToggleChip active={verifiedOnly} onClick={toggleVerifiedOnly}>✓ Verified</ToggleChip>
                  <ToggleChip active={freeTierOnly} onClick={toggleFreeTierOnly}>🆓 Has Free Tier</ToggleChip>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {categoryTabs.map((tab) => (
                  <button
                    key={tab}
                    className={`category-chip ${category === tab ? 'category-chip-active' : ''}`}
                    onClick={() => setCategory(tab)}
                    type="button"
                  >
                    {categoryLabels[tab]}
                  </button>
                ))}
              </div>

              <div className="mt-6">
                <DataState
                  isLoading={isLoading}
                  error={error as Error | null}
                  empty={filteredProducts.length === 0}
                  emptyTitle="No APIs match the active filters"
                  emptyCopy="Try a different category, clear the search, or publish the first matching API to seed this segment."
                  emptyCtaHref="/publish"
                  emptyCtaLabel="Publish your first API →"
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {filteredProducts.map((product, index) => (
                      <ApiCard key={product.id} product={product} index={index} egldUsd={chain?.egldUsd ?? 0} />
                    ))}
                  </div>
                </DataState>
              </div>
            </section>

            <aside className="space-y-5 border-white/[0.06] py-6 xl:border-l xl:pl-5">
              <WalletWidget variant="panel" dialogEnabled={false} />

              <div>
                <div className="rp-section-label mb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted">Platform Stats</div>
                <div className="grid grid-cols-2 gap-2">
                  <StatBox label="Live APIs" value={formatCompactNumber(products?.length ?? 0)} tone="text-accent" />
                  <StatBox label="Added this week" value={`+${formatCompactNumber(publishedThisWeek)}`} tone="text-success" />
                  <StatBox label="Chain txs" value={formatCompactNumber(chain?.totalTransactions ?? 0)} />
                  <StatBox label="Publishers" value={formatCompactNumber(providerCount)} tone="text-accent" />
                </div>
              </div>

              <ChainStatus />
              <ActivityFeed items={activity ?? []} isLoading={activityLoading} error={activityError as Error | null} />
            </aside>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`filter-chip ${active ? 'filter-chip-active' : ''}`} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function StatBox({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="stats-box">
      <p className={`font-mono text-[18px] font-semibold tracking-[-0.02em] ${tone}`}>{value}</p>
      <p className="mt-1 text-[10.5px] text-muted">{label}</p>
    </div>
  );
}
