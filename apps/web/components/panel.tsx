import type { ReactNode } from 'react';

import clsx from 'clsx';

type PanelProps = {
  title?: string;
  kicker?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
};

export function Panel({ title, kicker, children, className, actions }: PanelProps) {
  return (
    <section className={clsx('panel-surface p-5 md:p-6', className)}>
      {title || kicker || actions ? (
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            {kicker ? <p className="display-eyebrow">{kicker}</p> : null}
            {title ? <h2 className="mt-2 text-xl font-semibold text-ink md:text-2xl">{title}</h2> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
