'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  activateAdminProduct,
  approveAdminProvider,
  pauseAdminProduct,
  rejectAdminProvider
} from '../../lib/api';
import { useAdminProvidersQuery, useViewerQuery } from '../../lib/hooks';
import type { AdminProviderRecord } from '../../lib/types';
import { AppShell } from '../app-shell';
import { DataState } from '../data-state';
import { Panel } from '../panel';

export function AdminScreen() {
  const queryClient = useQueryClient();
  const { data: viewer, isLoading: viewerLoading, error: viewerError } = useViewerQuery();
  const {
    data: providers,
    isLoading: providersLoading,
    error: providersError
  } = useAdminProvidersQuery(Boolean(viewer?.user?.isAdmin));
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function refreshAdminData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['viewer'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-providers'] }),
      queryClient.invalidateQueries({ queryKey: ['provider-products'] }),
      queryClient.invalidateQueries({ queryKey: ['marketplace-products'] })
    ]);
  }

  async function runAction(actionKey: string, action: () => Promise<unknown>, successMessage: string) {
    setBusyKey(actionKey);
    setMessage(null);
    setErrorMessage(null);

    try {
      await action();
      await refreshAdminData();
      setMessage(successMessage);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Admin action failed');
    } finally {
      setBusyKey(null);
    }
  }

  const isAdmin = Boolean(viewer?.user?.isAdmin);
  const dataError = (viewerError as Error | null) ?? (providersError as Error | null);

  return (
    <AppShell>
      <div className="space-y-6">
        <Panel className="p-7">
          <div className="display-eyebrow">Internal admin</div>
          <h1 className="mt-4 text-4xl font-semibold md:text-5xl">Provider and product review</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-sub md:text-lg">
            Approve provider profiles, activate pending listings, and pause products without dropping to manual API calls.
          </p>
        </Panel>

        <DataState
          isLoading={viewerLoading || providersLoading}
          error={dataError}
          empty={!viewer?.user}
          emptyTitle="Connect an admin wallet"
          emptyCopy="This internal screen requires an authenticated session before admin data can load."
        >
          {!isAdmin ? (
            <Panel className="border-gold/30">
              <p className="display-eyebrow text-gold">Access control</p>
              <h2 className="mt-3 text-2xl font-semibold text-ink">Admin privileges required</h2>
              <p className="mt-3 max-w-2xl text-sm text-sub">
                The current session is authenticated but not marked as an MX402 admin. Set the wallet in `MX402_BOOTSTRAP_ADMIN_WALLETS`
                or log in with an approved admin wallet to use this screen.
              </p>
            </Panel>
          ) : (
            <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
              <Panel title="Moderation queue" kicker="Providers and products">
                <div className="space-y-5">
                  {(providers ?? []).length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-sub">
                      No providers found. Once publishers create profiles or submit products, they will appear here.
                    </div>
                  ) : (
                    (providers ?? []).map((provider) => (
                      <ProviderModerationCard
                        key={provider.id}
                        provider={provider}
                        busyKey={busyKey}
                        onApproveProvider={() =>
                          runAction(`provider-approve:${provider.id}`, () => approveAdminProvider(provider.id), `Approved provider ${provider.displayName}.`)
                        }
                        onRejectProvider={() =>
                          runAction(`provider-reject:${provider.id}`, () => rejectAdminProvider(provider.id), `Rejected provider ${provider.displayName}.`)
                        }
                        onActivateProduct={(productId, productName) =>
                          runAction(`product-activate:${productId}`, () => activateAdminProduct(productId), `Activated product ${productName}.`)
                        }
                        onPauseProduct={(productId, productName) =>
                          runAction(`product-pause:${productId}`, () => pauseAdminProduct(productId), `Paused product ${productName}.`)
                        }
                      />
                    ))
                  )}
                </div>
              </Panel>

              <div className="space-y-6">
                <Panel title="Queue summary" kicker="Status">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Metric label="Providers" value={String(providers?.length ?? 0)} />
                    <Metric
                      label="Pending providers"
                      value={String((providers ?? []).filter((provider) => provider.status === 'pending').length)}
                    />
                    <Metric
                      label="Pending products"
                      value={String(
                        (providers ?? []).flatMap((provider) => provider.products).filter((product) => product.status === 'pending_review').length
                      )}
                    />
                    <Metric
                      label="Active products"
                      value={String(
                        (providers ?? []).flatMap((provider) => provider.products).filter((product) => product.status === 'active').length
                      )}
                    />
                  </div>
                </Panel>

                <Panel title="Latest action" kicker="Ops">
                  {message ? <p className="text-sm text-success">{message}</p> : null}
                  {errorMessage ? <p className="text-sm text-danger">{errorMessage}</p> : null}
                  {!message && !errorMessage ? <p className="text-sm text-sub">No admin action has been executed in this session.</p> : null}
                </Panel>
              </div>
            </div>
          )}
        </DataState>
      </div>
    </AppShell>
  );
}

function ProviderModerationCard({
  provider,
  busyKey,
  onApproveProvider,
  onRejectProvider,
  onActivateProduct,
  onPauseProduct
}: {
  provider: AdminProviderRecord;
  busyKey: string | null;
  onApproveProvider: () => void;
  onRejectProvider: () => void;
  onActivateProduct: (productId: string, productName: string) => void;
  onPauseProduct: (productId: string, productName: string) => void;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold text-ink">{provider.displayName}</div>
          <div className="mt-1 font-mono text-xs text-sub">{provider.slug}</div>
          <div className="mt-3 space-y-1 text-sm text-sub">
            <p>Provider status: <span className="text-ink">{provider.status}</span></p>
            <p>Payout wallet: <span className="font-mono text-ink">{provider.payoutWalletAddress}</span></p>
            <p>Owner wallet: <span className="font-mono text-ink">{provider.walletAddress}</span></p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="action-button-primary" disabled={busyKey === `provider-approve:${provider.id}`} onClick={onApproveProvider}>
            {busyKey === `provider-approve:${provider.id}` ? 'Approving…' : 'Approve'}
          </button>
          <button className="action-button" disabled={busyKey === `provider-reject:${provider.id}`} onClick={onRejectProvider}>
            {busyKey === `provider-reject:${provider.id}` ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>

      {provider.approvalNotes ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-sub">
          <div className="font-medium text-ink">Approval notes</div>
          <p className="mt-2">{provider.approvalNotes}</p>
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        <div className="display-eyebrow">Products</div>
        {provider.products.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-sub">No products linked to this provider yet.</div>
        ) : (
          provider.products.map((product) => (
            <div key={product.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div>
                <div className="text-sm font-semibold text-ink">{product.name}</div>
                <div className="mt-1 font-mono text-xs text-sub">{product.slug}</div>
                <div className="mt-2 text-xs text-sub">Status: <span className="text-ink">{product.status}</span></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="action-button-primary"
                  disabled={busyKey === `product-activate:${product.id}`}
                  onClick={() => onActivateProduct(product.id, product.name)}
                >
                  {busyKey === `product-activate:${product.id}` ? 'Activating…' : 'Activate'}
                </button>
                <button
                  className="action-button"
                  disabled={busyKey === `product-pause:${product.id}`}
                  onClick={() => onPauseProduct(product.id, product.name)}
                >
                  {busyKey === `product-pause:${product.id}` ? 'Pausing…' : 'Pause'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="font-mono text-xl text-ink">{value}</div>
      <div className="mt-2 text-xs uppercase tracking-[0.18em] text-muted">{label}</div>
    </div>
  );
}
