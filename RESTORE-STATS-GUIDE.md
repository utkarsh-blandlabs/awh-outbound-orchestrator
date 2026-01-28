# Statistics Data Restoration Guide

## ⚠️ What Happened

The fix script incorrectly set all `answered_calls` to 0 in your statistics files. Here's how to restore them.

## Option 1: Restore from Server Backup (RECOMMENDED)

If you have server backups (AWS snapshots, time machine, etc.):

### Step 1: Get Backup Files

```bash
# SSH into your backup or download backup files
# Find the statistics files from before the script ran (before today)
# They should be at: data/statistics/stats_*.json
```

### Step 2: Copy to Backup Directory

```bash
cd /home/ec2-user/awh-orchestrator  # Or your install path

# Create backup directory
mkdir -p data/statistics-backup

# Copy your backup stats files here
cp /path/to/backup/stats_*.json data/statistics-backup/
```

### Step 3: Run Restore Script

```bash
npx ts-node scripts/restore-answered-calls-from-backup.ts
```

This will:
- Read each backup file
- Extract the original `answered_calls` value
- Restore it to the current statistics file
- Preserve all other data

## Option 2: Restore from Git History

If your data directory is in git:

```bash
cd /home/ec2-user/awh-orchestrator

# Check git log to find commit before the script ran
git log --oneline data/statistics/

# Restore statistics directory from that commit
git checkout <commit-hash> -- data/statistics/

# Now copy to backup directory
mkdir -p data/statistics-backup
cp data/statistics/stats_*.json data/statistics-backup/

# Restore to latest
git checkout HEAD -- data/statistics/

# Run restore script
npx ts-node scripts/restore-answered-calls-from-backup.ts
```

## Option 3: Accept Loss and Move Forward

If you don't have backups:

1. **Old data is lost** - `answered_calls` will remain 0 for historical dates
2. **New data is correct** - The fix to the logic is correct, future calls will be accurate
3. **What you lost**: The old `answered_calls` values (which were technically incorrect anyway - they counted voicemail as answered)

### To start fresh:

```bash
cd /home/ec2-user/awh-orchestrator

# The fix is already in place at src/services/statisticsService.ts:239
# New calls will be calculated correctly (only Plan Type = answered, not voicemail)

# Just restart the orchestrator to apply the fix
pm2 restart awh-orchestrator  # Or however you run it
```

## Verification After Restore

```bash
# Check a statistics file
cat data/statistics/stats_2026-01-27.json | jq '.answered_calls'

# Should show a number > 0 (like 256 or 71, not 0)
```

## What the Old vs New Logic Means

**Old Logic (Incorrect):**
- Counted voicemail + human answered
- Example: 2026-01-27 showed 256 answered_calls

**New Logic (Correct):**
- Only counts human answered (Plan Type tag)
- Example: 2026-01-27 should show ~71 answered_calls

**After Buggy Script:**
- Set everything to 0
- Need to restore to get the original numbers back

## Need Help?

If you're on the production server and need help finding backups:

```bash
# Check for AWS EBS snapshots
aws ec2 describe-snapshots --owner-ids self

# Check for automated backups
ls -la /var/backups/
ls -la /home/ec2-user/backups/

# Check if data directory is in git
cd /home/ec2-user/awh-orchestrator
git status data/
```
