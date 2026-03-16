'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';

import { fetchProjectApiKeys, fetchProjectDetail } from '../../lib/api';
import { AppShell } from '../app-shell';
import { DataState } from '../data-state';
import { Panel } from '../panel';
import { UsageChart } from '../usage-chart';
import { formatCompactNumber, formatDate, formatEGLD } from '../../lib/format';
import { useProjectsQuery, useUsageEventsQuery, useViewerQuery } from '../../lib/hooks';

export function DashboardScreen() {
  const { data: viewer, isLoading, error } = useViewerQuery();
  const { data: projects } = useProjectsQuery(Boolean(viewer?.user));
  const { data: usageEvents } = useUsageEventsQuery(Boolean(viewer?.user));

  const projectDetailQueries = useQueries({
    queries: (projects ?? []).map((project) => ({
      queryKey: ['buyer-project', project.id],
      queryFn: () => fetchProjectDetail(project.id),
      enabled: Boolean(viewer?.user)
    }))
  });

  const projectApiKeyQueries = useQueries({
    queries: (projects ?? []).map((project) => ({
      queryKey: ['project-api-keys', project.id],
      queryFn: () => fetchProjectApiKeys(project.id),
      enabled: Boolean(viewer?.user)
    }))
  });

  const chartData = useMemo(() => {
    const buckets = new Map<string, number>();

    (usageEvents ?? []).forEach((event) => {
      const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(event.occurredAt));
      buckets.set(label, (buckets.get(label) ?? 0) + 1);
    });

    return Array.from(buckets.entries()).map(([label, value]) => ({ label, value }));
  }, [usageEvents]);

  const projectDetailsById = useMemo(
    () =>
      Object.fromEntries(
        (projects ?? []).map((project, index) => [project.id, projectDetailQueries[index]?.data ?? null])
      ),
    [projectDetailQueries, projects]
  );

  const projectApiKeysById = useMemo(
    () =>
      Object.fromEntries(
        (projects ?? []).map((project, index) => [project.id, projectApiKeyQueries[index]?.data ?? []])
      ),
    [projectApiKeyQueries, projects]
  );

  const activeGrants = Object.values(projectDetailsById).reduce(
    (sum, detail) => sum + (detail?.grants.length ?? 0),
    0
  );
  const activeKeys = Object.values(projectApiKeysById).reduce(
    (sum, keys) => sum + keys.filter((key) => key.status === 'active').length,
    0
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <Panel className="p-7">
          <div className="display-eyebrow">Consumer dashboard</div>
          <h1 className="mt-4 text-4xl font-semibold md:text-5xl">Track usage, keys, and project access</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-sub md:text-lg">
            Monitor mirrored balance, active grants, API key footprint, and paid call history across the APIs you consume.
          </p>
        </Panel>

        <DataState
          isLoading={isLoading}
          error={error as Error | null}
          empty={!viewer?.user}
          emptyTitle="Authenticate to unlock the consumer dashboard"
          emptyCopy="Connect a wallet from the header so MX402 can load your mirrored balance, project access, and usage receipts."
          emptyCtaHref="/marketplace"
          emptyCtaLabel="Return to marketplace →"
        >
          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-4">
                <Metric label="Spendable" value={formatEGLD(viewer?.balance?.spendableAtomic)} />
                <Metric label="Reserved" value={formatEGLD(viewer?.balance?.reservedAtomic)} />
                <Metric label="Active keys" value={formatCompactNumber(activeKeys)} />
                <Metric label="Active grants" value={formatCompactNumber(activeGrants)} />
              </div>

              <Panel title="Usage over time" kicker="Call volume">
                <DataState
                  empty={chartData.length === 0}
                  emptyTitle="No paid usage yet"
                  emptyCopy="Create a project, mint an API key, grant an active product, and route a paid gateway call to start building usage history."
                  emptyCtaHref="/marketplace"
                  emptyCtaLabel="Find an API →"
                >
                  <UsageChart data={chartData} />
                </DataState>
              </Panel>

              <Panel title="Projects" kicker="Keys and grants">
                <DataState
                  empty={(projects ?? []).length === 0}
                  emptyTitle="No buyer projects yet"
                  emptyCopy="Create a project from an API detail page, mint an API key, then grant product access before calling the gateway."
                  emptyCtaHref="/marketplace"
                  emptyCtaLabel="Browse APIs →"
                >
                  <div className="space-y-4">
                    {(projects ?? []).map((project) => {
                      const detail = projectDetailsById[project.id];
                      const keys = projectApiKeysById[project.id] ?? [];

                      return (
                        <div key={project.id} className="rounded-3xl border border-white/10 bg-black/20 p-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-base font-semibold text-ink">{project.name}</h3>
                              <p className="mt-1 text-xs text-sub">
                                Created {formatDate(project.createdAt)} · Updated {formatDate(project.updatedAt)}
                              </p>
                            </div>
                            <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-sub">{project.status}</span>
                          </div>

                          <div className="mt-4 grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-white/10 bg-panel/60 p-4">
                              <p className="text-xs uppercase tracking-[0.16em] text-muted">Granted products</p>
                              {(detail?.grants.length ?? 0) === 0 ? (
                                <p className="mt-3 text-sm text-sub">No active grants yet.</p>
                              ) : (
                                <div className="mt-3 space-y-2">
                                  {(detail?.grants ?? []).map((grant) => (
                                    <div key={`${project.id}:${grant.productId}`} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                                      <p className="text-sm text-ink">{grant.productName}</p>
                                      <p className="mt-1 text-xs text-sub">{grant.providerName} · Granted {formatDate(grant.grantedAt)}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-panel/60 p-4">
                              <p className="text-xs uppercase tracking-[0.16em] text-muted">API keys</p>
                              {keys.length === 0 ? (
                                <p className="mt-3 text-sm text-sub">No API keys minted yet.</p>
                              ) : (
                                <div className="mt-3 space-y-2">
                                  {keys.map((key) => (
                                    <div key={key.id} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                                      <div className="flex items-center justify-between gap-3">
                                        <div>
                                          <p className="text-sm text-ink">{key.name}</p>
                                          <p className="mt-1 font-mono text-xs text-sub">{key.prefix}</p>
                                        </div>
                                        <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[10px] text-sub">{key.status}</span>
                                      </div>
                                      <p className="mt-2 text-xs text-sub">
                                        {key.lastUsedAt ? `Last used ${formatDate(key.lastUsedAt)}` : 'Not used yet'}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </DataState>
              </Panel>
            </div>

            <div className="space-y-6">
              <Panel title="Spend history" kicker="Recent receipts">
                <DataState
                  empty={(usageEvents ?? []).length === 0}
                  emptyTitle="No spend history yet"
                  emptyCopy="Successful calls will appear here with charge amounts and provider latency."
                  emptyCtaHref="/marketplace"
                  emptyCtaLabel="Try a paid API →"
                >
                  <div className="space-y-3">
                    {(usageEvents ?? []).slice(0, 10).map((event) => (
                      <div key={event.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-ink">{event.product.name}</h3>
                            <p className="mt-1 text-xs text-sub">{event.product.providerName} · {formatDate(event.occurredAt)}</p>
                            <p className="mt-2 text-xs text-sub">Receipt {event.receiptId ?? 'pending'} · Latency {event.latencyMs ?? 'n/a'} ms</p>
                          </div>
                          <div className="font-mono text-xs text-right text-sub">
                            <div>{formatEGLD(event.amountAtomic)}</div>
                            <div className={event.requestStatus === 'success' ? 'text-success' : 'text-danger'}>{event.requestStatus}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </DataState>
              </Panel>
            </div>
          </div>
        </DataState>
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel-surface p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="mt-2 font-mono text-lg text-ink">{value}</p>
    </div>
  );
}
