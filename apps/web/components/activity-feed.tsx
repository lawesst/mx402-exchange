'use client';

import type { ActivityItem } from '../lib/types';
import { DataState } from './data-state';

const toneMap = {
  payment: 'bg-success',
  publish: 'bg-accent',
  call: 'bg-gold'
} as const;

function formatRelativeTime(timestamp: string) {
  const deltaSeconds = Math.max(1, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));

  if (deltaSeconds < 60) {
    return `${deltaSeconds}s`;
  }

  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h`;
  }

  return `${Math.floor(deltaHours / 24)}d`;
}

export function ActivityFeed({ items, isLoading, error }: { items: ActivityItem[]; isLoading?: boolean; error?: Error | null }) {
  return (
    <div>
      <div className="rp-section-label mb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted">Live Activity</div>
      <DataState
        isLoading={isLoading}
        error={error}
        empty={items.length === 0}
        emptyTitle="No live activity yet"
        emptyCopy="Calls, publishes, and settlements will stream here as soon as the marketplace starts moving volume. Publish your first API to light it up."
        emptyCtaHref="/publish"
        emptyCtaLabel="Publish your first API →"
      >
        <div className="activity-feed">
          {items.slice(0, 6).map((item) => (
            <div key={item.id} className="activity-row">
              <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${toneMap[item.type]}`} />
              <div className="min-w-0 flex-1 text-[12px] leading-5 text-sub">
                <strong className="font-semibold text-ink">{item.title}</strong>
                <div className="truncate">{item.subtitle}</div>
              </div>
              <div className="pt-0.5 font-mono text-[10px] text-muted">{formatRelativeTime(item.timestamp)}</div>
            </div>
          ))}
        </div>
      </DataState>
    </div>
  );
}
