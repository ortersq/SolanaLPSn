module.exports = {
  apps: [
    {
      name: 'solana-lp-web',
      script: './node_modules/.bin/tsx',
      args: 'server.ts',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'solana-lp-bot',
      script: './bot/worker.mjs',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
