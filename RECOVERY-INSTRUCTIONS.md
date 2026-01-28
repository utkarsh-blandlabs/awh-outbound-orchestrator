# Data Recovery Instructions

## ⚠️ CRITICAL: Data Loss Incident

A buggy script was run that set all `answered_calls` values to 0 in the statistics files. The script incorrectly tried to recalculate answered_calls from daily-calls files, but those files don't contain the pathway_tags needed for accurate calculations.

## What Happened

1. **The Bug**: The fix script looked for `pathway_tags` in `data/daily-calls/*.json` files
2. **The Problem**: Daily calls files only store: `call_id`, `timestamp`, `status`, `lead_id`, `request_id`
3. **Missing Data**: Pathway tags come from Bland webhooks and aren't persisted to daily calls files
4. **Result**: All answered_calls were set to 0 because no pathway_tags were found

## Recovery Options

### Option 1: Restore from Backup (RECOMMENDED)

If you have backups of your statistics files:

```bash
# 1. Create backup directory
mkdir -p data/statistics-backup

# 2. Copy your backup statistics files there
cp /path/to/backup/stats_*.json data/statistics-backup/

# 3. Run restore script
npx ts-node scripts/restore-answered-calls-from-backup.ts
```

### Option 2: Manual Correction

If you don't have backups, you'll need to manually update the statistics files or regenerate them from source data (if available).

## Prevention

The buggy script has been deleted. Do NOT attempt to regenerate answered_calls from daily-calls files, as they don't contain the necessary data.

## What Was Lost

All `answered_calls` values in:
- `data/statistics/stats_*.json` files

The old values (before the bug fix) were technically incorrect (they counted voicemail as answered), but they were at least non-zero. The script set them all to 0.

## Contact

If you need help recovering the data, please reach out with:
1. Your backup files (if available)
2. Any other data sources that might have the call outcomes
3. The date range that needs to be recovered
