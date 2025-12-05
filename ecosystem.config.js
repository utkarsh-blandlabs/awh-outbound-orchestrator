/**
 * PM2 Ecosystem Configuration
 * For production deployment on EC2
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 restart awh-orchestrator
 *   pm2 logs awh-orchestrator
 *   pm2 monit
 */

module.exports = {
  apps: [{
    name: 'awh-orchestrator',
    script: './build/index.js',

    // Cluster mode for better performance
    instances: 1,  // Start with 1, increase to 'max' for high volume
    exec_mode: 'cluster',

    // Environment variables
    env: {
      NODE_ENV: 'production',
    },

    // Logging
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,

    // Auto-restart settings
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',

    // Memory management
    max_memory_restart: '500M',  // Restart if memory exceeds 500MB

    // Monitoring
    watch: false,  // Set to true for development
    ignore_watch: ['node_modules', 'logs', 'build'],

    // Advanced PM2 features
    kill_timeout: 5000,
    listen_timeout: 3000,

    // Source map support for better error traces
    source_map_support: true,

    // Instance variables
    instance_var: 'INSTANCE_ID',
  }]
};
