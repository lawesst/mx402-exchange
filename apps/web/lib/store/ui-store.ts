import { create } from 'zustand';

type BadgeFilter = 'all' | 'new' | 'verified' | 'beta';
type MethodFilter = 'all' | 'GET' | 'POST';
export type MarketplaceCategory =
  | 'all'
  | 'blockchain'
  | 'defi'
  | 'nft'
  | 'ai'
  | 'oracles'
  | 'identity'
  | 'analytics'
  | 'crosschain';

type UiState = {
  search: string;
  badge: BadgeFilter;
  method: MethodFilter;
  category: MarketplaceCategory;
  onChainOnly: boolean;
  trendingOnly: boolean;
  verifiedOnly: boolean;
  freeTierOnly: boolean;
  publishStep: number;
  walletDialogOpen: boolean;
  setSearch: (value: string) => void;
  setBadge: (value: BadgeFilter) => void;
  setMethod: (value: MethodFilter) => void;
  setCategory: (value: MarketplaceCategory) => void;
  toggleOnChainOnly: () => void;
  toggleTrendingOnly: () => void;
  toggleVerifiedOnly: () => void;
  toggleFreeTierOnly: () => void;
  setPublishStep: (value: number) => void;
  setWalletDialogOpen: (value: boolean) => void;
};

export const useMx402UiStore = create<UiState>((set) => ({
  search: '',
  badge: 'all',
  method: 'all',
  category: 'all',
  onChainOnly: true,
  trendingOnly: false,
  verifiedOnly: false,
  freeTierOnly: false,
  publishStep: 0,
  walletDialogOpen: false,
  setSearch: (value) => set({ search: value }),
  setBadge: (value) => set({ badge: value }),
  setMethod: (value) => set({ method: value }),
  setCategory: (value) => set({ category: value }),
  toggleOnChainOnly: () => set((state) => ({ onChainOnly: !state.onChainOnly })),
  toggleTrendingOnly: () => set((state) => ({ trendingOnly: !state.trendingOnly })),
  toggleVerifiedOnly: () => set((state) => ({ verifiedOnly: !state.verifiedOnly })),
  toggleFreeTierOnly: () => set((state) => ({ freeTierOnly: !state.freeTierOnly })),
  setPublishStep: (value) => set({ publishStep: value }),
  setWalletDialogOpen: (value) => set({ walletDialogOpen: value })
}));
