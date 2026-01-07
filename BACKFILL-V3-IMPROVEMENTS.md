# Backfill v3 - Date-by-Date Processing

## 🎯 What Changed

### Old Approach (v2) - Paginated
```
Fetch page 1 (1000 calls)
Fetch page 2 (1000 calls)
Fetch page 3 (1000 calls)
...
Fetch page 209 (1000 calls)

Result: "178 unique phones total"
```

**Problem**: Can't tell WHEN leads came in or daily patterns

---

### New Approach (v3) - Date-by-Date ⭐
```
📅 2025-12-01
   ✓ 500 calls | 45 unique today | 45 total unique

📅 2025-12-02
   ✓ 650 calls | 12 unique today | 57 total unique

📅 2025-12-03
   ✓ 400 calls | 8 unique today | 65 total unique
...

Result: Daily breakdown + total summary
```

**Benefit**: See exactly when leads came in and daily volume!

---

## 📊 Output Example (v3)

```
╔═══════════════════════════════════════════════════╗
║   DATE-BY-DATE BACKFILL v3 FROM BLAND.AI        ║
╚═══════════════════════════════════════════════════╝

Processing 38 dates: 2025-12-01 to 2026-01-07

📅 2025-12-01
   ✓ 500 calls | 45 unique today | 45 total unique | Memory: 10MB

📅 2025-12-02
   ✓ 650 calls | 12 unique today | 57 total unique | Memory: 11MB

📅 2025-12-03
   ✓ 400 calls | 8 unique today | 65 total unique | Memory: 12MB

... (continues for all 38 days)

============================================================
📊 SUMMARY BY DATE
============================================================

2025-12-01:   500 calls |  45 new |  45 total
2025-12-02:   650 calls |  12 new |  57 total
2025-12-03:   400 calls |   8 new |  65 total
2025-12-04:   720 calls |  15 new |  80 total
... (all dates)
2026-01-07:   450 calls |   2 new | 178 total

------------------------------------------------------------
TOTALS: 22000 calls | 178 unique phones
============================================================
```

---

## 💡 Why This Is Better

### 1. **Daily Visibility**
- See which days had most activity
- Track when new leads came in
- Identify patterns (weekdays vs weekends)

### 2. **Better Tracking**
- "45 new leads on Dec 1" vs "178 total"
- Can verify against Zapier/Convoso send logs
- Easy to spot anomalies (0 new leads on a day)

### 3. **Easier Debugging**
- If numbers don't match, know which date to investigate
- Can re-run for specific date ranges
- Clear audit trail

### 4. **Progress Tracking**
- See "Day 5 of 38 complete"
- Know exactly how much is left
- Can stop/resume by date

---

## 🔄 Processing Flow

### Step 1: Fetch by Date (Improved!)
```
For each date (Dec 1 - Jan 7):
  ├─ Fetch all calls for THAT DATE ONLY
  ├─ Extract unique phones for that day
  ├─ Show: "650 calls | 12 NEW unique phones"
  ├─ Update global phone map (keeps latest)
  └─ Continue to next date
```

### Step 2: Check Convoso (Same as v2)
```
After all dates processed:
  ├─ Batch check all 178 phones in Convoso
  ├─ Get outcome/status for each
  └─ Identify which have SALE/DNC
```

### Step 3: Filter (Same as v2)
```
From Convoso results:
  ├─ Skip SALE (already converted)
  ├─ Skip DNC (do not call)
  ├─ Keep VOICEMAIL, NO_ANSWER, TRANSFERRED, etc.
  └─ Final list: leads that need redialing
```

### Step 4: Add to Queue (Same as v2)
```
For remaining leads:
  ├─ Add to redial queue JSON
  ├─ Skip if already in queue
  └─ Save to data/redial-queue/redial-queue_2026-01.json
```

---

## 📈 What You'll Learn

After running v3, you'll know:

1. **Total unique leads**: 178
2. **Daily breakdown**: How many new leads each day
3. **Call distribution**: Which days had most activity
4. **Lead acquisition pattern**: Steady stream or batches?
5. **Verification**: Can cross-check with Zapier logs

**Example insights**:
```
Dec 1: 45 new leads  ← Big batch from Zapier
Dec 2: 12 new leads  ← Normal flow
Dec 3: 8 new leads   ← Normal flow
Dec 4: 0 new leads   ← Weekend? System down?
```

---

## 🆚 Comparison

| Feature | v2 (Paginated) | v3 (Date-by-Date) |
|---------|----------------|-------------------|
| **Progress visibility** | "Page 22 of 209" | "Dec 5 of 38 days" |
| **Daily stats** | ❌ No | ✅ Yes |
| **New leads per day** | ❌ Can't tell | ✅ Shows each day |
| **Audit trail** | ❌ Just totals | ✅ Daily breakdown |
| **Debugging** | ❌ Hard | ✅ Easy (by date) |
| **Speed** | Same | Same |
| **Memory usage** | Same | Same |
| **Resume capability** | ✅ Yes (by page) | ✅ Yes (by date) |

---

## 🚀 How to Use

### Run the New v3 Script

**Stop any running v2**:
```bash
# If v2 is still running, stop it (Ctrl+C)
```

**Start v3**:
```bash
ssh -i ~/downloads/awh-outbound-orchestrator-key-pair.pem ec2-user@ec2-56-228-64-116.eu-north-1.compute.amazonaws.com
cd /var/www/awh-orchestrator

# Test first (no changes)
npm run backfill:dry-run

# Real run
npm run backfill
```

**Monitor Progress**:
```bash
# In real-time
# You'll see:
📅 2025-12-01
   ✓ 500 calls | 45 unique today | 45 total unique

📅 2025-12-02
   ✓ 650 calls | 12 unique today | 57 total unique
```

**Review Results**:
```bash
# After completion, view daily stats
cat data/backfill-stats.json
```

---

## 📋 Output Files

### 1. Daily Stats (NEW!)
**File**: `data/backfill-stats.json`

```json
[
  {
    "date": "2025-12-01",
    "totalCalls": 500,
    "uniquePhones": 45,
    "cumulativeUniquePhones": 45
  },
  {
    "date": "2025-12-02",
    "totalCalls": 650,
    "uniquePhones": 12,
    "cumulativeUniquePhones": 57
  }
]
```

### 2. Redial Queue (Same as v2)
**File**: `data/redial-queue/redial-queue_2026-01.json`

```json
{
  "5619565858": {
    "lead_id": "123456",
    "phone_number": "5619565858",
    "status": "pending",
    "attempts": 0,
    ...
  }
}
```

---

## ⚡ Performance

**Speed**: Same as v2
- Both use 1000 calls/page limit
- Both have retry logic
- Both have exponential backoff

**Memory**: Same as v2
- Processes incrementally
- Forces GC periodically
- Saves stats every 5 days

**Reliability**: Better than v2
- Can resume by date (more granular)
- Saves progress more frequently
- Better error handling per date

---

## 🎯 Summary

**v3 gives you**:
✅ Daily breakdown of leads
✅ New leads per day tracking
✅ Better audit trail
✅ Easier verification
✅ Same speed & reliability as v2

**You'll know**:
- Exactly when leads came in
- Which days were busy
- If any days are missing leads
- Easy to cross-check with Zapier

**Run it now**:
```bash
npm run backfill:dry-run   # Test
npm run backfill            # Real
```

Much better tracking and visibility! 🎉
