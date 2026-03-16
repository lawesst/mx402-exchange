'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  createProviderProfile,
  submitProductForReview,
  submitProviderProduct,
  updateProviderProduct,
  updateProviderProfile
} from '../../lib/api';
import { useProviderProductsQuery, useProviderProfileQuery, useViewerQuery } from '../../lib/hooks';
import type { ProviderProduct } from '../../lib/types';
import { useMx402UiStore } from '../../lib/store/ui-store';
import { AppShell } from '../app-shell';
import { DataState } from '../data-state';
import { Panel } from '../panel';
import { PublishStepper } from '../publish-stepper';

const steps = ['Metadata', 'Pricing', 'Endpoint config', 'Review + submit'];

type ProviderDraft = {
  slug: string;
  displayName: string;
  description: string;
  websiteUrl: string;
  payoutWalletAddress: string;
};

type ProductDraft = {
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  priceAtomic: string;
  upstreamMethod: 'GET' | 'POST';
  baseUrl: string;
  upstreamPathTemplate: string;
  timeoutMs: string;
  rateLimitPerMinute: string;
  originAuthMode: 'none' | 'static_header';
  originAuthHeaderName: string;
  originAuthSecret: string;
};

const emptyProviderDraft: ProviderDraft = {
  slug: '',
  displayName: '',
  description: '',
  websiteUrl: '',
  payoutWalletAddress: ''
};

