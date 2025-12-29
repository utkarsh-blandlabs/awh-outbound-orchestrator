# AWS EC2 Storage Commands - Quick Reference

Based on your PM2 status showing the app using **222.9MB RAM** on AWS EC2.

---

## 📊 Check Storage Usage

### Overall Disk Usage
```bash
df -h
```
**Output Example:**
```
Filesystem      Size  Used Avail Use% Mounted on
/dev/xvda1       20G  5.2G   14G  27% /
```

### Application Directory Size
```bash
du -sh /home/ec2-user/awh-outbound-orchestrator/
```
**Shows:** Total size of application directory

### Data Directory Breakdown
```bash
du -sh /home/ec2-user/awh-outbound-orchestrator/data/*
```
**Output Example:**
```
4.0K    blocklist-attempts
16K     blocklist-config.json
128K    daily-calls
256K    redial-queue
64K     statistics
8.0K    am-tracker
```

---

## 🗂️ Check Specific Files

### Blocklist Files
```bash
# Blocklist config size
ls -lh /home/ec2-user/awh-outbound-orchestrator/data/blocklist-config.json

# Blocklist attempts directory
du -sh /home/ec2-user/awh-outbound-orchestrator/data/blocklist-attempts/

# List all attempt files
ls -lh /home/ec2-user/awh-outbound-orchestrator/data/blocklist-attempts/
```

### Daily Call Files
```bash
# List daily call files with sizes
ls -lh /home/ec2-user/awh-outbound-orchestrator/data/daily-calls/

# Count how many files
ls -1 /home/ec2-user/awh-outbound-orchestrator/data/daily-calls/ | wc -l
```

### Redial Queue Files
```bash
# List redial queue files (monthly)
ls -lh /home/ec2-user/awh-outbound-orchestrator/data/redial-queue/
```

---

## 📝 PM2 Storage

### PM2 Logs Size
```bash
# Check PM2 logs directory size
du -sh ~/.pm2/logs/

# List log files with sizes
ls -lh ~/.pm2/logs/

# Check specific app logs
ls -lh ~/.pm2/logs/awh-orchestrator-*.log
```

### PM2 Application Details
```bash
# Show detailed app info (including memory, uptime, restarts)
pm2 show awh-orchestrator
```
**Shows:**
- Memory usage
- Uptime
- Restart count
- CPU usage
- Log file paths

### Clear PM2 Logs
```bash
# Flush all logs (empties log files)
pm2 flush

# View logs after flush
pm2 logs awh-orchestrator --lines 50
```

---

## 🧹 Cleanup Commands

### Remove Old Blocklist Attempts (30+ days)
```bash
# Find and delete files older than 30 days
find /home/ec2-user/awh-outbound-orchestrator/data/blocklist-attempts/ \
  -name "attempts_*.json" \
  -mtime +30 \
  -delete

# Dry run (see what would be deleted)
find /home/ec2-user/awh-outbound-orchestrator/data/blocklist-attempts/ \
  -name "attempts_*.json" \
  -mtime +30 \
  -ls
```

### Archive Instead of Delete
```bash
# Create archive directory
mkdir -p ~/archive/blocklist-attempts

# Move old files to archive
find /home/ec2-user/awh-outbound-orchestrator/data/blocklist-attempts/ \
  -name "attempts_*.json" \
  -mtime +30 \
  -exec mv {} ~/archive/blocklist-attempts/ \;

# Compress archive
tar -czf ~/archive/blocklist-attempts-$(date +%Y%m%d).tar.gz \
  ~/archive/blocklist-attempts/
```

### Remove Old Daily Call Files (30+ days)
```bash
find /home/ec2-user/awh-outbound-orchestrator/data/daily-calls/ \
  -name "calls_*.json" \
  -mtime +30 \
  -delete
```

### Remove Old Statistics Files (30+ days)
```bash
find /home/ec2-user/awh-outbound-orchestrator/data/statistics/ \
  -name "stats_*.json" \
  -mtime +30 \
  -delete
```

---

## 📈 Monitor Real-Time

### Watch Disk Usage
```bash
# Update every 5 seconds
watch -n 5 'df -h && echo "" && du -sh /home/ec2-user/awh-outbound-orchestrator/data'
```

### Monitor Directory Growth
```bash
# Check data directory every 10 seconds
watch -n 10 'du -sh /home/ec2-user/awh-outbound-orchestrator/data/*'
```

### Monitor PM2 Memory
```bash
# Real-time PM2 monitoring
pm2 monit
```

---

## 🔍 Find Large Files

### Top 10 Largest Files in Data Directory
```bash
find /home/ec2-user/awh-outbound-orchestrator/data/ \
  -type f \
  -exec du -h {} + | sort -rh | head -10
```

### Find Files Larger Than 10MB
```bash
find /home/ec2-user/awh-outbound-orchestrator/data/ \
  -type f \
  -size +10M \
  -exec ls -lh {} \;
```

---

## 📦 Backup Data

