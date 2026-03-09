const path = require('path');

const rxjsRoot = path.dirname(require.resolve('rxjs/package.json', { paths: [__dirname] }));
const distDir = process.env.MX402_NEXT_DIST_DIR || '.next';
const apiProxyTarget = process.env.MX402_WEB_API_PROXY_TARGET || 'http://127.0.0.1:4010';
const gatewayProxyTarget = process.env.MX402_WEB_GATEWAY_PROXY_TARGET || 'http://127.0.0.1:4020';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
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
