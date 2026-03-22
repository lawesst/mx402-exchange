const path = require('path');

const rxjsRoot = path.dirname(require.resolve('rxjs/package.json', { paths: [__dirname] }));
const distDir = process.env.MX402_NEXT_DIST_DIR || '.next';
const apiProxyTarget = process.env.MX402_WEB_API_PROXY_TARGET || '/api/__mx402_api';
const gatewayProxyTarget = process.env.MX402_WEB_GATEWAY_PROXY_TARGET || '/api/__mx402_gateway';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  experimental: {
    externalDir: true,
    outputFileTracingRoot: path.join(__dirname, '../../'),
    outputFileTracingExcludes: {
      '/api/__mx402_api/\\[\\.\\.\\.path\\]': [
        '.next/cache/**/*',
        '.next-build/**/*',
        'node_modules.bak/**/*',
        'certificates/**/*'
      ],
      '/api/__mx402_gateway/\\[\\.\\.\\.path\\]': [
        '.next/cache/**/*',
        '.next-build/**/*',
        'node_modules.bak/**/*',
        'certificates/**/*'
      ],
      '/api/__mx402_worker/run': [
        '.next/cache/**/*',
        '.next-build/**/*',
        'node_modules.bak/**/*',
        'certificates/**/*'
      ]
    },
    outputFileTracingIncludes: {
      '/api/__mx402_api/\\[\\.\\.\\.path\\]': [
        '.prisma/client/**/*',
        '../../packages/db/node_modules/.prisma/client/**/*',
        '../../packages/db/node_modules/@prisma/client/**/*'
      ],
      '/api/__mx402_gateway/\\[\\.\\.\\.path\\]': [
        '.prisma/client/**/*',
        '../../packages/db/node_modules/.prisma/client/**/*',
        '../../packages/db/node_modules/@prisma/client/**/*'
      ],
      '/api/__mx402_worker/run': [
        '.prisma/client/**/*',
        '../../packages/db/node_modules/.prisma/client/**/*',
        '../../packages/db/node_modules/@prisma/client/**/*'
      ]
    }
  },
  async rewrites() {
    return [
      {
        source: '/__mx402_api/:path*',
        destination: `${apiProxyTarget}/:path*`
      },
      {
        source: '/__mx402_gateway/:path*',
        destination: `${gatewayProxyTarget}/:path*`
      }
    ];
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      rxjs: rxjsRoot,
      'rxjs/operators': path.join(rxjsRoot, 'operators')
    };

    return config;
  }
};

module.exports = nextConfig;
