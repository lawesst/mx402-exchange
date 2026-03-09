import BigNumber from 'bignumber.js';

export const EGLD_DECIMALS = new BigNumber('1e18');

export function toBigNumber(value: BigNumber.Value | null | undefined) {
  return new BigNumber(value ?? 0);
}

export function atomicToEGLD(value: BigNumber.Value | null | undefined) {
  return toBigNumber(value).dividedBy(EGLD_DECIMALS);
}

export function formatEGLD(value: BigNumber.Value | null | undefined, decimals = 4) {
  return `${atomicToEGLD(value).toFormat(decimals)} EGLD`;
}

export function formatUsd(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value ?? 0);
}

export function formatCompactNumber(value: number | string | null | undefined) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number(value ?? 0));
}

export function truncateAddress(address: string | null | undefined) {
  if (!address) {
    return 'Not connected';
  }

  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatDate(value: string | number | null | undefined) {
  if (value == null) {
    return 'Pending';
  }

  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function formatLatency(value: number | null | undefined) {
  if (value == null) {
    return 'Pending';
  }

  return `${value} ms`;
}
