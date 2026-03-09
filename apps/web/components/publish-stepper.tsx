'use client';

import { useMx402UiStore } from '../lib/store/ui-store';

const steps = ['Metadata', 'Pricing', 'Endpoint config', 'Deploy contract'];

export function PublishStepper() {
  const publishStep = useMx402UiStore((state) => state.publishStep);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {steps.map((step, index) => {
          const active = index === publishStep;
          const complete = index < publishStep;

          return (
            <div key={step} className={`min-w-[150px] flex-1 rounded-2xl border px-4 py-3 ${active ? 'border-accent/40 bg-accent/10' : complete ? 'border-success/30 bg-success/10' : 'border-white/10 bg-white/[0.03]'}`}>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Step {index + 1}</div>
              <div className="mt-1 text-sm font-semibold text-ink">{step}</div>
            </div>
          );
        })}
      </div>
      <div className="h-2 rounded-full bg-white/[0.05]">
        <div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${((publishStep + 1) / steps.length) * 100}%` }} />
      </div>
    </div>
  );
}
