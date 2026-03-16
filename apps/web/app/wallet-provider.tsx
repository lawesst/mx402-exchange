'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { ProviderTypeEnum } from '@multiversx/sdk-dapp/out/providers/types/providerFactory.types';

import { createSessionWithNativeAuth, logoutSession } from '../lib/api';
import { useViewerQuery } from '../lib/hooks';
import {
  connectWallet,
  disconnectWallet,
  ensureDappReady,
  getCanonicalWalletOrigin,
  getConnectedWallet,
  shouldRedirectToCanonicalWalletOrigin
} from '../lib/multiversx';
import type { WalletConnection } from '../lib/types';

type ConnectProviderType = typeof ProviderTypeEnum.extension | typeof ProviderTypeEnum.crossWindow;

type WalletContextValue = {
  wallet: WalletConnection;
  isBooting: boolean;
  isBusy: boolean;
  errorMessage: string | null;
  noticeMessage: string | null;
  connect: (providerType: ConnectProviderType) => Promise<void>;
  disconnect: () => Promise<void>;
  clearError: () => void;
  clearNotice: () => void;
};

const initialWalletState: WalletConnection = {
  address: null,
  providerType: null,
  nativeAuthToken: null,
  networkAccountMissing: false,
  warningMessage: null
};

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletConnection>(initialWalletState);
  const [isBooting, setIsBooting] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const viewerQuery = useViewerQuery();
  const viewer = viewerQuery.data;
  const bootstrappedRef = useRef(false);
  const sessionSyncInFlightRef = useRef(false);

  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }

    bootstrappedRef.current = true;
    let active = true;

    async function bootstrap() {
      if (shouldRedirectToCanonicalWalletOrigin()) {
        const redirectUrl = `${getCanonicalWalletOrigin()}${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.replace(redirectUrl);
        return;
      }

      try {
        await ensureDappReady();
        const connected = await getConnectedWallet();
        if (active) {
          setWallet(connected);
          setNoticeMessage(connected.warningMessage ?? null);
        }
      } catch (error) {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : 'Failed to restore wallet state');
        }
      } finally {
        if (active) {
          setIsBooting(false);
        }
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const shouldSyncSession =
      Boolean(wallet.nativeAuthToken) &&
      !viewerQuery.isFetching &&
      (!viewer?.user || viewer.user.walletAddress !== wallet.address);

    if (!shouldSyncSession || sessionSyncInFlightRef.current || !wallet.nativeAuthToken) {
      return;
    }

    sessionSyncInFlightRef.current = true;

    void createSessionWithNativeAuth({ nativeAuthToken: wallet.nativeAuthToken })
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ['viewer'] });
      })
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to sync wallet session');
      })
      .finally(() => {
        sessionSyncInFlightRef.current = false;
      });
  }, [queryClient, viewer?.user, viewerQuery.isFetching, wallet.address, wallet.nativeAuthToken]);

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const clearNotice = useCallback(() => {
    setNoticeMessage(null);
  }, []);

  const connect = useCallback(
    async (providerType: ConnectProviderType) => {
      setIsBusy(true);
      setErrorMessage(null);
      setNoticeMessage(null);

      try {
        const result = await connectWallet(providerType);
        setWallet(result);
        setNoticeMessage(result.warningMessage ?? null);

        const isCrossWindowRedirectInProgress =
          providerType === ProviderTypeEnum.crossWindow && (!result.address || !result.nativeAuthToken);

        if (isCrossWindowRedirectInProgress) {
          return;
        }

        if (!result.nativeAuthToken) {
          throw new Error('Native Auth token missing after wallet login');
        }

        await createSessionWithNativeAuth({ nativeAuthToken: result.nativeAuthToken });
        await queryClient.invalidateQueries({ queryKey: ['viewer'] });
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to connect wallet');
        throw error;
      } finally {
        setIsBusy(false);
      }
    },
    [queryClient]
  );

  const disconnect = useCallback(async () => {
    setIsBusy(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      await logoutSession().catch(() => undefined);
      await disconnectWallet();
      setWallet(initialWalletState);
      await queryClient.invalidateQueries({ queryKey: ['viewer'] });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to disconnect wallet');
      throw error;
    } finally {
      setIsBusy(false);
    }
  }, [queryClient]);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallet,
      isBooting,
      isBusy,
      errorMessage,
      noticeMessage,
      connect,
      disconnect,
      clearError,
      clearNotice
    }),
    [wallet, isBooting, isBusy, errorMessage, noticeMessage, connect, disconnect, clearError, clearNotice]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWalletController() {
  const context = useContext(WalletContext);

  if (!context) {
    throw new Error('useWalletController must be used within WalletProvider');
  }

  return context;
}
