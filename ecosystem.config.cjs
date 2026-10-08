module.exports = {
  apps: [
    {
      name: 'prometheus',
      cwd: __dirname,
      script: 'C:/Users/User/.bun/bin/bun.exe',
      args: ['x', 'next', 'dev', '-p', '3001'],
      env: {
        NODE_ENV: 'development',
        PORT: '3001',
        DATABASE_URL: 'file:C:/Users/User/Downloads/Uplift/prometheus/db/custom.db',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: 'C:/Users/User/Downloads/Uplift/prometheus/pm2-out.log',
      error_file: 'C:/Users/User/Downloads/Uplift/prometheus/pm2-err.log',
      time: true,
    },
  ],
}