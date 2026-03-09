'use client';

import { formatCompactNumber, formatUsd } from '../lib/format';
import { useChainOverviewQuery } from '../lib/hooks';
import { DataState } from './data-state';

function resolveNetworkLabel(chainId?: string) {
  if (!chainId) {
    return 'Unknown';
  }

  if (chainId.toLowerCase().includes('d')) {
    return 'Devnet';
  }

  if (chainId.toLowerCase().includes('t')) {
    return 'Testnet';
  }

  return 'Mainnet';
}

export function ChainStatus() {
  const { data, isLoading, error } = useChainOverviewQuery();

  return (
    <div>
      <div className="rp-section-label mb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted">Chain Status</div>
      <DataState isLoading={isLoading} error={error as Error | null} empty={!data}>
        <div className="chain-panel">
          <Row label="Network" value={`● ${resolveNetworkLabel(data?.chainId)}`} tone={data?.networkHealth === 'healthy' ? 'text-success' : 'text-danger'} />
          <Row label="Current Epoch" value={data ? formatCompactNumber(data.epoch) : '--'} />
          <Row label="Avg TPS" value={data ? formatCompactNumber(data.averageTps) : '--'} tone="text-accent" />
          <Row label="EGLD Price" value={formatUsd(data?.egldUsd)} />
          <Row label="Gas Price" value={data ? `${formatCompactNumber(data.minGasPrice)} wei` : '--'} />
        </div>
      </DataState>
    </div>
  );
}

function Row({ label, value, tone = 'text-ink' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="chain-row text-[12px]">
      <span className="text-sub">{label}</span>
      <span className={`font-mono text-[11.5px] ${tone}`}>{value}</span>
    </div>
  );
}
