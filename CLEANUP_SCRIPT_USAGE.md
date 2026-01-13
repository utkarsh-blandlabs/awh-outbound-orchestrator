# Redial Queue Cleanup Script - Usage Guide

**Script**: `scripts/cleanup-invalid-leads.ts`
**Purpose**: Remove invalid leads from redial queue (empty list_id, invalid phone)
**Created**: January 12, 2026

---

## 🎯 What This Script Does

Safely removes leads from the redial queue that:
- Have **empty `list_id`** (cannot be updated in Convoso)
- Have **invalid phone numbers** (less than 10 digits)
- Are **not actively being called today** (safety check)

**IMPORTANT**: All removed leads are saved to a separate file for your review!

---

## 🔒 Safety Features

1. ✅ **Skips active leads** (attempts_today > 0 or status = "pending") - unless using `--force` flag
2. ✅ **Creates backups** before making changes
3. ✅ **Saves removed leads** to separate file for review
4. ✅ **Dry-run mode** for preview without changes
5. ✅ **Detailed reporting** showing exactly what will be removed
6. ✅ **Force mode** available to remove ALL invalid leads (outside business hours)

---

## 📋 Current Production Stats

**On production server** (as of Jan 12, 2026):

```
Total leads in queue:        4,290
Leads with empty list_id:    2,669 (62%)
Valid leads:                 1,621 (38%)
Failed Convoso updates:      665/day
```

**Expected after cleanup:**
- Remove 2,669 invalid leads
- Keep 1,621 valid leads
- Reduce wasted Bland.ai calls by ~710/day
- Reduce failed Convoso updates from 665/day to 0

---

## 🚀 Usage

### **Step 1: Preview Changes (Dry Run)**

```bash
cd /var/www/awh-orchestrator
npx ts-node scripts/cleanup-invalid-leads.ts --dry-run
```

**Output Example:**
```
==================================================
REDIAL QUEUE CLEANUP - REMOVE INVALID LEADS
==================================================
Mode: DRY RUN (preview only)

📁 Processing: redial-queue_2026-01.json
--------------------------------------------------

BEFORE CLEANUP:
  Total leads:          4290
  Empty list_id:        2669 ❌
  Valid leads:          1621 ✅

REMOVAL BREAKDOWN:
  Empty list_id only:   2650
  Invalid phone only:   15
  Both issues:          4
  Total to remove:      2669 ❌

AFTER CLEANUP:
  Total leads:          1621
  Valid leads:          1621 ✅
  Percentage kept:      37.8%

==================================================
CLEANUP SUMMARY
==================================================
Total leads before:   4290
Total leads after:    1621
Total removed:        2669 (62.2%)

📋 Would save 2669 removed leads to: removed-invalid-leads-[timestamp].json

⚠️  DRY RUN MODE: No changes were applied
Run without --dry-run to apply cleanup
```

---

### **Step 2: Apply Cleanup (3 Options)**

#### **Option 1: Stop Orchestrator First (SAFEST - RECOMMENDED)**

```bash
# Stop orchestrator (no active calls)
pm2 stop awh-orchestrator

# Run cleanup
npx ts-node scripts/cleanup-invalid-leads.ts

# Restart orchestrator
pm2 start awh-orchestrator
```

**Result**: Clean removal of ALL 2,669 invalid leads (100%)

---

#### **Option 2: Run During Business Hours (Orchestrator Running)**

```bash
# Keep orchestrator running
npx ts-node scripts/cleanup-invalid-leads.ts
```

**Result**:
- Removes ~2,400-2,500 invalid leads (90%)
- Skips ~100-200 active leads being called today
- Those skipped leads will be removed tomorrow

---

#### **Option 3: Run After Business Hours (8 PM EST)**

```bash
# Wait until after 8 PM EST (no calls happening)
npx ts-node scripts/cleanup-invalid-leads.ts
```

**Result**: Clean removal of ALL 2,669 invalid leads (100%), no downtime

---

#### **Option 4: Force Mode (Remove ALL Invalid Leads - Outside Business Hours Only)**

⚠️ **Use with caution!** This bypasses safety checks and removes ALL invalid leads including those with `attempts_today > 0`.

```bash
# Preview what will be removed in force mode
npx ts-node scripts/cleanup-invalid-leads.ts --dry-run --force

# Apply force cleanup (removes ALL invalid leads)
npx ts-node scripts/cleanup-invalid-leads.ts --force
```

**When to use `--force`:**

