import '../packages/config/src/index.ts';

import { UserSecretKey } from '@multiversx/sdk-core/out/wallet/userKeys';
import { UserSigner } from '@multiversx/sdk-core/out/wallet/userSigner';

import { getPrismaClient } from '../packages/db/src/index.ts';

const DEMO_BASE_ROOT = (process.env.MX402_DEMO_BASE_URL ?? 'https://demo.mx402.exchange').replace(/\/+$/, '');

const DEMO_SECRETS = [
  '1111111111111111111111111111111111111111111111111111111111111111',
  '2222222222222222222222222222222222222222222222222222222222222222',
  '3333333333333333333333333333333333333333333333333333333333333333',
  '4444444444444444444444444444444444444444444444444444444444444444',
  '5555555555555555555555555555555555555555555555555555555555555555',
  '6666666666666666666666666666666666666666666666666666666666666666'
] as const;

type DemoProduct = {
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  baseUrl: string;
  upstreamPathTemplate: string;
  upstreamMethod: 'GET' | 'POST';
  priceAtomic: string;
  timeoutMs: number;
  rateLimitPerMinute: number;
  pathParamsSchemaJson?: Record<string, unknown>;
  inputSchemaJson?: Record<string, unknown>;
  querySchemaJson?: Record<string, unknown>;
  outputSchemaJson?: Record<string, unknown>;
};

type DemoProvider = {
  slug: string;
  displayName: string;
  description: string;
  websiteUrl: string;
  payoutWalletAddress: string;
  userWalletAddress: string;
  products: DemoProduct[];
};

function walletAddressFromSecret(secretKeyHex: string) {
  const secretKey = UserSecretKey.fromString(secretKeyHex);
  const signer = new UserSigner(secretKey);
  return signer.getAddress().toBech32();
}

function providerBaseUrl(slug: string) {
  return `${DEMO_BASE_ROOT}/providers/${slug}`;
}

const walletAddresses = DEMO_SECRETS.map(walletAddressFromSecret);

