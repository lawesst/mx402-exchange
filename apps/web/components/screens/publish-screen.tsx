'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { submitProductForReview, submitProviderProduct } from '../../lib/api';
import { useViewerQuery } from '../../lib/hooks';
import { useMx402UiStore } from '../../lib/store/ui-store';
import { AppShell } from '../app-shell';
import { DataState } from '../data-state';
import { Panel } from '../panel';
import { PublishStepper } from '../publish-stepper';

const steps = ['Metadata', 'Pricing', 'Endpoint config', 'Deploy contract'];

export function PublishScreen() {
  const publishStep = useMx402UiStore((state) => state.publishStep);
  const setPublishStep = useMx402UiStore((state) => state.setPublishStep);
  const { data: viewer, isLoading, error } = useViewerQuery();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [priceAtomic, setPriceAtomic] = useState('10000000000000000');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [baseUrl, setBaseUrl] = useState('https://api.example.com');
  const [pathTemplate, setPathTemplate] = useState('/v1/risk/{address}');
  const [timeoutMs, setTimeoutMs] = useState('5000');
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState('120');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const draftPayload = useMemo(
    () => ({
      slug,
      name,
      shortDescription: description.slice(0, 220) || 'MultiversX metered API listing',
      description,
      baseUrl,
      upstreamPathTemplate: pathTemplate,
      upstreamMethod: method,
      priceAtomic,
      timeoutMs: Number(timeoutMs),
      rateLimitPerMinute: Number(rateLimitPerMinute),
      originAuthMode: 'none',
      pathParamsSchemaJson: {},
      inputSchemaJson: {},
      querySchemaJson: {},
      outputSchemaJson: {}
    }),
    [baseUrl, description, method, name, pathTemplate, priceAtomic, rateLimitPerMinute, slug, timeoutMs]
  );

  async function handleSubmit() {
    setBusy(true);
    setErrorMessage(null);
    setNotice(null);

    try {
      const created = await submitProviderProduct(draftPayload) as { id: string };
      await submitProductForReview(created.id);
      await queryClient.invalidateQueries({ queryKey: ['provider-products'] });
      await queryClient.invalidateQueries({ queryKey: ['marketplace-products'] });
      setNotice('API listing created and submitted for review.');
      setPublishStep(0);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to publish API');
    } finally {
      setBusy(false);
    }
  }

  const canPublish = Boolean(viewer?.provider);

  return (
    <AppShell>
      <div className="space-y-6">
        <Panel className="p-7">
          <div className="display-eyebrow">Publisher flow</div>
          <h1 className="mt-4 text-4xl font-semibold md:text-5xl">List a new API on MX402</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-sub md:text-lg">
            Move from metadata to endpoint config, then register the listing for on-chain metering review.
          </p>
        </Panel>

        <PublishStepper />

        <DataState
          isLoading={isLoading}
          error={error as Error | null}
          empty={false}
        >
          <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <Panel title={steps[publishStep]} kicker="Wizard step">
              <div className="space-y-4">
                {publishStep === 0 ? (
                  <>
                    <Input label="API name" value={name} onChange={setName} placeholder="Wallet Risk Oracle" />
                    <Input label="Slug" value={slug} onChange={setSlug} placeholder="wallet-risk-oracle" mono />
                    <Textarea label="Description" value={description} onChange={setDescription} placeholder="Describe the problem this API solves for MultiversX builders." />
                  </>
                ) : null}

                {publishStep === 1 ? (
                  <>
                    <Input label="Price per call (atomic EGLD)" value={priceAtomic} onChange={setPriceAtomic} mono />
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted">Method</p>
                      <div className="mt-2 flex gap-2">
                        {(['GET', 'POST'] as const).map((value) => (
                          <button key={value} className={method === value ? 'action-button-primary' : 'action-button'} onClick={() => setMethod(value)}>
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}

                {publishStep === 2 ? (
                  <>
                    <Input label="Base URL" value={baseUrl} onChange={setBaseUrl} mono />
                    <Input label="Path template" value={pathTemplate} onChange={setPathTemplate} mono />
                    <div className="grid gap-4 md:grid-cols-2">
                      <Input label="Timeout (ms)" value={timeoutMs} onChange={setTimeoutMs} mono />
                      <Input label="Rate limit / minute" value={rateLimitPerMinute} onChange={setRateLimitPerMinute} mono />
                    </div>
                  </>
                ) : null}

                {publishStep === 3 ? (
                  <div className="space-y-4 rounded-3xl border border-accent/20 bg-accent/10 p-5">
                    <p className="text-sm text-sub">
                      Final step: register the API listing and submit it for review. The current MVP creates the provider product record and moves it to <span className="font-mono text-ink">pending_review</span>.
                    </p>
                    <pre className="overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 font-mono text-xs text-sub">{JSON.stringify(draftPayload, null, 2)}</pre>
                  </div>
                ) : null}
              </div>

              <div className="mt-6 flex flex-wrap justify-between gap-3">
                <button className="action-button" disabled={publishStep === 0} onClick={() => setPublishStep(Math.max(0, publishStep - 1))}>
                  Back
                </button>
                {publishStep < steps.length - 1 ? (
                  <button className="action-button-primary" onClick={() => setPublishStep(Math.min(steps.length - 1, publishStep + 1))}>
                    Continue
                  </button>
                ) : (
                  <button className="action-button-primary" disabled={!canPublish || busy} onClick={() => void handleSubmit()}>
                    {busy ? 'Submitting…' : 'Register listing'}
                  </button>
                )}
              </div>
            </Panel>

            <div className="space-y-6">
              <Panel title="Publisher readiness" kicker="Gate checks">
                <div className="space-y-3 text-sm text-sub">
                  <p>Wallet session: <span className="text-ink">{viewer?.user ? 'Authenticated' : 'Not authenticated'}</span></p>
                  <p>Provider profile: <span className="text-ink">{viewer?.provider ? viewer.provider.displayName : 'Missing'}</span></p>
                  <p>Submission path: <span className="font-mono text-ink">/v1/providers/me/products</span></p>
                </div>
                {!viewer?.provider ? (
                  <a href="/dashboard" className="action-button mt-5 inline-flex">Open dashboard for provider setup</a>
                ) : null}
              </Panel>
              <Panel title="Status" kicker="Submission">
                {notice ? <p className="text-sm text-success">{notice}</p> : null}
                {errorMessage ? <p className="text-sm text-danger">{errorMessage}</p> : null}
                {!notice && !errorMessage ? <p className="text-sm text-sub">No submission has been sent yet.</p> : null}
              </Panel>
            </div>
          </div>
        </DataState>
      </div>
    </AppShell>
  );
}

function Input({ label, value, onChange, placeholder, mono = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs uppercase tracking-[0.18em] text-muted">{label}</span>
      <input className={`input-shell ${mono ? 'font-mono' : ''}`} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Textarea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs uppercase tracking-[0.18em] text-muted">{label}</span>
      <textarea className="input-shell min-h-40 resize-none" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}
