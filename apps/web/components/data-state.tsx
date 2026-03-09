import type { ReactNode } from 'react';

import { Panel } from './panel';

type DataStateProps = {
  isLoading?: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyCopy?: string;
  emptyCtaHref?: string;
  emptyCtaLabel?: string;
  children: ReactNode;
};

export function DataState({
  isLoading,
  error,
  empty,
  emptyTitle = 'Nothing here yet',
  emptyCopy = 'The data source returned an empty result.',
  emptyCtaHref,
  emptyCtaLabel,
  children
}: DataStateProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-3xl border border-white/10 bg-panel/80" />
        <div className="h-24 animate-pulse rounded-3xl border border-white/10 bg-panel/80" />
        <div className="h-24 animate-pulse rounded-3xl border border-white/10 bg-panel/80" />
      </div>
    );
  }

  if (error) {
    return (
      <Panel className="border-danger/30">
        <p className="display-eyebrow text-danger">Component boundary</p>
        <h3 className="mt-3 text-xl font-semibold">This data block failed to load.</h3>
        <p className="mt-3 text-sm text-sub">{error.message}</p>
      </Panel>
    );
  }

  if (empty) {
    return (
      <Panel>
        <p className="display-eyebrow">Empty state</p>
        <h3 className="mt-3 text-xl font-semibold">{emptyTitle}</h3>
        <p className="mt-3 max-w-xl text-sm text-sub">{emptyCopy}</p>
        {emptyCtaHref && emptyCtaLabel ? (
          <a href={emptyCtaHref} className="action-button-primary mt-5 inline-flex">
            {emptyCtaLabel}
          </a>
        ) : null}
      </Panel>
    );
  }

  return <>{children}</>;
}
