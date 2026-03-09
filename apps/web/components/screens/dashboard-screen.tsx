'use client';

import { useMemo } from 'react';

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

  const chartData = useMemo(() => {
    const buckets = new Map<string, number>();

    (usageEvents ?? []).forEach((event) => {
      const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(event.occurredAt));
      buckets.set(label, (buckets.get(label) ?? 0) + 1);
    });

    return Array.from(buckets.entries()).map(([label, value]) => ({ label, value }));
  }, [usageEvents]);

  const activeGrants = (projects ?? []).reduce((sum, project) => sum + project.grantCount, 0);

  return (
    <AppShell>
      <div className="space-y-6">
        <Panel className="p-7">
          <div className="display-eyebrow">Consumer dashboard</div>
          <h1 className="mt-4 text-4xl font-semibold md:text-5xl">Track usage, spend, and project access</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-sub md:text-lg">
            Monitor mirrored balance, project grants, and paid call history across the APIs you consume.
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
                <Metric label="Projects" value={formatCompactNumber(projects?.length ?? 0)} />
                <Metric label="Active grants" value={formatCompactNumber(activeGrants)} />
              </div>

              <Panel title="Usage over time" kicker="Call volume">
                <DataState
                  empty={chartData.length === 0}
                  emptyTitle="No paid usage yet"
                  emptyCopy="Create a project, mint an API key, and route a paid gateway call to start building a usage history."
                  emptyCtaHref="/marketplace"
                  emptyCtaLabel="Find an API →"
                >
                  <UsageChart data={chartData} />
                </DataState>
              </Panel>
            </div>

            <div className="space-y-6">
              <Panel title="Projects" kicker="Keys and grants">
                <DataState
                  empty={(projects ?? []).length === 0}
                  emptyTitle="No buyer projects yet"
                  emptyCopy="Projects group API keys and grant scopes. Create one through the API flow to begin consuming paid endpoints."
                  emptyCtaHref="/marketplace"
                  emptyCtaLabel="Browse APIs →"
                >
                  <div className="space-y-3">
                    {(projects ?? []).map((project) => (
                      <div key={project.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-ink">{project.name}</h3>
                            <p className="mt-1 text-xs text-sub">{project.apiKeyCount} keys · {project.grantCount} grants</p>
                          </div>
                          <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-xs text-sub">{project.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </DataState>
              </Panel>

              <Panel title="Spend history" kicker="Recent receipts">
                <DataState
                  empty={(usageEvents ?? []).length === 0}
                  emptyTitle="No spend history yet"
                  emptyCopy="Successful calls will appear here with charge amounts and provider latency."
                  emptyCtaHref="/marketplace"
                  emptyCtaLabel="Try a paid API →"
                >
                  <div className="space-y-3">
                    {(usageEvents ?? []).slice(0, 8).map((event) => (
                      <div key={event.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-ink">{event.product.name}</h3>
                            <p className="mt-1 text-xs text-sub">{event.product.providerName} · {formatDate(event.occurredAt)}</p>
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
