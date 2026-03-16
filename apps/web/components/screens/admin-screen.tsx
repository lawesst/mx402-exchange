'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  activateAdminProduct,
  approveAdminProvider,
  pauseAdminProduct,
  refreshSettlementBatches,
  rejectAdminProvider,
  retrySettlementBatch
} from '../../lib/api';
import { formatDate, formatEGLD, truncateAddress } from '../../lib/format';
import { useAdminProvidersQuery, useSettlementBatchesQuery, useViewerQuery } from '../../lib/hooks';
import type { AdminProviderRecord, SettlementBatchRecord } from '../../lib/types';
import { AppShell } from '../app-shell';
import { DataState } from '../data-state';
import { Panel } from '../panel';

function getExplorerBaseUrl() {
  return process.env.NEXT_PUBLIC_MULTIVERSX_EXPLORER_URL ?? 'https://devnet-explorer.multiversx.com';
}

export function AdminScreen() {
  const queryClient = useQueryClient();
  const { data: viewer, isLoading: viewerLoading, error: viewerError } = useViewerQuery();
  const isAdmin = Boolean(viewer?.user?.isAdmin);
  const {
    data: providers,
    isLoading: providersLoading,
    error: providersError
  } = useAdminProvidersQuery(isAdmin);
  const {
    data: settlementBatches,
    isLoading: batchesLoading,
    error: batchesError
  } = useSettlementBatchesQuery(isAdmin);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [expandedBatchIds, setExpandedBatchIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function refreshAdminData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['viewer'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-providers'] }),
      queryClient.invalidateQueries({ queryKey: ['provider-products'] }),
      queryClient.invalidateQueries({ queryKey: ['marketplace-products'] }),
      queryClient.invalidateQueries({ queryKey: ['settlement-batches'] })
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

  const dataError = (viewerError as Error | null) ?? (providersError as Error | null) ?? (batchesError as Error | null);
  const pendingProducts = (providers ?? []).flatMap((provider) => provider.products).filter((product) => product.status === 'pending_review').length;
  const activeProducts = (providers ?? []).flatMap((provider) => provider.products).filter((product) => product.status === 'active').length;
  const settlementTotals = useMemo(
    () =>
      (settlementBatches ?? []).reduce(
        (summary, batch) => {
          summary.totalDebits += BigInt(batch.totalBuyerDebitsAtomic);
          summary.totalCredits += BigInt(batch.totalProviderCreditsAtomic);
          summary.totalFees += BigInt(batch.platformFeeAtomic);
          return summary;
        },
        {
          totalDebits: 0n,
          totalCredits: 0n,
          totalFees: 0n
        }
      ),
    [settlementBatches]
  );

  function toggleBatch(batchId: string) {
    setExpandedBatchIds((current) =>
      current.includes(batchId) ? current.filter((id) => id !== batchId) : [...current, batchId]
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <Panel className="p-7">
          <div className="display-eyebrow">Internal admin</div>
          <h1 className="mt-4 text-4xl font-semibold md:text-5xl">Moderation and settlement ops</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-sub md:text-lg">
            Approve provider profiles, activate pending listings, and monitor or refresh settlement batches without dropping to manual API calls.
          </p>
        </Panel>

        <DataState
          isLoading={viewerLoading || providersLoading || batchesLoading}
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
            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
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
                    <Metric label="Pending providers" value={String((providers ?? []).filter((provider) => provider.status === 'pending').length)} />
                    <Metric label="Pending products" value={String(pendingProducts)} />
                    <Metric label="Active products" value={String(activeProducts)} />
                    <Metric label="Settled buyer debits" value={formatEGLD(settlementTotals.totalDebits.toString())} />
                    <Metric label="Settled provider credits" value={formatEGLD(settlementTotals.totalCredits.toString())} />
                  </div>
                </Panel>

                <Panel title="Settlement batches" kicker="Chain reconciliation" actions={
                  <button
                    className="action-button"
                    disabled={busyKey === 'settlement-refresh'}
                    onClick={() =>
                      void runAction(
                        'settlement-refresh',
                        () => refreshSettlementBatches(),
                        'Settlement batch statuses refreshed from chain.'
                      )
                    }
                  >
                    {busyKey === 'settlement-refresh' ? 'Refreshing…' : 'Refresh'}
                  </button>
                }>
                  <div className="space-y-3">
                    {(settlementBatches ?? []).length === 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-sub">
                        No settlement batches recorded yet.
                      </div>
                    ) : (
                      (settlementBatches ?? []).slice(0, 8).map((batch) => (
                        <SettlementBatchCard
                          key={batch.id}
                          batch={batch}
                          expanded={expandedBatchIds.includes(batch.id)}
                          busyKey={busyKey}
                          onToggle={() => toggleBatch(batch.id)}
                          onRetry={() =>
                            runAction(`settlement-retry:${batch.id}`, () => retrySettlementBatch(batch.id), `Marked batch ${batch.batchId} for retry.`)
                          }
                        />
                      ))
                    )}
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
            <p>Payout wallet: <span className="font-mono text-ink">{truncateAddress(provider.payoutWalletAddress)}</span></p>
            <p>Owner wallet: <span className="font-mono text-ink">{truncateAddress(provider.walletAddress)}</span></p>
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

function SettlementBatchCard({
  batch,
  expanded,
  busyKey,
  onToggle,
  onRetry
}: {
  batch: SettlementBatchRecord;
  expanded: boolean;
  busyKey: string | null;
  onToggle: () => void;
  onRetry: () => void;
}) {
  const explorerHref = batch.txHash ? `${getExplorerBaseUrl()}/transactions/${batch.txHash}` : null;
  const canRetry = batch.status === 'failed';

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink">{batch.batchId}</p>
          <p className="mt-1 text-xs text-sub">Created {formatDate(batch.createdAt)}</p>
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-[10px] text-sub">{batch.status}</span>
      </div>

      <div className="mt-3 grid gap-2 text-sm text-sub">
        <p>Buyer debits: <span className="font-mono text-ink">{formatEGLD(batch.totalBuyerDebitsAtomic)}</span></p>
        <p>Provider credits: <span className="font-mono text-ink">{formatEGLD(batch.totalProviderCreditsAtomic)}</span></p>
        <p>Platform fee: <span className="font-mono text-ink">{formatEGLD(batch.platformFeeAtomic)}</span></p>
        <p>Lines: <span className="text-ink">{batch.lineCount}</span></p>
        <p>Window: <span className="text-ink">{formatDate(batch.windowStartedAt)} → {formatDate(batch.windowEndedAt)}</span></p>
        <p>Submitted: <span className="text-ink">{batch.submittedAt ? formatDate(batch.submittedAt) : 'Pending'}</span></p>
        <p>Confirmed: <span className="text-ink">{batch.confirmedAt ? formatDate(batch.confirmedAt) : batch.failedAt ? `Failed ${formatDate(batch.failedAt)}` : 'Pending'}</span></p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {explorerHref ? (
          <a href={explorerHref} target="_blank" rel="noreferrer" className="action-button inline-flex">
            View tx →
          </a>
        ) : null}
        <button className="action-button" onClick={onToggle}>
          {expanded ? 'Hide lines' : 'View lines'}
        </button>
        <button className="action-button" disabled={!canRetry || busyKey === `settlement-retry:${batch.id}`} onClick={onRetry}>
          {busyKey === `settlement-retry:${batch.id}` ? 'Retrying…' : 'Retry batch'}
        </button>
      </div>

      {expanded ? (
        <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="display-eyebrow">Line items</p>
          {batch.lines.length === 0 ? (
            <p className="text-sm text-sub">No settlement lines were stored for this batch.</p>
          ) : (
            batch.lines.map((line) => (
              <div key={line.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{formatLineType(line.lineType)}</p>
                    <p className="mt-1 text-xs text-sub">Recorded {formatDate(line.createdAt)}</p>
                  </div>
                  <div className="font-mono text-sm text-ink">{formatEGLD(line.amountAtomic)}</div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-sub md:grid-cols-2">
                  <p>Usage events: <span className="text-ink">{line.sourceUsageEventCount}</span></p>
                  <p>Buyer: <span className="font-mono text-ink">{truncateAddress(line.buyerWalletAddress)}</span></p>
                  <p>Provider: <span className="text-ink">{line.providerDisplayName ?? 'Platform treasury'}</span></p>
                  <p>Provider slug: <span className="font-mono text-ink">{line.providerSlug ?? 'n/a'}</span></p>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function formatLineType(value: SettlementBatchRecord['lines'][number]['lineType']) {
  switch (value) {
    case 'buyer_debit':
      return 'Buyer debit';
    case 'provider_credit':
      return 'Provider credit';
    case 'platform_fee':
      return 'Platform fee';
    default:
      return value;
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-surface p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="mt-2 font-mono text-lg text-ink">{value}</p>
    </div>
  );
}
