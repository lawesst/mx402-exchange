'use client';

import * as Dialog from '@radix-ui/react-dialog';
import BigNumber from 'bignumber.js';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  createBuyerProject,
  createProjectApiKey,
  createProjectGrant,
  executePlaygroundCall,
  fetchUsageReceipt
} from '../lib/api';
import { atomicToEGLD, formatDate, formatEGLD, formatUsd, truncateAddress } from '../lib/format';
import { useProjectApiKeysQuery, useProjectDetailQuery, useProjectsQuery, useViewerQuery } from '../lib/hooks';
import type { CreatedProjectApiKey, ProductDetail, UsageReceipt } from '../lib/types';
import { PriceTag } from './price-tag';

function extractPathParams(template: string) {
  const matches = template.match(/\{[^}]+\}/g) ?? [];
  return matches.map((match) => match.slice(1, -1));
}

type PlaygroundResponse = {
  receiptId: string;
  productId: string;
  assetIdentifier: string;
  chargedAtomic: string;
  balanceRemainingAtomic: string;
  providerStatus: number;
  durationMs: number;
  data: unknown;
};

export function ApiPlayground({ product, egldUsd }: { product: ProductDetail; egldUsd: number }) {
  const queryClient = useQueryClient();
  const { data: viewer } = useViewerQuery();
  const { data: projects } = useProjectsQuery(Boolean(viewer?.user));
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const { data: selectedProject } = useProjectDetailQuery(selectedProjectId, Boolean(viewer?.user));
  const { data: projectApiKeys } = useProjectApiKeysQuery(selectedProjectId, Boolean(viewer?.user));

  const pathParams = useMemo(() => extractPathParams(product.upstreamPathTemplate), [product.upstreamPathTemplate]);
  const [requestCount, setRequestCount] = useState(1);
  const [projectName, setProjectName] = useState('');
  const [apiKeyName, setApiKeyName] = useState('Primary key');
  const [apiKey, setApiKey] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(pathParams.map((param) => [param, param === 'address' ? 'erd1...' : '']))
  );
  const [latestCreatedKey, setLatestCreatedKey] = useState<CreatedProjectApiKey | null>(null);
  const [latestReceipt, setLatestReceipt] = useState<UsageReceipt | null>(null);
  const [result, setResult] = useState<PlaygroundResponse | null>(null);
  const [isProjectBusy, setIsProjectBusy] = useState(false);
  const [isGrantBusy, setIsGrantBusy] = useState(false);
  const [isKeyBusy, setIsKeyBusy] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (selectedProjectId && (projects ?? []).some((project) => project.id === selectedProjectId)) {
      return;
    }

    setSelectedProjectId(projects?.[0]?.id ?? null);
  }, [projects, selectedProjectId]);

  useEffect(() => {
    setValues((current) => {
      const next = { ...current };

      for (const param of pathParams) {
        if (!(param in next)) {
          next[param] = param === 'address' ? viewer?.user?.walletAddress ?? 'erd1...' : '';
        }
      }

      for (const key of Object.keys(next)) {
        if (!pathParams.includes(key)) {
          delete next[key];
        }
      }

      return next;
    });
  }, [pathParams, viewer?.user?.walletAddress]);

  const estimatedAtomic = new BigNumber(product.priceAtomic).multipliedBy(requestCount);
  const estimatedUsd = atomicToEGLD(estimatedAtomic).multipliedBy(egldUsd).toNumber();
  const hasActiveGrant = Boolean(selectedProject?.grants.some((grant) => grant.productId === product.id));
  const canExecute = Boolean(viewer?.user && selectedProjectId && hasActiveGrant && apiKey.trim().length > 0);

  async function invalidateBuyerData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['viewer'] }),
      queryClient.invalidateQueries({ queryKey: ['buyer-projects'] }),
      queryClient.invalidateQueries({ queryKey: ['buyer-project', selectedProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['project-api-keys', selectedProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['usage-events'] })
    ]);
  }

  async function handleCreateProject() {
    if (!projectName.trim()) {
      setErrorMessage('Project name is required before access can be provisioned.');
      return;
    }

    setIsProjectBusy(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const project = await createBuyerProject({ name: projectName.trim() });
      setProjectName('');
      setSelectedProjectId(project?.id ?? null);
      await queryClient.invalidateQueries({ queryKey: ['buyer-projects'] });
      setMessage(`Created buyer project ${project?.name ?? 'project'}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create buyer project');
    } finally {
      setIsProjectBusy(false);
    }
  }

  async function handleGrantAccess() {
    if (!selectedProjectId) {
      setErrorMessage('Select or create a project before granting access.');
      return;
    }

    setIsGrantBusy(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      await createProjectGrant(selectedProjectId, { productId: product.id });
      await invalidateBuyerData();
      setMessage(`Granted ${selectedProject?.name ?? 'project'} access to ${product.name}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to grant product access');
    } finally {
      setIsGrantBusy(false);
    }
  }

  async function handleCreateApiKey() {
    if (!selectedProjectId) {
      setErrorMessage('Select or create a project before minting an API key.');
      return;
    }

    if (!apiKeyName.trim()) {
      setErrorMessage('API key label is required.');
      return;
    }

    setIsKeyBusy(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const createdKey = await createProjectApiKey(selectedProjectId, { name: apiKeyName.trim() });
      setLatestCreatedKey(createdKey ?? null);
      setApiKey(createdKey?.apiKey ?? '');
      await invalidateBuyerData();
      setMessage(`Created API key ${createdKey?.name ?? 'key'} for ${selectedProject?.name ?? 'project'}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to mint project API key');
    } finally {
      setIsKeyBusy(false);
    }
  }

  async function handleExecute() {
    if (!selectedProjectId) {
      setErrorMessage('Select a buyer project before executing a paid call.');
      return;
    }

    if (!hasActiveGrant) {
      setErrorMessage('Grant this project access to the product before executing a paid call.');
      return;
    }

    if (!apiKey.trim()) {
      setErrorMessage('Paste or create a live API key before executing the request.');
      return;
    }

    setIsBusy(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const response = (await executePlaygroundCall(
        product.id,
        {
          pathParams: values,
          query: {},
          body: null
        },
        apiKey.trim()
      )) as PlaygroundResponse;

      const receipt = response.receiptId ? await fetchUsageReceipt(response.receiptId) : null;
      setResult(response);
      setLatestReceipt(receipt);
      await invalidateBuyerData();
      setOpen(true);
      setMessage(`Paid call completed with receipt ${response.receiptId}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to execute paid call');
    } finally {
      setIsBusy(false);
    }
  }

  if (!viewer?.user) {
    return (
      <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-sub">
        Connect a buyer wallet first. Once authenticated, this panel can create a project, mint an API key, grant product access, and execute the paid call end to end.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
        <div className="display-eyebrow">Access provisioning</div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-panel/60 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-muted">Buyer wallet</p>
              <p className="mt-2 font-mono text-sm text-ink">{truncateAddress(viewer.user.walletAddress)}</p>
              <p className="mt-1 text-xs text-sub">Spendable balance: {formatEGLD(viewer.balance?.spendableAtomic)}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted">Active project</span>
                <select
                  className="input-shell"
                  value={selectedProjectId ?? ''}
                  onChange={(event) => setSelectedProjectId(event.target.value || null)}
                >
                  <option value="">Select project</option>
                  {(projects ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="self-end rounded-2xl border border-white/10 bg-panel/60 px-4 py-3 text-xs text-sub">
                {(projects ?? []).length} project(s)
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.16em] text-muted">Create new project</span>
                <input
                  className="input-shell"
                  placeholder="Trading bot"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </label>
              <button className="action-button-primary self-end" disabled={isProjectBusy} onClick={() => void handleCreateProject()}>
                {isProjectBusy ? 'Creating…' : 'Create project'}
              </button>
            </div>
          </div>

          <div className="space-y-4 rounded-3xl border border-accent/15 bg-accent/5 p-5">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted">Access state</p>
              <p className="mt-2 text-sm text-sub">
                Project: <span className="text-ink">{selectedProject?.name ?? 'None selected'}</span>
              </p>
              <p className="mt-1 text-sm text-sub">
                Grant: <span className={hasActiveGrant ? 'text-success' : 'text-gold'}>{hasActiveGrant ? 'Active' : 'Not granted'}</span>
              </p>
            </div>

            <button className="action-button w-full" disabled={!selectedProjectId || hasActiveGrant || isGrantBusy} onClick={() => void handleGrantAccess()}>
              {isGrantBusy ? 'Granting…' : hasActiveGrant ? 'Grant active' : 'Grant access to this API'}
            </button>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-xs text-sub">
              API keys are only revealed once when they are created. Existing keys can be identified by prefix below, but you must paste the full key again to execute calls from a later session.
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4 rounded-3xl border border-white/10 bg-black/20 p-5">
          <div>
            <p className="display-eyebrow">Request builder</p>
            <h3 className="mt-2 text-xl font-semibold text-ink">Provision and meter one paid request</h3>
          </div>

          {pathParams.length === 0 ? (
            <p className="text-sm text-sub">This API does not declare path params. The gateway payload will send an empty path param set.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {pathParams.map((param) => (
                <label key={param} className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted">{param}</span>
                  <input
                    className="input-shell font-mono"
                    value={values[param] ?? ''}
                    onChange={(event) => setValues((current) => ({ ...current, [param]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.16em] text-muted">Mint project API key</span>
              <input
                className="input-shell"
                placeholder="Primary key"
                value={apiKeyName}
                onChange={(event) => setApiKeyName(event.target.value)}
              />
            </label>
            <button className="action-button-primary self-end" disabled={!selectedProjectId || isKeyBusy} onClick={() => void handleCreateApiKey()}>
              {isKeyBusy ? 'Minting…' : 'Create API key'}
            </button>
          </div>

          {latestCreatedKey ? (
            <div className="rounded-2xl border border-success/20 bg-success/10 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-muted">New API key</p>
              <p className="mt-2 font-mono text-sm text-ink break-all">{latestCreatedKey.apiKey}</p>
              <p className="mt-2 text-xs text-sub">Prefix {latestCreatedKey.prefix} created {formatDate(latestCreatedKey.createdAt)}</p>
            </div>
          ) : null}

          <label className="block space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted">Active API key</span>
            <input
              className="input-shell font-mono"
              placeholder="mx402_live_..."
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>

          <div className="rounded-2xl border border-white/10 bg-panel/60 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted">Stored key prefixes</p>
            {(projectApiKeys ?? []).length === 0 ? (
              <p className="mt-3 text-sm text-sub">No API keys exist for the selected project yet.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {(projectApiKeys ?? []).map((key) => (
                  <div key={key.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                    <div>
                      <p className="text-sm text-ink">{key.name}</p>
                      <p className="font-mono text-xs text-sub">{key.prefix}</p>
                    </div>
                    <div className="text-right text-xs text-sub">
                      <p>{key.status}</p>
                      <p>{key.lastUsedAt ? `Used ${formatDate(key.lastUsedAt)}` : 'Not used yet'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
          <p className="display-eyebrow">Cost estimator</p>
          <div className="mt-4">
            <PriceTag amountAtomic={product.priceAtomic} egldUsd={egldUsd} emphasis />
          </div>
          <label className="mt-5 block space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted">Request count</span>
            <input
              className="input-shell font-mono"
              inputMode="numeric"
              value={requestCount}
              onChange={(event) => setRequestCount(Math.max(1, Number(event.target.value || 1)))}
            />
          </label>
          <div className="mt-5 rounded-2xl border border-accent/20 bg-accent/10 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-muted">Projected spend</p>
            <p className="mt-2 font-mono text-lg text-accent">{atomicToEGLD(estimatedAtomic).toFormat(4)} EGLD</p>
            <p className="mt-1 font-mono text-xs text-sub">{formatUsd(estimatedUsd)}</p>
          </div>
          <button className="action-button-primary mt-5 w-full" disabled={isBusy || !canExecute} onClick={() => void handleExecute()}>
            {isBusy ? 'Running paid call…' : 'Execute paid call'}
          </button>
          {message ? <p className="mt-3 text-sm text-success">{message}</p> : null}
          {errorMessage ? <p className="mt-3 text-sm text-danger">{errorMessage}</p> : null}
        </div>
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-white/10 bg-panel p-6 shadow-panel">
            <Dialog.Title className="text-2xl font-semibold text-ink">Paid call result</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-sub">
              This response includes the metered gateway result and the buyer receipt fetched from the API after execution.
            </Dialog.Description>

            {result ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted">Charge outcome</p>
                  <p className="mt-3 font-mono text-sm text-ink">Receipt: {result.receiptId}</p>
                  <p className="mt-2 text-sm text-sub">Charged: <span className="font-mono text-ink">{formatEGLD(result.chargedAtomic)}</span></p>
                  <p className="mt-2 text-sm text-sub">Balance remaining: <span className="font-mono text-ink">{formatEGLD(result.balanceRemainingAtomic)}</span></p>
                  <p className="mt-2 text-sm text-sub">Provider status: <span className="font-mono text-ink">{result.providerStatus}</span></p>
                  <p className="mt-2 text-sm text-sub">Latency: <span className="font-mono text-ink">{result.durationMs} ms</span></p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted">Receipt record</p>
                  {latestReceipt ? (
                    <div className="mt-3 space-y-2 text-sm text-sub">
                      <p>Created: <span className="text-ink">{formatDate(latestReceipt.createdAt)}</span></p>
                      <p>Buyer: <span className="font-mono text-ink">{truncateAddress(latestReceipt.buyerWalletAddress)}</span></p>
                      <p>Provider: <span className="font-mono text-ink">{truncateAddress(latestReceipt.providerWalletAddress)}</span></p>
                      <p>Chain batch: <span className="font-mono text-ink">{latestReceipt.chainBatchId ?? 'Pending settlement'}</span></p>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-sub">Receipt fetch did not return a detailed record yet.</p>
                  )}
                </div>
              </div>
            ) : null}

            <pre className="mt-5 max-h-[35vh] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 font-mono text-xs text-sub">{JSON.stringify(result?.data ?? result, null, 2)}</pre>

            <div className="mt-5 flex justify-end">
              <Dialog.Close asChild>
                <button className="action-button">Close</button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
