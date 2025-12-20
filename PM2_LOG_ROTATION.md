# PM2 Log Rotation Setup

## Overview
This document describes how to configure PM2 log rotation to prevent disk space issues (Edge Case #17).

## Problem
Without log rotation, PM2 logs can grow indefinitely and consume all available disk space, causing the application to crash or become unresponsive.

## Solution
Use PM2's built-in log rotation module `pm2-logrotate` to automatically rotate and compress logs.

## Installation

### 1. Install PM2 Log Rotate Module
```bash
pm2 install pm2-logrotate
```

### 2. Configure Log Rotation
```bash
# Set maximum log file size before rotation (default: 10MB)
pm2 set pm2-logrotate:max_size 10M

# Set number of rotated logs to keep (default: 10)
pm2 set pm2-logrotate:retain 30

# Enable compression of rotated logs
pm2 set pm2-logrotate:compress true

# Set rotation interval - can be a cron expression or number in ms
# Daily rotation at 00:00
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'

# Or rotate when file size exceeds max_size (recommended)
pm2 set pm2-logrotate:rotateInterval 0 0 * * *
```

### 3. Verify Configuration
```bash
# View current configuration
pm2 conf pm2-logrotate

# Check module status
pm2 ls
```

## Recommended Settings for AWS EC2 t2.micro (1 GB RAM)

```bash
pm2 set pm2-logrotate:max_size 5M        # Rotate when log reaches 5MB
pm2 set pm2-logrotate:retain 20          # Keep 20 rotated logs (~100MB max)
pm2 set pm2-logrotate:compress true      # Compress old logs (saves ~90% space)
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'  # Daily rotation at midnight
pm2 set pm2-logrotate:workerInterval 30  # Check every 30 seconds
pm2 set pm2-logrotate:rotateModule true  # Also rotate PM2 module logs
```

## Monitoring

### Check Log Sizes
```bash
# View log file sizes
du -sh ~/.pm2/logs/*

# Monitor disk usage
df -h

# View total log directory size
du -sh ~/.pm2/logs/
```

### View Logs
```bash
# View live logs
pm2 logs awh-outbound-orchestrator

# View last 100 lines
pm2 logs awh-outbound-orchestrator --lines 100

# View error logs only
pm2 logs awh-outbound-orchestrator --err

# View rotated logs
ls -lh ~/.pm2/logs/
```

## Emergency: Manual Log Cleanup

If disk is full and server is unresponsive:

```bash
# Stop application
pm2 stop awh-outbound-orchestrator

# Archive current logs
mkdir -p ~/log-archive
mv ~/.pm2/logs/* ~/log-archive/

# Restart application
pm2 start awh-outbound-orchestrator

# Clean up archived logs later
rm -rf ~/log-archive/
```

## Automated Monitoring Script

Create a cron job to alert when disk usage exceeds 80%:

```bash
# Edit crontab
crontab -e

# Add this line (runs every hour)
0 * * * * /home/ubuntu/check-disk.sh
```

Create `/home/ubuntu/check-disk.sh`:
```bash
#!/bin/bash
USAGE=$(df -h / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ $USAGE -gt 80 ]; then
    echo "WARNING: Disk usage is at ${USAGE}%" | logger -t disk-monitor
    # Optional: Send email or webhook notification
fi
```

Make it executable:
```bash
chmod +x /home/ubuntu/check-disk.sh
```

## Testing Log Rotation

```bash
# Force a log rotation
pm2 flush

# Generate test logs
for i in {1..1000}; do
  curl -X GET http://localhost:3000/health
done

# Check if rotation occurred
ls -lht ~/.pm2/logs/ | head -10
```

## Troubleshooting

### Module Not Working
```bash
# Reinstall module
pm2 uninstall pm2-logrotate
pm2 install pm2-logrotate

# Restart PM2
pm2 kill
pm2 resurrect
```

### Logs Still Growing
```bash
# Check configuration
pm2 conf pm2-logrotate

# Verify max_size is set correctly
pm2 get pm2-logrotate:max_size

# Check if compression is enabled
pm2 get pm2-logrotate:compress
```

## Edge Case Resolution

**Edge #17: Disk Full from Logs**
- **Status**: Handled via PM2 log rotation
- **Solution**: Install and configure pm2-logrotate module
- **Monitoring**: Set up disk usage alerts
- **Prevention**: Automatic rotation at 5MB with 20 retained logs
- **Recovery**: Manual cleanup script if disk fills

## Additional Resources
- [PM2 Log Rotate Documentation](https://github.com/keymetrics/pm2-logrotate)
- [PM2 Official Docs](https://pm2.keymetrics.io/docs/usage/log-management/)