- ✅ Outside business hours (before 9 AM EST or after 8 PM EST)
- ✅ Orchestrator is stopped
- ✅ You want to remove ALL invalid leads regardless of today's call status

**When NOT to use `--force`:**

- ❌ During business hours (9 AM - 8 PM EST)
- ❌ When orchestrator is running and actively making calls
- ❌ If you're unsure about the impact

**Result**: Removes 100% of invalid leads (including those called today)

---

## 📄 Output Files

### **1. Backup Files**
Location: `data/redial-queue/backups/`
```
redial-queue_2026-01.json.backup-1768224829506
```

### **2. Removed Leads File**
Location: `data/redial-queue/`
```
removed-invalid-leads-1768224829506.json
```

**Format:**
```json
[
  {
    "lead_id": "3b419509-99da-4ef3-8264-552ce1ae6209",
    "phone_number": "+14344140007",
    "list_id": "",
    "first_name": "",
    "last_name": "",
    "state": "VA",
    "status": "pending",
    "attempts": 0,
    "attempts_today": 0,
    "last_attempt": null,
    "reason_for_removal": "Empty list_id (cannot update Convoso)",
    "original_file": "redial-queue_2026-01.json"
  },
  ...
]
```

---

## 📊 What to Review in Removed Leads File

**Check these fields:**
- `reason_for_removal`: Why was it removed?
- `list_id`: Should this have been empty?
- `phone_number`: Is this a valid customer?
- `first_name`, `last_name`: Recognize this lead?
- `attempts_today`: Was it being called today?

**If you find leads that shouldn't have been removed:**
1. Check the backup file
2. Restore from `data/redial-queue/backups/`
3. Contact dev team for assistance

---

## 🔍 Verification After Cleanup

### **1. Check File Sizes**
```bash
cd /var/www/awh-orchestrator/data/redial-queue
ls -lh *.json
```

**Before:**
```
-rw-r--r-- 2.6M  redial-queue_2026-01.json
```

**After:**
```
-rw-r--r-- 1.0M  redial-queue_2026-01.json  (reduced from 2.6M)
-rw-r--r-- 1.6M  removed-invalid-leads-1768224829506.json  (saved for review)
```

---

### **2. Monitor Logs**
```bash
pm2 logs awh-orchestrator --lines 50 | grep -E "No such Lead|Failed to update"
```

**Before cleanup**: ~665 "No such Lead" errors/day
**After cleanup**: Should be 0 or very few

---

### **3. Check Stats**
```bash
cd /var/www/awh-orchestrator
cat data/redial-queue/redial-queue_2026-01.json | jq 'length'
cat data/redial-queue/redial-queue_2026-01.json | jq '.[] | select(.list_id == "") | .lead_id' | wc -l
```

**Expected:**
- Total leads: ~1,621 (down from 4,290)
- Empty list_id: 0 (down from 2,669)

---

## ⚠️ Troubleshooting

### **Issue: Script shows "Skipped (active)" leads**
**Cause**: Leads are being called right now
**Solution**:
- Option 1: Stop orchestrator first (safest)
- Option 2: Run after business hours (8 PM EST)
- Option 3: Let it skip them, they'll be removed tomorrow

---

### **Issue: Want to restore removed leads**
**Solution**:
```bash
# Restore from backup
cd /var/www/awh-orchestrator/data/redial-queue
cp backups/redial-queue_2026-01.json.backup-[timestamp] redial-queue_2026-01.json

# Restart orchestrator
pm2 restart awh-orchestrator
```

---

### **Issue: Can't find removed leads file**
**Location**: `data/redial-queue/removed-invalid-leads-[timestamp].json`
```bash
cd /var/www/awh-orchestrator/data/redial-queue
ls -lh removed-invalid-leads-*.json
```

---

## 💡 Best Practices

1. **Always run dry-run first** to preview changes
2. **Review the removed leads file** before deleting it
3. **Keep backups** for at least 7 days
4. **Run cleanup weekly** to prevent buildup
5. **Stop orchestrator** for cleanest results

---

## 📞 Support

**Questions?**
- Check logs: `pm2 logs awh-orchestrator`
- Review removed leads file
- Check backups if needed
- Contact dev team for assistance

---

## 🔗 Related Files

- Script: `scripts/cleanup-invalid-leads.ts`
- Redial queue: `data/redial-queue/redial-queue_2026-01.json`
- Backups: `data/redial-queue/backups/`
- Removed leads: `data/redial-queue/removed-invalid-leads-*.json`