const emptyProductDraft: ProductDraft = {
  slug: '',
  name: '',
  shortDescription: '',
  description: '',
  priceAtomic: '1000000000000000',
  upstreamMethod: 'GET',
  baseUrl: 'https://api.example.com',
  upstreamPathTemplate: '/v1/risk/{address}',
  timeoutMs: '5000',
  rateLimitPerMinute: '120',
  originAuthMode: 'none',
  originAuthHeaderName: '',
  originAuthSecret: ''
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function buildUniqueDraftSlug(value: string) {
  const base = slugify(value) || 'api';
  const suffix = Date.now().toString(36).slice(-4);
  return `${base}-${suffix}`.slice(0, 64);
}

function toProviderDraft(input: {
  slug: string;
  displayName: string;
  description: string | null;
  websiteUrl: string | null;
  payoutWalletAddress: string;
}): ProviderDraft {
  return {
    slug: input.slug,
    displayName: input.displayName,
    description: input.description ?? '',
    websiteUrl: input.websiteUrl ?? '',
    payoutWalletAddress: input.payoutWalletAddress
  };
}

function toProductDraft(product: ProviderProduct): ProductDraft {
  return {
    slug: product.slug,
    name: product.name,
    shortDescription: product.shortDescription,
    description: product.description ?? '',
    priceAtomic: product.priceAtomic,
    upstreamMethod: product.upstreamMethod,
    baseUrl: product.baseUrl,
    upstreamPathTemplate: product.upstreamPathTemplate,
    timeoutMs: String(product.timeoutMs),
    rateLimitPerMinute: String(product.rateLimitPerMinute),
    originAuthMode: product.originAuthMode,
    originAuthHeaderName: product.originAuthHeaderName ?? '',
    originAuthSecret: ''
  };
}

function buildProductPayload(input: ProductDraft) {
  const effectiveSlug = input.slug || buildUniqueDraftSlug(input.name);

  return {
    slug: effectiveSlug,
    name: input.name,
    shortDescription: input.shortDescription,
    description: input.description || undefined,
    baseUrl: input.baseUrl,
    upstreamPathTemplate: input.upstreamPathTemplate,
    upstreamMethod: input.upstreamMethod,
    priceAtomic: input.priceAtomic,
    timeoutMs: Number(input.timeoutMs),
    rateLimitPerMinute: Number(input.rateLimitPerMinute),
    originAuthMode: input.originAuthMode,
    originAuthHeaderName: input.originAuthMode === 'static_header' ? input.originAuthHeaderName : undefined,
    originAuthSecret:
      input.originAuthMode === 'static_header' && input.originAuthSecret.trim().length > 0
        ? input.originAuthSecret
        : undefined,
    pathParamsSchemaJson: {},
    inputSchemaJson: {},
    querySchemaJson: {},
    outputSchemaJson: {}
  };
}

export function PublishScreen() {
  const publishStep = useMx402UiStore((state) => state.publishStep);
  const setPublishStep = useMx402UiStore((state) => state.setPublishStep);
  const queryClient = useQueryClient();
  const { data: viewer, isLoading: viewerLoading, error: viewerError } = useViewerQuery();
  const {
    data: providerProfile,
    isLoading: providerLoading,
    error: providerError
  } = useProviderProfileQuery(Boolean(viewer?.user));
  const {
    data: providerProducts,
    isLoading: productsLoading,
    error: productsError
  } = useProviderProductsQuery(Boolean(viewer?.provider));

  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(emptyProviderDraft);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [providerErrorMessage, setProviderErrorMessage] = useState<string | null>(null);

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [isCreatingNewDraft, setIsCreatingNewDraft] = useState(false);
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyProductDraft);
  const [productBusy, setProductBusy] = useState(false);
  const [productMessage, setProductMessage] = useState<string | null>(null);
  const [productErrorMessage, setProductErrorMessage] = useState<string | null>(null);
  const [rotateSecret, setRotateSecret] = useState(false);

  const selectedProduct = isCreatingNewDraft
    ? null
    : (providerProducts ?? []).find((product) => product.id === selectedProductId) ??
      (providerProducts ?? []).find((product) => ['draft', 'paused'].includes(product.status)) ??
      (providerProducts ?? [])[0] ??
      null;

  useEffect(() => {
    if (providerProfile) {
      setProviderDraft(toProviderDraft(providerProfile));
    } else if (viewer?.user) {
      setProviderDraft((current) => ({
        ...current,
        payoutWalletAddress: current.payoutWalletAddress || viewer.user.walletAddress,
        slug: current.slug || slugify(viewer.user.displayName ?? 'mx402-provider'),
        displayName: current.displayName || viewer.user.displayName || ''
      }));
    }
  }, [providerProfile, viewer]);

  useEffect(() => {
    if (!providerProducts) {
      return;
    }

    if (isCreatingNewDraft) {
      return;
    }

    if (selectedProductId && providerProducts.some((product) => product.id === selectedProductId)) {
      return;
    }

    setSelectedProductId(
      providerProducts.find((product) => ['draft', 'paused'].includes(product.status))?.id ??
        providerProducts[0]?.id ??
        null
    );
  }, [isCreatingNewDraft, providerProducts, selectedProductId]);

  useEffect(() => {
    if (selectedProduct) {
      setProductDraft(toProductDraft(selectedProduct));
      setRotateSecret(false);
      return;
    }

    setProductDraft((current) => ({
      ...emptyProductDraft,
      slug: current.slug,
      name: current.name
    }));
    setRotateSecret(false);
  }, [selectedProduct]);

  const readyForPublishing = Boolean(viewer?.user && providerProfile);
  const providerSetupRequired = Boolean(viewer?.user) && !providerProfile;
  const providerDataError = providerError && (providerError as Error).message !== 'Provider profile not found' ? (providerError as Error) : null;
  const dataError = (viewerError as Error | null) ?? providerDataError ?? (productsError as Error | null);

  const providerStatusTone =
    providerProfile?.status === 'approved'
      ? 'text-success'
      : providerProfile?.status === 'pending'
        ? 'text-gold'
        : 'text-sub';

  const secretStateLabel =
    selectedProduct?.originAuthMode === 'static_header'
      ? selectedProduct.originAuthSecretConfigured
        ? rotateSecret
          ? 'Replacing upstream secret on save'
          : 'Static upstream secret configured'
        : 'Static upstream secret missing'
      : 'No upstream secret configured';

  const reviewPayload = useMemo(() => buildProductPayload(productDraft), [productDraft]);

  async function refreshProviderData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['viewer'] }),
      queryClient.invalidateQueries({ queryKey: ['provider-profile'] }),
      queryClient.invalidateQueries({ queryKey: ['provider-products'] }),
      queryClient.invalidateQueries({ queryKey: ['marketplace-products'] })
    ]);
  }

  async function handleProviderSave() {
    setProviderBusy(true);
    setProviderMessage(null);
    setProviderErrorMessage(null);

    try {
      const effectiveProviderSlug = providerDraft.slug || slugify(providerDraft.displayName);

      if (providerProfile) {
        await updateProviderProfile({
          slug: effectiveProviderSlug,
          displayName: providerDraft.displayName,
          description: providerDraft.description || undefined,
          websiteUrl: providerDraft.websiteUrl || undefined,
          payoutWalletAddress: providerDraft.payoutWalletAddress
        });
        setProviderMessage('Provider profile updated.');
      } else {
        await createProviderProfile({
          slug: effectiveProviderSlug,
          displayName: providerDraft.displayName,
          description: providerDraft.description || undefined,
          websiteUrl: providerDraft.websiteUrl || undefined,
          payoutWalletAddress: providerDraft.payoutWalletAddress
        });
        setProviderMessage('Provider profile created.');
      }

      setProviderDraft((current) => ({
        ...current,
        slug: effectiveProviderSlug
      }));

      await refreshProviderData();
    } catch (error) {
      setProviderErrorMessage(error instanceof Error ? error.message : 'Failed to save provider profile');
    } finally {
      setProviderBusy(false);
    }
  }

  function handleStartNewDraft() {
    setSelectedProductId(null);
    setIsCreatingNewDraft(true);
    setProductDraft({
      ...emptyProductDraft,
      slug: slugify(productDraft.slug || productDraft.name || 'new-api'),
      name: '',
      shortDescription: '',
      description: ''
    });
    setRotateSecret(false);
    setProductMessage(null);
    setProductErrorMessage(null);
    setPublishStep(0);
  }

  async function handleSaveDraft() {
    setProductBusy(true);
    setProductMessage(null);
    setProductErrorMessage(null);

    try {
      const normalizedDraft = {
        ...productDraft,
        slug: productDraft.slug || buildUniqueDraftSlug(productDraft.name)
      };
      const payload = buildProductPayload(normalizedDraft);

      if (selectedProduct) {
        await updateProviderProduct(selectedProduct.id, payload);
        setProductMessage('Draft updated.');
      } else {
        const created = (await submitProviderProduct(payload)) as { id: string };
        setSelectedProductId(created.id);
        setIsCreatingNewDraft(false);
        setProductMessage('Draft created.');
      }

      setProductDraft(normalizedDraft);

      await refreshProviderData();
      setRotateSecret(false);
    } catch (error) {
      setProductErrorMessage(error instanceof Error ? error.message : 'Failed to save draft');
    } finally {
      setProductBusy(false);
    }
  }

  async function handleSubmitForReview() {
    setProductBusy(true);
    setProductMessage(null);
    setProductErrorMessage(null);

    try {
      const normalizedDraft = {
        ...productDraft,
        slug: productDraft.slug || buildUniqueDraftSlug(productDraft.name)
      };
      const payload = buildProductPayload(normalizedDraft);
      let productId = selectedProduct?.id ?? null;

      if (selectedProduct) {
        await updateProviderProduct(selectedProduct.id, payload);
      } else {
        const created = (await submitProviderProduct(payload)) as { id: string };
        productId = created.id;
        setSelectedProductId(created.id);
        setIsCreatingNewDraft(false);
      }

      if (!productId) {
        throw new Error('Draft product was not created');
      }

      await submitProductForReview(productId);
      await refreshProviderData();
      setProductDraft(normalizedDraft);
      setProductMessage('Draft saved and submitted for review.');
      setRotateSecret(false);
      setPublishStep(steps.length - 1);
    } catch (error) {
      setProductErrorMessage(error instanceof Error ? error.message : 'Failed to submit for review');
    } finally {
      setProductBusy(false);
    }
  }

  const canContinue = (() => {
    if (publishStep === 0) {
      return Boolean(productDraft.name && productDraft.slug && productDraft.shortDescription);
    }

    if (publishStep === 1) {
      return Boolean(productDraft.priceAtomic);
    }

    if (publishStep === 2) {
      if (!productDraft.baseUrl || !productDraft.upstreamPathTemplate) {
        return false;
      }

      if (productDraft.originAuthMode === 'static_header') {
        if (!productDraft.originAuthHeaderName) {
          return false;
        }

        if (!selectedProduct?.originAuthSecretConfigured && !productDraft.originAuthSecret.trim()) {
          return false;
        }

        if (rotateSecret && !productDraft.originAuthSecret.trim()) {
          return false;
        }
      }

      return true;
    }

    return true;
  })();

  return (
    <AppShell>
      <div className="space-y-6">
        <Panel className="p-7">
          <div className="display-eyebrow">Provider workflow</div>
          <h1 className="mt-4 text-4xl font-semibold md:text-5xl">Publish and manage paid APIs</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-sub md:text-lg">
            Create your provider profile, save draft API products, rotate upstream secrets safely, and submit listings for review when they are ready.
          </p>
        </Panel>

        <DataState
          isLoading={viewerLoading || providerLoading || productsLoading}
          error={dataError}
          empty={!viewer?.user}
          emptyTitle="Connect a wallet to publish"
          emptyCopy="The publish workflow requires an authenticated MultiversX session before provider setup can begin."
        >
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <Panel
                title={providerSetupRequired ? 'Provider setup' : 'Provider profile'}
                kicker="Step zero"
                actions={
                  readyForPublishing ? (
                    <div className={`rounded-full border border-white/10 px-3 py-1 text-xs font-mono ${providerStatusTone}`}>
                      {providerProfile?.status}
                    </div>
                  ) : null
                }
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    label="Provider name"
                    value={providerDraft.displayName}
                    onChange={(value) => setProviderDraft((current) => ({ ...current, displayName: value, slug: current.slug || slugify(value) }))}
                    placeholder="Devnet Signal Labs"
                  />
                  <Input
                    label="Provider slug"
                    value={providerDraft.slug}
                    onChange={(value) => setProviderDraft((current) => ({ ...current, slug: slugify(value) }))}
                    placeholder="devnet-signal-labs"
                    mono
                  />
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Input
                    label="Website"
                    value={providerDraft.websiteUrl}
                    onChange={(value) => setProviderDraft((current) => ({ ...current, websiteUrl: value }))}
                    placeholder="https://example.com"
                    mono
                  />
                  <Input
                    label="Payout wallet"
                    value={providerDraft.payoutWalletAddress}
                    onChange={(value) => setProviderDraft((current) => ({ ...current, payoutWalletAddress: value }))}
                    mono
                  />
                </div>
                <div className="mt-4">
                  <Textarea
                    label="Provider description"
                    value={providerDraft.description}
                    onChange={(value) => setProviderDraft((current) => ({ ...current, description: value }))}
                    placeholder="Describe the API business, the audience, and what makes this provider credible."
                  />
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button className="action-button-primary" disabled={providerBusy} onClick={() => void handleProviderSave()}>
                    {providerBusy ? 'Saving…' : providerProfile ? 'Save provider profile' : 'Create provider profile'}
                  </button>
                  {providerMessage ? <p className="text-sm text-success">{providerMessage}</p> : null}
                  {providerErrorMessage ? <p className="text-sm text-danger">{providerErrorMessage}</p> : null}
                </div>
              </Panel>

              <Panel
                title="API listing workflow"
                kicker="Draft manager"
                actions={
                  readyForPublishing ? (
                    <button className="action-button" onClick={handleStartNewDraft}>
                      Create new draft
                    </button>
                  ) : null
                }
              >
                {!readyForPublishing ? (
                  <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-sm text-sub">
                    Create the provider profile first. Once that record exists, this panel becomes the real draft editor for product creation, updates, and review submission.
                  </div>
                ) : (
                  <div className="space-y-6">
                    <PublishStepper />

                    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
                      <div className="space-y-4">
                        {publishStep === 0 ? (
                          <>
                            <Input
                              label="API name"
                              value={productDraft.name}
                              onChange={(value) =>
                                setProductDraft((current) => ({
                                  ...current,
                                  name: value,
                                  slug: current.slug || slugify(value)
                                }))
                              }
                              placeholder="Wallet Risk Oracle"
                            />
                            <Input
                              label="API slug"
                              value={productDraft.slug}
                              onChange={(value) => setProductDraft((current) => ({ ...current, slug: slugify(value) }))}
                              placeholder="wallet-risk-oracle"
                              mono
                            />
                            <Input
                              label="Short description"
                              value={productDraft.shortDescription}
                              onChange={(value) => setProductDraft((current) => ({ ...current, shortDescription: value }))}
                              placeholder="One line that explains the value of this API."
                            />
                            <Textarea
                              label="Full description"
                              value={productDraft.description}
                              onChange={(value) => setProductDraft((current) => ({ ...current, description: value }))}
                              placeholder="Describe the API, expected consumers, and why this should exist on MX402."
                            />
                          </>
                        ) : null}

                        {publishStep === 1 ? (
                          <>
                            <Input
                              label="Price per call (atomic EGLD)"
                              value={productDraft.priceAtomic}
                              onChange={(value) => setProductDraft((current) => ({ ...current, priceAtomic: value }))}
                              mono
                            />
                            <div>
                              <p className="text-xs uppercase tracking-[0.18em] text-muted">HTTP method</p>
                              <div className="mt-2 flex gap-2">
                                {(['GET', 'POST'] as const).map((value) => (
                                  <button
                                    key={value}
                                    className={productDraft.upstreamMethod === value ? 'action-button-primary' : 'action-button'}
                                    onClick={() => setProductDraft((current) => ({ ...current, upstreamMethod: value }))}
                                  >
                                    {value}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </>
                        ) : null}

                        {publishStep === 2 ? (
                          <>
                            <Input
                              label="Base URL"
                              value={productDraft.baseUrl}
                              onChange={(value) => setProductDraft((current) => ({ ...current, baseUrl: value }))}
                              placeholder="https://api.example.com"
                              mono
                            />
                            <Input
                              label="Path template"
                              value={productDraft.upstreamPathTemplate}
                              onChange={(value) => setProductDraft((current) => ({ ...current, upstreamPathTemplate: value }))}
                              placeholder="/v1/risk/{address}"
                              mono
                            />
                            <div className="grid gap-4 md:grid-cols-2">
                              <Input
                                label="Timeout (ms)"
                                value={productDraft.timeoutMs}
                                onChange={(value) => setProductDraft((current) => ({ ...current, timeoutMs: value }))}
                                mono
                              />
                              <Input
                                label="Rate limit / minute"
                                value={productDraft.rateLimitPerMinute}
                                onChange={(value) => setProductDraft((current) => ({ ...current, rateLimitPerMinute: value }))}
                                mono
                              />
                            </div>
                            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                              <p className="text-xs uppercase tracking-[0.18em] text-muted">Upstream auth</p>
                              <div className="mt-3 flex gap-2">
                                {(['none', 'static_header'] as const).map((mode) => (
                                  <button
                                    key={mode}
                                    className={productDraft.originAuthMode === mode ? 'action-button-primary' : 'action-button'}
                                    onClick={() =>
                                      setProductDraft((current) => ({
                                        ...current,
                                        originAuthMode: mode,
                                        originAuthHeaderName: mode === 'none' ? '' : current.originAuthHeaderName,
                                        originAuthSecret: mode === 'none' ? '' : current.originAuthSecret
                                      }))
                                    }
                                  >
                                    {mode === 'none' ? 'No auth' : 'Static header'}
                                  </button>
                                ))}
                              </div>

                              {productDraft.originAuthMode === 'static_header' ? (
                                <div className="mt-4 space-y-4">
                                  <Input
                                    label="Header name"
                                    value={productDraft.originAuthHeaderName}
                                    onChange={(value) => setProductDraft((current) => ({ ...current, originAuthHeaderName: value }))}
                                    placeholder="x-api-key"
                                    mono
                                  />
                                  {selectedProduct?.originAuthSecretConfigured ? (
                                    <div className="rounded-2xl border border-gold/25 bg-gold/10 p-4 text-sm text-sub">
                                      <p className="font-medium text-ink">{secretStateLabel}</p>
                                      <p className="mt-2">
                                        The existing upstream secret stays unchanged unless you explicitly rotate it below.
                                      </p>
                                      <button className="action-button mt-4" onClick={() => setRotateSecret((current) => !current)}>
                                        {rotateSecret ? 'Keep existing secret' : 'Rotate stored secret'}
                                      </button>
                                    </div>
                                  ) : null}
                                  {rotateSecret || !selectedProduct?.originAuthSecretConfigured ? (
                                    <Input
                                      label={selectedProduct?.originAuthSecretConfigured ? 'New header secret' : 'Header secret'}
                                      value={productDraft.originAuthSecret}
                                      onChange={(value) => setProductDraft((current) => ({ ...current, originAuthSecret: value }))}
                                      placeholder="paste upstream secret"
                                      mono
                                    />
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </>
                        ) : null}

                        {publishStep === 3 ? (
                          <div className="space-y-4 rounded-3xl border border-accent/20 bg-accent/10 p-5">
                            <p className="text-sm text-sub">
                              Review the draft payload, save updates if you are still iterating, or submit the listing for review once the provider endpoint configuration is final.
                            </p>
                            <pre className="overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 font-mono text-xs text-sub">
                              {JSON.stringify(
                                {
                                  ...reviewPayload,
                                  originAuthSecret:
                                    reviewPayload.originAuthMode === 'static_header'
                                      ? reviewPayload.originAuthSecret
                                        ? '[rotate-secret]'
                                        : selectedProduct?.originAuthSecretConfigured
                                          ? '[keep-existing-secret]'
                                          : '[missing-secret]'
                                      : undefined
                                },
                                null,
                                2
                              )}
                            </pre>
                          </div>
                        ) : null}

                        <div className="flex flex-wrap justify-between gap-3">
                          <button className="action-button" disabled={publishStep === 0} onClick={() => setPublishStep(Math.max(0, publishStep - 1))}>
                            Back
                          </button>
                          <div className="flex flex-wrap gap-3">
                            <button className="action-button" disabled={productBusy} onClick={() => void handleSaveDraft()}>
                              {productBusy ? 'Saving…' : selectedProduct ? 'Save draft' : 'Create draft'}
                            </button>
                            {publishStep < steps.length - 1 ? (
                              <button className="action-button-primary" disabled={!canContinue} onClick={() => setPublishStep(Math.min(steps.length - 1, publishStep + 1))}>
                                Continue
                              </button>
                            ) : (
                              <button className="action-button-primary" disabled={productBusy} onClick={() => void handleSubmitForReview()}>
                                {productBusy ? 'Submitting…' : 'Submit for review'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <Panel title="Drafts and listings" kicker="Provider products">
                          <div className="space-y-3">
                            {(providerProducts ?? []).length === 0 ? (
                              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-sub">
                                No provider products yet. Publish your first API.
                              </div>
                            ) : (
                              (providerProducts ?? []).map((product) => {
                                const active = product.id === selectedProduct?.id;

                                return (
                                  <button
                                    key={product.id}
                                    className={`block w-full rounded-2xl border p-4 text-left transition ${active ? 'border-accent/35 bg-accent/10' : 'border-white/10 bg-white/[0.03] hover:border-white/20'}`}
                                    onClick={() => {
                                      setSelectedProductId(product.id);
                                      setIsCreatingNewDraft(false);
                                      setPublishStep(0);
                                      setProductMessage(null);
                                      setProductErrorMessage(null);
                                    }}
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="text-sm font-semibold text-ink">{product.name}</div>
                                      <div className="rounded-full border border-white/10 px-2 py-1 font-mono text-[11px] text-sub">{product.status}</div>
                                    </div>
                                    <div className="mt-2 text-xs text-sub">{product.slug}</div>
                                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
                                      <span>{product.upstreamMethod}</span>
                                      <span>{product.priceAtomic} atomic</span>
                                      {product.originAuthMode === 'static_header' ? <span>static auth</span> : null}
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </Panel>

                        <Panel title="Workflow status" kicker="Readiness">
                          <div className="space-y-3 text-sm text-sub">
                            <p>
                              Wallet session: <span className="text-ink">{viewer?.user ? 'Authenticated' : 'Missing'}</span>
                            </p>
                            <p>
                              Provider profile: <span className="text-ink">{providerProfile ? providerProfile.displayName : 'Missing'}</span>
                            </p>
                            <p>
                              Provider status: <span className={providerStatusTone}>{providerProfile?.status ?? 'not created'}</span>
                            </p>
                            <p>
                              Active draft: <span className="text-ink">{selectedProduct?.name ?? 'New unsaved draft'}</span>
                            </p>
                            <p>
                              Secret state: <span className="text-ink">{secretStateLabel}</span>
                            </p>
                          </div>
                          {providerProfile?.approvalNotes ? (
                            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-sub">
                              <div className="font-medium text-ink">Approval notes</div>
                              <p className="mt-2">{providerProfile.approvalNotes}</p>
                            </div>
                          ) : null}
                        </Panel>

                        <Panel title="Submission status" kicker="Latest action">
                          {productMessage ? <p className="text-sm text-success">{productMessage}</p> : null}
                          {productErrorMessage ? <p className="text-sm text-danger">{productErrorMessage}</p> : null}
                          {!productMessage && !productErrorMessage ? (
                            <p className="text-sm text-sub">No draft action has been sent in this session.</p>
                          ) : null}
                        </Panel>
                      </div>
                    </div>
                  </div>
                )}
              </Panel>
            </div>

            <div className="space-y-6">
              <Panel title="What changed" kicker="MVP path">
                <div className="space-y-3 text-sm text-sub">
                  <p>The publish page now works against the real provider routes instead of a blind one-shot create call.</p>
                  <p>Draft products can be created, reloaded, updated, and submitted for review from one surface.</p>
                  <p>Static upstream auth secrets stay hidden after initial save and only change when you rotate them explicitly.</p>
                </div>
              </Panel>

              <Panel title="Review target" kicker="Backend routes">
                <div className="space-y-2 font-mono text-xs text-sub">
                  <p>/v1/providers</p>
                  <p>/v1/providers/me</p>
                  <p>/v1/providers/me/products</p>
                  <p>/v1/providers/me/products/:productId</p>
                  <p>/v1/providers/me/products/:productId/submit</p>
                </div>
              </Panel>
            </div>
          </div>
        </DataState>
      </div>
    </AppShell>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  mono = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs uppercase tracking-[0.18em] text-muted">{label}</span>
      <input className={`input-shell ${mono ? 'font-mono' : ''}`} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs uppercase tracking-[0.18em] text-muted">{label}</span>
      <textarea className="input-shell min-h-40 resize-none" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}
