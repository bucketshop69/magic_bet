module.exports = {
  apps: [
    {
      name: "magic-bet-crank",
      cwd: "./services/crank",
      script: "dist/index.js",
      interpreter: "node",
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: "10s",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