const providers: DemoProvider[] = [
  {
    slug: 'elrondcore-labs',
    displayName: 'ElrondCore Labs',
    description: 'High-throughput indexing, block intelligence, and event streaming for MultiversX builders.',
    websiteUrl: 'https://mx402.exchange/providers/elrondcore-labs',
    payoutWalletAddress: walletAddresses[0],
    userWalletAddress: walletAddresses[0],
    products: [
      {
        slug: 'mx-block-explorer-pro',
        name: 'MX Block Explorer Pro',
        shortDescription: 'Full on-chain data for blocks, shards, transactions, smart contract calls, and decoded logs.',
        description:
          'Enterprise-grade MultiversX indexing API for blocks, transactions, smart contract calls, decoded logs, token transfers, and shard-level analytics. Built for wallets, dashboards, compliance tooling, and data-heavy dApps that need low-latency access to chain data without running their own indexer.',
        baseUrl: providerBaseUrl('elrondcore-labs'),
        upstreamPathTemplate: '/explorer/v1/transactions/{txHash}',
        upstreamMethod: 'GET',
        priceAtomic: '300000000000000',
        timeoutMs: 8000,
        rateLimitPerMinute: 1200,
        pathParamsSchemaJson: {
          type: 'object',
          required: ['txHash'],
          properties: {
            txHash: { type: 'string', description: 'MultiversX transaction hash' }
          }
        },
        outputSchemaJson: {
          type: 'object',
          properties: {
            txHash: { type: 'string' },
            status: { type: 'string' },
            shard: { type: 'number' }
          }
        }
      },
      {
        slug: 'multiversx-realtime-events-stream',
        name: 'MultiversX Real-Time Events Stream',
        shortDescription: 'Sub-100ms event stream for transfers, contract events, epoch transitions, and account activity.',
        description:
          'Streaming API for near real-time MultiversX network events. Subscribe to smart contract activity, token transfers, validator signals, and epoch transitions through a metered HTTP relay suitable for bots, observability pipelines, and trading systems.',
        baseUrl: providerBaseUrl('elrondcore-labs'),
        upstreamPathTemplate: '/events/v1/stream/{topic}',
        upstreamMethod: 'GET',
        priceAtomic: '800000000000000',
        timeoutMs: 12000,
        rateLimitPerMinute: 900,
        pathParamsSchemaJson: {
          type: 'object',
          required: ['topic'],
          properties: {
            topic: { type: 'string', enum: ['transactions', 'esdt', 'epochs', 'contracts'] }
          }
        }
      }
    ]
  },
  {
    slug: 'xfinance-protocol',
    displayName: 'xFinance Protocol',
    description: 'Market data and liquidity intelligence for xExchange and surrounding MultiversX DeFi rails.',
    websiteUrl: 'https://mx402.exchange/providers/xfinance-protocol',
    payoutWalletAddress: walletAddresses[1],
    userWalletAddress: walletAddresses[1],
    products: [
      {
        slug: 'xexchange-price-feed',
        name: 'xExchange Price Feed',
        shortDescription: 'Real-time token prices, pool depth, swap quotes, and TWAP snapshots for xExchange markets.',
        description:
          'DeFi price oracle API that serves live xExchange market data, swap quotes, TWAP windows, liquidity changes, and pool metadata. Intended for frontends, agent strategies, automated treasury management, and protocol analytics.',
        baseUrl: providerBaseUrl('xfinance-protocol'),
        upstreamPathTemplate: '/defi/v1/quote/{pair}',
        upstreamMethod: 'GET',
        priceAtomic: '100000000000000',
        timeoutMs: 5000,
        rateLimitPerMinute: 2000,
        pathParamsSchemaJson: {
          type: 'object',
          required: ['pair'],
          properties: {
            pair: { type: 'string', description: 'Ticker pair such as EGLD-USDC' }
          }
        }
      }
    ]
  },
  {
    slug: 'safechain-ai',
    displayName: 'SafeChain AI',
    description: 'Machine-learning risk signals for wallets, contracts, and on-chain behavior on MultiversX.',
    websiteUrl: 'https://mx402.exchange/providers/safechain-ai',
    payoutWalletAddress: walletAddresses[2],
    userWalletAddress: walletAddresses[2],
    products: [
      {
        slug: 'esdt-wallet-risk-score',
        name: 'ESDT Wallet Risk Score',
        shortDescription: 'ML-powered wallet risk scoring using transaction patterns, token flow, and contract interactions.',
        description:
          'Wallet risk intelligence API for AML heuristics, sybil scoring, and suspicious-pattern detection. Scores combine token movement, counterparty clustering, contract interaction history, and chain-native behavior signals to support trust and compliance workflows.',
        baseUrl: providerBaseUrl('safechain-ai'),
        upstreamPathTemplate: '/risk/v1/wallet/{address}',
        upstreamMethod: 'GET',
        priceAtomic: '2000000000000000',
        timeoutMs: 7000,
        rateLimitPerMinute: 600,
        pathParamsSchemaJson: {
          type: 'object',
          required: ['address'],
          properties: {
            address: { type: 'string', description: 'MultiversX wallet address' }
          }
        }
      }
    ]
  },
  {
    slug: 'nftlabs-mx',
    displayName: 'NftLabs MX',
    description: 'NFT metadata, rarity, floor price, and collection intelligence APIs for MultiversX.',
    websiteUrl: 'https://mx402.exchange/providers/nftlabs-mx',
    payoutWalletAddress: walletAddresses[3],
    userWalletAddress: walletAddresses[3],
    products: [
      {
        slug: 'nft-metadata-resolver',
        name: 'NFT Metadata Resolver',
        shortDescription: 'Batch-resolve ESDT NFT metadata, rarity traits, collection stats, and floor pricing.',
        description:
          'NFT data API that aggregates metadata, traits, rarity scores, verified collection profiles, and market floor data into a single request. Built for wallets, marketplaces, portfolio apps, and gaming experiences on MultiversX.',
        baseUrl: providerBaseUrl('nftlabs-mx'),
        upstreamPathTemplate: '/nft/v1/collections/{collection}/items',
        upstreamMethod: 'GET',
        priceAtomic: '500000000000000',
        timeoutMs: 9000,
        rateLimitPerMinute: 750,
        pathParamsSchemaJson: {
          type: 'object',
          required: ['collection'],
          properties: {
            collection: { type: 'string', description: 'Collection ticker' }
          }
        }
      }
    ]
  },
  {
    slug: 'stake-anchor',
    displayName: 'StakeAnchor',
    description: 'Validator, staking, and delegation data services for MultiversX operators and dApps.',
    websiteUrl: 'https://mx402.exchange/providers/stake-anchor',
    payoutWalletAddress: walletAddresses[4],
    userWalletAddress: walletAddresses[4],
    products: [
      {
        slug: 'mx-staking-rewards-oracle',
        name: 'MX Staking Rewards Oracle',
        shortDescription: 'Delegation APR, validator stats, reward projections, and epoch-level staking analytics.',
        description:
          'Staking intelligence API for delegation apps, treasury dashboards, and validator tools. Exposes reward estimates, validator performance history, APR windows, and epoch-aware payout projections for MultiversX staking providers.',
        baseUrl: providerBaseUrl('stake-anchor'),
        upstreamPathTemplate: '/staking/v1/providers/{providerId}/rewards',
        upstreamMethod: 'GET',
        priceAtomic: '200000000000000',
        timeoutMs: 6000,
        rateLimitPerMinute: 1000,
        pathParamsSchemaJson: {
          type: 'object',
          required: ['providerId'],
          properties: {
            providerId: { type: 'string', description: 'Validator provider identifier' }
          }
        }
      }
    ]
  },
  {
    slug: 'trustlayer-protocol',
    displayName: 'TrustLayer Protocol',
    description: 'Identity, attestations, and privacy-preserving verification rails for the MultiversX ecosystem.',
    websiteUrl: 'https://mx402.exchange/providers/trustlayer-protocol',
    payoutWalletAddress: walletAddresses[5],
    userWalletAddress: walletAddresses[5],
    products: [
      {
        slug: 'mxid-verification',
        name: 'MxID Verification',
        shortDescription: 'DID-based identity verification with selective disclosure for KYC, KYB, and trust scoring.',
        description:
          'Identity verification API built around MultiversX-native attestations and privacy-preserving credential checks. Designed for onboarding flows, gated apps, DAO participation, and reputation-aware tooling that needs proofs without exposing raw personal data.',
        baseUrl: providerBaseUrl('trustlayer-protocol'),
        upstreamPathTemplate: '/identity/v1/verify',
        upstreamMethod: 'POST',
        priceAtomic: '5000000000000000',
        timeoutMs: 12000,
        rateLimitPerMinute: 240,
        inputSchemaJson: {
          type: 'object',
          required: ['subjectAddress', 'proofType'],
          properties: {
            subjectAddress: { type: 'string' },
            proofType: { type: 'string', enum: ['kyc', 'kyb', 'sanctions'] }
          }
        },
        outputSchemaJson: {
          type: 'object',
          properties: {
            verified: { type: 'boolean' },
            score: { type: 'number' }
          }
        }
      }
    ]
  }
];

