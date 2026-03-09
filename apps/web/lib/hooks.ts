'use client';

import { useQuery } from '@tanstack/react-query';

import {
  fetchChainOverview,
  fetchMarketplaceProducts,
  fetchMirrorTransactions,
  fetchProductBySlug,
  fetchProjects,
  fetchProviderEarnings,
  fetchProviderProducts,
  fetchRecentNetworkActivity,
  fetchUsageEvents,
  fetchViewer,
  fetchWalletAccount,
  fetchWalletTransactions
} from './api';

export function useChainOverviewQuery() {
  return useQuery({
    queryKey: ['chain-overview'],
    queryFn: fetchChainOverview,
    refetchInterval: 30_000
  });
}

export function useMarketplaceProductsQuery() {
  return useQuery({
    queryKey: ['marketplace-products'],
    queryFn: fetchMarketplaceProducts
  });
}

export function useProductDetailQuery(slug: string) {
  return useQuery({
    queryKey: ['product-detail', slug],
    queryFn: () => fetchProductBySlug(slug)
  });
}

export function useRecentActivityQuery() {
  return useQuery({
    queryKey: ['recent-network-activity'],
    queryFn: fetchRecentNetworkActivity,
    refetchInterval: 20_000
  });
}

export function useViewerQuery() {
  return useQuery({
    queryKey: ['viewer'],
    queryFn: fetchViewer
  });
}

export function useUsageEventsQuery(enabled = true) {
  return useQuery({
    queryKey: ['usage-events'],
    queryFn: fetchUsageEvents,
    enabled
  });
}

export function useProjectsQuery(enabled = true) {
  return useQuery({
    queryKey: ['buyer-projects'],
    queryFn: fetchProjects,
    enabled
  });
}

export function useProviderProductsQuery(enabled = true) {
  return useQuery({
    queryKey: ['provider-products'],
    queryFn: fetchProviderProducts,
    enabled
  });
}

export function useProviderEarningsQuery(enabled = true) {
  return useQuery({
    queryKey: ['provider-earnings'],
    queryFn: fetchProviderEarnings,
    enabled
  });
}

export function useWalletAccountQuery(address: string | null) {
  return useQuery({
    queryKey: ['wallet-account', address],
    queryFn: () => fetchWalletAccount(address!),
    enabled: Boolean(address),
    refetchInterval: 20_000
  });
}

export function useWalletTransactionsQuery(address: string | null) {
  return useQuery({
    queryKey: ['wallet-transactions', address],
    queryFn: () => fetchWalletTransactions(address!),
    enabled: Boolean(address)
  });
}

export function useMirrorTransactionsQuery(enabled = true) {
  return useQuery({
    queryKey: ['mirror-transactions'],
    queryFn: fetchMirrorTransactions,
    enabled
  });
}
