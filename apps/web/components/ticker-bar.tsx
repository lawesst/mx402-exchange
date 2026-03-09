'use client';

import { atomicToEGLD, formatCompactNumber, formatUsd } from '../lib/format';
import { useChainOverviewQuery, useMarketplaceProductsQuery } from '../lib/hooks';

export function TickerBar() {
  const { data: chain } = useChainOverviewQuery();
  const { data: products } = useMarketplaceProductsQuery();

  const items = [
    {
      name: 'EGLD/USD',
      price: chain ? formatUsd(chain.egldUsd) : 'Loading',
      status: chain?.networkHealth === 'healthy' ? 'healthy' : 'syncing',
      tone: chain?.networkHealth === 'healthy' ? 'text-success' : 'text-danger'
    },
    {
      name: 'Epoch',
      price: chain ? formatCompactNumber(chain.epoch) : 'Loading',
      status: chain ? `${formatCompactNumber(chain.averageTps)} TPS` : 'syncing',
      tone: 'text-accent'
    },
    ...((products ?? []).slice(0, 5).map((product) => ({
      name: product.name,
      price: `${atomicToEGLD(product.priceAtomic).toFormat(4)} EGLD`,
      status: product.status === 'ACTIVE' ? product.upstreamMethod : product.status,
      tone: product.status === 'ACTIVE' ? 'text-success' : 'text-sub'
    })))
  ];

  const tickerItems = [...items, ...items];

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex h-9 items-center border-t border-white/[0.06] bg-background/95 backdrop-blur">
      <div className="flex h-full items-center bg-accent px-3.5 text-[10px] font-extrabold uppercase tracking-[0.1em] text-background">
        Live
      </div>
      <div className="ticker-mask flex-1 overflow-hidden">
        <div className="flex w-max animate-marquee gap-10 px-5">
          {tickerItems.map((item, index) => (
            <div key={`${item.name}-${index}`} className="flex items-center gap-2 whitespace-nowrap font-mono text-[11px] text-sub">
              <span className="font-medium text-ink">{item.name}</span>
              <span className="text-muted">·</span>
              <span className="text-ink">{item.price}</span>
              <span className={item.tone}>{item.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
