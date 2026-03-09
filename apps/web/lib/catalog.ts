import BigNumber from 'bignumber.js';

import type { MarketplaceProduct } from './types';
import type { MarketplaceCategory } from './store/ui-store';

const categoryKeywordMap: Array<{ category: MarketplaceCategory; keywords: string[] }> = [
  { category: 'crosschain', keywords: ['cross-chain', 'cross chain', 'bridge', 'wrapped', 'interop'] },
  { category: 'identity', keywords: ['identity', 'auth', 'did', 'kyc', 'kyb', 'verify', 'verification'] },
  { category: 'oracles', keywords: ['oracle', 'feed', 'stream', 'events'] },
  { category: 'ai', keywords: ['ai', 'ml', 'model', 'risk', 'score', 'agent'] },
  { category: 'nft', keywords: ['nft', 'token', 'collection', 'metadata', 'esdt'] },
  { category: 'defi', keywords: ['defi', 'price', 'swap', 'dex', 'liquidity', 'pool', 'staking'] },
  { category: 'analytics', keywords: ['analytics', 'latency', 'insight', 'dashboard', 'metrics', 'volume'] },
  { category: 'blockchain', keywords: ['block', 'transaction', 'contract', 'wallet', 'shard', 'indexer', 'explorer'] }
];

export const categoryLabels: Record<MarketplaceCategory, string> = {
  all: 'All',
  blockchain: 'Blockchain Data',
  defi: 'DeFi & Prices',
  nft: 'NFT & Tokens',
  ai: 'AI / ML',
  oracles: 'Oracles',
  identity: 'Identity',
  analytics: 'Analytics',
  crosschain: 'Cross-chain'
};

export function inferProductCategory(product: MarketplaceProduct): MarketplaceCategory {
  const haystack = [product.name, product.shortDescription, product.description, product.slug]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const match = categoryKeywordMap.find((entry) => entry.keywords.some((keyword) => haystack.includes(keyword)));
  return match?.category ?? 'blockchain';
}

export function inferProductIcon(product: MarketplaceProduct) {
  const category = inferProductCategory(product);

  switch (category) {
    case 'blockchain':
      return '🔗';
    case 'defi':
      return '💱';
    case 'nft':
      return '🪙';
    case 'ai':
      return '🤖';
    case 'oracles':
      return '📡';
    case 'identity':
      return '🔐';
    case 'analytics':
      return '📊';
    case 'crosschain':
      return '🌐';
    default:
      return '⬡';
  }
}

export function inferIconTone(product: MarketplaceProduct) {
  const category = inferProductCategory(product);

  switch (category) {
    case 'defi':
      return 'bg-gold/10 text-gold';
    case 'nft':
      return 'bg-danger/10 text-danger';
    case 'ai':
    case 'crosschain':
      return 'bg-blue/10 text-blue';
    case 'identity':
      return 'bg-success/10 text-success';
    case 'oracles':
      return 'bg-success/8 text-success';
    default:
      return 'bg-accent/10 text-accent';
  }
}

export function isProductNew(product: MarketplaceProduct) {
  return Date.now() - new Date(product.createdAt).getTime() < 7 * 24 * 3_600_000;
}

export function isProductBeta(product: MarketplaceProduct) {
  return product.baseUrl?.includes('devnet') ?? false;
}

export function isProductHot(product: MarketplaceProduct) {
  const haystack = [product.name, product.shortDescription, product.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return ['price', 'feed', 'oracle', 'stream', 'explorer', 'events'].some((keyword) => haystack.includes(keyword));
}

export function isProductVerified(product: MarketplaceProduct) {
  return product.status.toUpperCase() === 'ACTIVE';
}

export function hasFreeTier(product: MarketplaceProduct) {
  return new BigNumber(product.priceAtomic).isZero();
}

export function resolveProductBadges(product: MarketplaceProduct) {
  const badges: Array<{ label: string; tone: 'hot' | 'new' | 'verified' | 'beta' }> = [];

  if (isProductVerified(product)) {
    badges.push({ label: 'Verified', tone: 'verified' });
  }

  if (isProductNew(product)) {
    badges.push({ label: 'New', tone: 'new' });
  }

  if (isProductHot(product)) {
    badges.push({ label: 'Hot', tone: 'hot' });
  }

  if (isProductBeta(product)) {
    badges.push({ label: 'Beta', tone: 'beta' });
  }

  return badges.slice(0, 2);
}
