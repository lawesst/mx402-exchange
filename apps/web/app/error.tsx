'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background p-8 text-ink">
      <div className="mx-auto max-w-2xl rounded-3xl border border-white/10 bg-panel p-8 shadow-panel">
        <p className="display-eyebrow">MX402 Error Boundary</p>
        <h1 className="mt-4 text-4xl font-semibold">A data surface failed to render.</h1>
        <p className="mt-4 max-w-xl text-sm text-sub">
          The page is still protected by an error boundary. Retry the render or return to the marketplace.
        </p>
        <div className="mt-8 flex gap-3">
          <button className="action-button-primary" onClick={reset}>
            Retry render
          </button>
          <a className="action-button" href="/marketplace">
            Back to marketplace
          </a>
        </div>
      </div>
    </div>
  );
}
