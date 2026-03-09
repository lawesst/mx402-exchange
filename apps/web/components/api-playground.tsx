'use client';

import * as Dialog from '@radix-ui/react-dialog';
import BigNumber from 'bignumber.js';
import { useMemo, useState } from 'react';

import { executePlaygroundCall } from '../lib/api';
import { atomicToEGLD, formatUsd } from '../lib/format';
import type { ProductDetail } from '../lib/types';
import { PriceTag } from './price-tag';

function extractPathParams(template: string) {
  const matches = template.match(/\{[^}]+\}/g) ?? [];
  return matches.map((match) => match.slice(1, -1));
}

export function ApiPlayground({ product, egldUsd }: { product: ProductDetail; egldUsd: number }) {
  const pathParams = useMemo(() => extractPathParams(product.upstreamPathTemplate), [product.upstreamPathTemplate]);
  const [requestCount, setRequestCount] = useState(1);
  const [apiKey, setApiKey] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(pathParams.map((param) => [param, param === 'address' ? 'erd1...' : '']))
  );
  const [isBusy, setIsBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const estimatedAtomic = new BigNumber(product.priceAtomic).multipliedBy(requestCount);
  const estimatedUsd = atomicToEGLD(estimatedAtomic).multipliedBy(egldUsd).toNumber();

  async function handleExecute() {
    setIsBusy(true);
    setErrorMessage(null);

    try {
      const response = await executePlaygroundCall(
        product.id,
        {
          pathParams: values,
          query: {},
          body: null
        },
        apiKey
      );
      setResult(response);
      setOpen(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to execute paid call');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4 rounded-3xl border border-white/10 bg-black/20 p-5">
          <div>
            <p className="display-eyebrow">Request builder</p>
            <h3 className="mt-2 text-xl font-semibold text-ink">Meter one paid request</h3>
          </div>

          {pathParams.length === 0 ? (
            <p className="text-sm text-sub">This API does not declare path params. The current gateway payload will send an empty path param set.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {pathParams.map((param) => (
                <label key={param} className="space-y-2">
                  <span className="text-xs uppercase tracking-[0.16em] text-muted">{param}</span>
                  <input className="input-shell font-mono" value={values[param] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [param]: event.target.value }))} />
                </label>
              ))}
            </div>
          )}

          <label className="block space-y-2">
            <span className="text-xs uppercase tracking-[0.16em] text-muted">Project API key</span>
            <input className="input-shell font-mono" placeholder="mx402_live_..." value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
          </label>
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
          <button className="action-button-primary mt-5 w-full" disabled={isBusy || !apiKey} onClick={() => void handleExecute()}>
            {isBusy ? 'Running paid call…' : 'Execute paid call'}
          </button>
          {errorMessage ? <p className="mt-3 text-sm text-danger">{errorMessage}</p> : null}
        </div>
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-white/10 bg-panel p-6 shadow-panel">
            <Dialog.Title className="text-2xl font-semibold text-ink">Playground response</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-sub">
              This modal uses the gateway response directly. If you supplied a valid project API key, the receipt and charge details will be reflected below.
            </Dialog.Description>
            <pre className="mt-5 max-h-[55vh] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 font-mono text-xs text-sub">{JSON.stringify(result, null, 2)}</pre>
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
