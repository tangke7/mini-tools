module.exports = {
  apps: [
    {
      name: 'mini-tools',
      script: './node_modules/serve/build/main.js',
      args: '-s dist -l tcp://0.0.0.0:3888',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