async function seedProvider(provider: DemoProvider) {
  const prisma = getPrismaClient();

  const user = await prisma.user.upsert({
    where: {
      wallet_address: provider.userWalletAddress
    },
    update: {
      display_name: provider.displayName
    },
    create: {
      wallet_address: provider.userWalletAddress,
      display_name: provider.displayName
    }
  });

  const existingProvider = await prisma.provider.findFirst({
    where: {
      OR: [
        { user_id: user.id },
        { slug: provider.slug }
      ]
    }
  });

  const createdProvider = existingProvider
    ? await prisma.provider.update({
        where: {
          id: existingProvider.id
        },
        data: {
          user_id: user.id,
          status: 'approved',
          slug: provider.slug,
          display_name: provider.displayName,
          description: provider.description,
          website_url: provider.websiteUrl,
          payout_wallet_address: provider.payoutWalletAddress,
          approved_at: new Date(),
          approval_notes: 'Demo catalog seed'
        }
      })
    : await prisma.provider.create({
        data: {
          user_id: user.id,
          status: 'approved',
          slug: provider.slug,
          display_name: provider.displayName,
          description: provider.description,
          website_url: provider.websiteUrl,
          payout_wallet_address: provider.payoutWalletAddress,
          approved_at: new Date(),
          approval_notes: 'Demo catalog seed'
        }
      });

  await prisma.providerBalance.upsert({
    where: {
      provider_id: createdProvider.id
    },
    update: {},
    create: {
      provider_id: createdProvider.id,
      unsettled_earned_atomic: '0',
      claimable_onchain_atomic: '0',
      claimed_total_atomic: '0'
    }
  });

  await prisma.providerProduct.deleteMany({
    where: {
      provider_id: createdProvider.id,
      slug: {
        notIn: provider.products.map((product) => product.slug)
      }
    }
  });

  for (const product of provider.products) {
    await prisma.providerProduct.upsert({
      where: {
        slug: product.slug
      },
      update: {
        provider_id: createdProvider.id,
        status: 'active',
        name: product.name,
        short_description: product.shortDescription,
        description: product.description,
        base_url: product.baseUrl,
        upstream_path_template: product.upstreamPathTemplate,
        upstream_method: product.upstreamMethod,
        price_atomic: product.priceAtomic,
        timeout_ms: product.timeoutMs,
        rate_limit_per_minute: product.rateLimitPerMinute,
        charge_policy: 'success_only',
        origin_auth_mode: 'none',
        origin_auth_header_name: null,
        origin_auth_secret_ciphertext: null,
        path_params_schema_json: product.pathParamsSchemaJson ?? {},
        input_schema_json: product.inputSchemaJson ?? {},
        query_schema_json: product.querySchemaJson ?? {},
        output_schema_json: product.outputSchemaJson ?? {},
        metadata_json: {
          seeded: true,
          featured: product.slug === 'multiversx-realtime-events-stream',
          categoryHint: product.slug
        }
      },
      create: {
        provider_id: createdProvider.id,
        status: 'active',
        slug: product.slug,
        name: product.name,
        short_description: product.shortDescription,
        description: product.description,
        base_url: product.baseUrl,
        upstream_path_template: product.upstreamPathTemplate,
        upstream_method: product.upstreamMethod,
        price_atomic: product.priceAtomic,
        timeout_ms: product.timeoutMs,
        rate_limit_per_minute: product.rateLimitPerMinute,
        charge_policy: 'success_only',
        origin_auth_mode: 'none',
        origin_auth_header_name: null,
        origin_auth_secret_ciphertext: null,
        path_params_schema_json: product.pathParamsSchemaJson ?? {},
        input_schema_json: product.inputSchemaJson ?? {},
        query_schema_json: product.querySchemaJson ?? {},
        output_schema_json: product.outputSchemaJson ?? {},
        metadata_json: {
          seeded: true,
          featured: product.slug === 'multiversx-realtime-events-stream',
          categoryHint: product.slug
        }
      }
    });
  }
}

async function main() {
  const prisma = getPrismaClient();

  for (const provider of providers) {
    await seedProvider(provider);
  }

  const activeProducts = await prisma.providerProduct.count({
    where: {
      status: 'active',
      provider: {
        status: 'approved'
      }
    }
  });

  const approvedProviders = await prisma.provider.count({
    where: {
      status: 'approved'
    }
  });

  console.log(`Seeded demo catalog: ${approvedProviders} providers, ${activeProducts} products`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPrismaClient().$disconnect();
  });
