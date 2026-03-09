'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

import { atomicToEGLD, formatDate, formatUsd } from '../lib/format';
import type { MarketplaceProduct } from '../lib/types';
import { inferIconTone, inferProductIcon, resolveProductBadges } from '../lib/catalog';

function badgeToneClasses(tone: 'hot' | 'new' | 'verified' | 'beta') {
  switch (tone) {
    case 'hot':
      return 'border-danger/20 bg-danger/10 text-danger';
    case 'new':
      return 'border-gold/20 bg-gold/10 text-gold';
    case 'beta':
      return 'border-blue/20 bg-blue/10 text-blue';
    case 'verified':
    default:
      return 'border-success/20 bg-success/10 text-success';
  }
}

export function ApiCard({ product, egldUsd, index }: { product: MarketplaceProduct; egldUsd: number; index: number }) {
  const badges = resolveProductBadges(product);
  const amount = atomicToEGLD(product.priceAtomic);
  const usdValue = amount.multipliedBy(egldUsd).toNumber();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className="h-full"
    >
      <Link
        href={`/api/${product.slug}`}
        className="group relative flex h-full flex-col overflow-hidden rounded-[12px] border border-white/[0.06] bg-panel p-5 transition hover:-translate-y-0.5 hover:border-accent/25 hover:shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_0_1px_rgba(35,247,221,0.08)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(35,247,221,0)_0%,rgba(35,247,221,0.03)_100%)] opacity-0 transition group-hover:opacity-100" />

        <div className="relative flex items-start justify-between gap-4">
          <div className={`flex h-[42px] w-[42px] items-center justify-center rounded-[10px] text-[20px] ${inferIconTone(product)}`}>
            {inferProductIcon(product)}
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {badges.map((badge) => (
              <span
                key={badge.label}
                className={`rounded px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.04em] ${badgeToneClasses(badge.tone)}`}
              >
                {badge.label}
              </span>
            ))}
          </div>
        </div>

        <div className="relative mt-4">
          <h3 className="text-[15px] font-bold tracking-[-0.01em] text-ink">{product.name}</h3>
          <p className="mt-1 font-mono text-[11.5px] text-sub">by {product.provider.displayName}</p>
          <p className="mt-3 line-clamp-2 text-[12.5px] leading-6 text-sub">{product.shortDescription}</p>
        </div>

        <div className="relative mt-auto pt-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[15px] font-semibold text-accent">{amount.toFormat(4)} <span className="text-[10px] text-sub">EGLD</span></p>
              <p className="mt-1 font-mono text-[10px] text-muted">{usdValue > 0 ? `${formatUsd(usdValue)} / call` : 'Free tier'}</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="font-mono text-[12px] font-semibold text-ink">{product.upstreamMethod}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.04em] text-muted">method</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[12px] font-semibold text-ink">{product.status === 'ACTIVE' ? 'Live' : product.status}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.04em] text-muted">status</p>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
            <span className="font-mono text-[10px] text-muted">Listed {formatDate(product.createdAt)}</span>
            <span className="font-mono text-[10px] text-accent">/{product.slug}</span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
