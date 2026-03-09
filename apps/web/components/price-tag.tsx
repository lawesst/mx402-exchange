import BigNumber from 'bignumber.js';

import { atomicToEGLD, formatUsd } from '../lib/format';

export function PriceTag({ amountAtomic, egldUsd, emphasis = false }: { amountAtomic: BigNumber.Value; egldUsd: number; emphasis?: boolean }) {
  const eglAmount = atomicToEGLD(amountAtomic);
  const usdValue = eglAmount.multipliedBy(egldUsd);

  return (
    <div className="flex items-baseline gap-2 font-mono">
      <span className={emphasis ? 'text-xl font-semibold text-accent' : 'text-sm text-ink'}>{eglAmount.toFormat(4)} EGLD</span>
      <span className="text-xs text-sub">{formatUsd(usdValue.toNumber())}</span>
    </div>
  );
}
