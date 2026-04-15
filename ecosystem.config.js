/**
 * PM2 ecosystem config for leadgen.
 * Caps runaway restart loops and memory leaks.
 * Use via: pm2 start ecosystem.config.js (from /home/openclaw/leadgen on VPS)
 */
module.exports = {
  apps: [{
    name: 'leadgen',
    script: 'src/index.js',
    cwd: '/home/openclaw/leadgen',
    max_memory_restart: '500M',
    max_restarts: 10,
    min_uptime: '60s',
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
