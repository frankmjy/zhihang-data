const path = require('path');
const { createFullstackRspackConfig } = require('@lark-apaas/fullstack-rspack-preset');

const config = createFullstackRspackConfig({
  entry: {
    main: './client/src/index.tsx',
  },
  resolve: {
    tsConfig: {
      configFile: path.resolve(__dirname, './tsconfig.app.json'),
    },
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
});

const ignoredWatchGlobs = [
  '**/node_modules/**',
  '**/dist/**',
  '**/logs/**',
  '**/.run/**',
  '**/runtime/**',
  '**/*.log',
  '**/*.zip',
  '**/*.png',
  '**/tsconfig.*.tsbuildinfo',
];

if (config.devServer?.proxy) {
  const longRunningApiTimeoutMs = 60 * 60 * 1000;
  config.devServer.proxy = config.devServer.proxy
    .filter((proxy) => typeof proxy.context !== 'function')
    .map((proxy) => ({
      ...proxy,
      timeout: longRunningApiTimeoutMs,
      proxyTimeout: longRunningApiTimeoutMs,
    }));
}

config.watchOptions = {
  ...config.watchOptions,
  ignored: ignoredWatchGlobs,
};

config.devServer = {
  ...config.devServer,
  historyApiFallback: true,
  watchFiles: {
    paths: ['client/**/*', 'shared/**/*'],
    options: {
      ignored: ignoredWatchGlobs,
    },
  },
  devMiddleware: {
    ...config.devServer?.devMiddleware,
    index: true,
  },
};

module.exports = config;
