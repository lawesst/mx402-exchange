'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { TickerBar } from './ticker-bar';
import { WalletWidget } from './wallet-widget';

const navigation = [
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/wallet', label: 'Wallet' },
  { href: '/publish', label: 'Publish' }
];

function resolveNetworkLabel() {
  const apiUrl = process.env.NEXT_PUBLIC_MULTIVERSX_API_URL ?? '';

  if (apiUrl.includes('devnet')) {
    return 'MultiversX Devnet';
  }

  if (apiUrl.includes('testnet')) {
    return 'MultiversX Testnet';
  }

  return 'MultiversX Mainnet';
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const networkLabel = resolveNetworkLabel();

  return (
    <div className="relative z-10 min-h-screen bg-transparent text-ink">
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[60px] max-w-[1540px] items-center justify-between gap-6 px-4 md:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-6">
            <Link href="/marketplace" className="flex items-center gap-3">
              <span className="h-8 w-8 flex-shrink-0">
                <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <polygon points="16,2 30,9 30,23 16,30 2,23 2,9" fill="rgba(35,247,221,0.08)" stroke="#23F7DD" strokeWidth="1.2" />
                  <polygon points="16,8 24,12.5 24,21.5 16,26 8,21.5 8,12.5" fill="rgba(35,247,221,0.12)" stroke="#23F7DD" strokeWidth="0.8" opacity="0.6" />
                  <circle cx="16" cy="16" r="3" fill="#23F7DD" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-lg font-extrabold tracking-[-0.02em]">MX<span className="text-accent">402</span></p>
              </div>
            </Link>

            <nav className="hidden items-center gap-1 lg:flex">
              {navigation.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link key={item.href} href={item.href} className={`nav-link ${active ? 'nav-link-active' : ''}`}>
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="chain-chip hidden sm:inline-flex">{networkLabel}</span>
            <WalletWidget variant="nav" />
            <Link href="/publish" className="action-button-primary hidden sm:inline-flex">
              Publish API
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1540px] px-4 pb-24 pt-0 md:px-6 lg:px-8">
        {children}
      </main>

      <TickerBar />
    </div>
  );
}