### Backup Entire Data Directory
```bash
# Create timestamped backup
tar -czf ~/backups/data-backup-$(date +%Y%m%d-%H%M%S).tar.gz \
  /home/ec2-user/awh-outbound-orchestrator/data/

# List backups
ls -lh ~/backups/
```

### Backup Blocklist Config Only
```bash
cp /home/ec2-user/awh-outbound-orchestrator/data/blocklist-config.json \
   ~/backups/blocklist-config-$(date +%Y%m%d).json
```

---

## 🚨 Emergency: Out of Disk Space

### Quick Free Up Space

```bash
# 1. Flush PM2 logs (safest, immediate)
pm2 flush

# 2. Remove old attempts files (30+ days)
find /home/ec2-user/awh-outbound-orchestrator/data/blocklist-attempts/ \
  -name "attempts_*.json" -mtime +30 -delete

# 3. Remove old daily call files (30+ days)
find /home/ec2-user/awh-outbound-orchestrator/data/daily-calls/ \
  -name "calls_*.json" -mtime +30 -delete

# 4. Remove old statistics (30+ days)
find /home/ec2-user/awh-outbound-orchestrator/data/statistics/ \
  -name "stats_*.json" -mtime +30 -delete

# 5. Check freed space
df -h
```

---

## 📊 Your Current PM2 Status Breakdown

From your output:
```
│ 0  │ awh-orchestrator    │ default     │ 1.0.0   │ cluster │ 636396   │ 5D     │ 44   │ online    │ 0%       │ 222.9mb  │
```

**Analysis:**
- **Memory Usage:** 222.9 MB (normal for Node.js app)
- **Uptime:** 5 days
- **Restarts:** 44 (check logs if this number keeps increasing)
- **CPU:** 0% (idle - good)
- **Status:** Online (healthy)

**To check why 44 restarts:**
```bash
# View restart logs
pm2 logs awh-orchestrator --lines 100 | grep -i "restart\|error"
```

---

## 🔄 Log Rotation Setup

### Install PM2 Log Rotate
```bash
pm2 install pm2-logrotate

# Configure max log size (10MB)
pm2 set pm2-logrotate:max_size 10M

# Keep last 7 rotated logs
pm2 set pm2-logrotate:retain 7

# Compress rotated logs
pm2 set pm2-logrotate:compress true

# Rotate daily at midnight
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```

### Verify Log Rotate Config
```bash
pm2 conf pm2-logrotate
```

---

## 📅 Automated Cleanup (Cron Job)

### Setup Weekly Cleanup
```bash
# Edit crontab
crontab -e

# Add this line (runs every Sunday at 2 AM):
0 2 * * 0 find /home/ec2-user/awh-outbound-orchestrator/data/blocklist-attempts/ -name "attempts_*.json" -mtime +30 -delete
0 2 * * 0 find /home/ec2-user/awh-outbound-orchestrator/data/daily-calls/ -name "calls_*.json" -mtime +30 -delete
0 2 * * 0 find /home/ec2-user/awh-outbound-orchestrator/data/statistics/ -name "stats_*.json" -mtime +30 -delete
0 3 * * 0 pm2 flush
```

### Verify Cron Jobs
```bash
crontab -l
```

---

## 🎯 Recommended Monitoring Commands

### Daily Check (Run Once Per Day)
```bash
#!/bin/bash
echo "=== Disk Usage ==="
df -h

echo -e "\n=== Data Directory Size ==="
du -sh /home/ec2-user/awh-outbound-orchestrator/data/*

echo -e "\n=== PM2 Logs Size ==="
du -sh ~/.pm2/logs/

echo -e "\n=== PM2 Status ==="
pm2 status

echo -e "\n=== File Counts ==="
echo "Blocklist attempts: $(ls -1 /home/ec2-user/awh-outbound-orchestrator/data/blocklist-attempts/ | wc -l) files"
echo "Daily calls: $(ls -1 /home/ec2-user/awh-outbound-orchestrator/data/daily-calls/ | wc -l) files"
echo "Statistics: $(ls -1 /home/ec2-user/awh-outbound-orchestrator/data/statistics/ | wc -l) files"
```

Save as `~/daily-check.sh` and run:
```bash
chmod +x ~/daily-check.sh
./daily-check.sh
```

---

## 📝 Summary

**Check Storage:**
```bash
df -h                                              # Disk usage
du -sh /home/ec2-user/awh-outbound-orchestrator/   # App size
du -sh ~/.pm2/logs/                                # Logs size
```

**Clean Up:**
```bash
pm2 flush                                          # Clear logs
find data/blocklist-attempts/ -mtime +30 -delete   # Old attempts
```

**Monitor:**
```bash
pm2 monit                                          # Real-time monitoring
pm2 show awh-orchestrator                          # Detailed info
```

**Setup Automation:**
```bash
pm2 install pm2-logrotate                          # Auto log rotation
crontab -e                                         # Auto cleanup
```

---

**Created:** December 24, 2024
**For:** AWS EC2 Instance Running awh-orchestrator
**Current Status:** 222.9 MB RAM, 5 days uptime, 44 restarts
