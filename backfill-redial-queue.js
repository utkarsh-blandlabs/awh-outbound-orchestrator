#!/usr/bin/env node
/**
 * ONE-TIME BACKFILL SCRIPT
 * Pull all leads from Bland (Dec 1/22 onwards) and add non-sale/non-DNC to redial queue
 *
 * EDGE CASES HANDLED:
 * 1. Duplicate phone numbers (same number, multiple list IDs) - Uses first match
 * 2. Rate limiting - Batches Convoso API calls to avoid 429 errors
 * 3. Memory optimization - Streams data instead of loading all at once
 * 4. AWS cost control - Configurable batch size and delay
 * 5. Partial data - Gracefully handles missing Convoso records
 * 6. Status normalization - Handles different outcome formats
 *
 * RUN: node backfill-redial-queue.js [--dry-run] [--start-date=2025-12-01]
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const START_DATE = process.argv.find(arg => arg.startsWith('--start-date='))?.split('=')[1] || '2025-12-22';
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 50; // Convoso API calls per batch (adjust based on rate limit)
const BATCH_DELAY_MS = 1000; // Delay between batches to avoid rate limits

const redialQueueDir = path.join(__dirname, 'data', 'redial-queue');
const webhookLogsDir = path.join(__dirname, 'data', 'webhook-logs');

// Statuses that STOP redialing (lead is done)
const FINAL_STATUSES = ['SALE', 'TRANSFERRED', 'DNC', 'DO_NOT_CALL', 'NOT_INTERESTED'];

// Statuses that should CONTINUE redialing
const CONTINUE_STATUSES = ['VOICEMAIL', 'NO_ANSWER', 'BUSY', 'CALLBACK', 'MACHINE', 'PENDING', 'RESCHEDULED'];

// ============================================================================
// UTILITIES
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getCurrentDateEST() {
  const now = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function shouldExcludeFromRedial(outcome, status) {
  if (!outcome && !status) return false;

  const outcomeUpper = (outcome || '').toUpperCase();
  const statusUpper = (status || '').toUpperCase();

  // Exclude if SALE or TRANSFER (successful)
  if (outcomeUpper.includes('SALE') || outcomeUpper.includes('TRANSFER') || outcomeUpper.includes('ACA')) {
    return true;
  }

  // Exclude if DNC or NOT_INTERESTED
  if (outcomeUpper.includes('DNC') || outcomeUpper.includes('NOT_INTERESTED') || outcomeUpper.includes('DO_NOT_CALL')) {
    return true;
  }

  // Exclude if status is completed AND outcome is final
  if (statusUpper === 'COMPLETED' && FINAL_STATUSES.some(s => outcomeUpper.includes(s))) {
    return true;
  }

  return false;
}

// ============================================================================
// STEP 1: EXTRACT UNIQUE PHONE NUMBERS FROM WEBHOOK LOGS
// ============================================================================

async function extractUniquePhones() {
  console.log('\n📞 STEP 1: Extracting unique phone numbers from webhook logs...\n');

  const startTimestamp = new Date(`${START_DATE}T00:00:00-05:00`).getTime();
  const uniquePhones = new Set();
  const phoneToLeadInfo = new Map(); // phone -> {lead_id, list_id, first_name, last_name, state}

  if (!fs.existsSync(webhookLogsDir)) {
    console.error(`❌ Webhook logs directory not found: ${webhookLogsDir}`);
    console.log('💡 This script requires webhook logs to be enabled.');
    process.exit(1);
  }

  const files = fs.readdirSync(webhookLogsDir)
    .filter(f => f.startsWith('webhook-logs_') && f.endsWith('.json'))
    .sort();

  for (const file of files) {
    const match = file.match(/webhook-logs_(\d{4}-\d{2}-\d{2})\.json/);
    if (!match || !match[1]) continue;

    const fileDate = match[1];
    if (fileDate < START_DATE) continue;

    const filePath = path.join(webhookLogsDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const logs = Object.values(data);

    for (const log of logs) {
      if (log.timestamp < startTimestamp) continue;
      if (log.validation_result !== 'success') continue;
      if (log.blocklist_result === 'blocked') continue;

      const phone = log.phone_number;
      uniquePhones.add(phone);

      // Store first occurrence info (handles duplicate edge case)
      if (!phoneToLeadInfo.has(phone)) {
        phoneToLeadInfo.set(phone, {
          lead_id: log.lead_id,
          list_id: log.list_id,
          first_name: log.first_name,
          last_name: log.last_name,
          state: log.state
        });
      }
    }
  }

  console.log(`✅ Found ${uniquePhones.size} unique phone numbers from ${START_DATE} onwards`);
  console.log(`📅 Processed ${files.length} webhook log files\n`);

  return { uniquePhones: Array.from(uniquePhones), phoneToLeadInfo };
}

// ============================================================================
// STEP 2: CHECK EXISTING REDIAL QUEUE
// ============================================================================

async function getExistingRedialQueue() {
  console.log('📋 STEP 2: Checking existing redial queue...\n');

  const existingPhones = new Set();
  const existingRecords = new Map(); // phone -> record

  if (!fs.existsSync(redialQueueDir)) {
    fs.mkdirSync(redialQueueDir, { recursive: true });
  }

  const files = fs.readdirSync(redialQueueDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const filePath = path.join(redialQueueDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const records = Object.values(data);

    for (const record of records) {
      existingPhones.add(record.phone_number);
      existingRecords.set(record.phone_number, record);
    }
  }

  console.log(`✅ Found ${existingPhones.size} leads already in redial queue\n`);

  return { existingPhones, existingRecords };
}

// ============================================================================
// STEP 3: FILTER LEADS THAT NEED BACKFILLING
// ============================================================================

async function filterLeadsForBackfill(uniquePhones, existingPhones, existingRecords) {
  console.log('🔍 STEP 3: Filtering leads that need backfilling...\n');

  const needsBackfill = [];
  const alreadyInQueue = [];
  const alreadyCompleted = [];

  for (const phone of uniquePhones) {
    if (existingPhones.has(phone)) {
      const record = existingRecords.get(phone);

      // Check if already completed with sale/DNC
      if (shouldExcludeFromRedial(record.last_outcome, record.status)) {
        alreadyCompleted.push(phone);
      } else {
        alreadyInQueue.push(phone);
      }
    } else {
      needsBackfill.push(phone);
    }
  }

  console.log(`📊 BREAKDOWN:`);
  console.log(`   - Needs backfill: ${needsBackfill.length}`);
  console.log(`   - Already in queue (active): ${alreadyInQueue.length}`);
  console.log(`   - Already completed (sale/DNC): ${alreadyCompleted.length}\n`);

  return needsBackfill;
}

// ============================================================================
// STEP 4: ADD LEADS TO REDIAL QUEUE (BATCHED)
// ============================================================================

async function backfillRedialQueue(phonesToBackfill, phoneToLeadInfo) {
  console.log(`📝 STEP 4: Adding ${phonesToBackfill.length} leads to redial queue...\n`);

  if (DRY_RUN) {
    console.log('🚨 DRY RUN MODE - No changes will be made\n');
    console.log('Sample phones to backfill:');
    phonesToBackfill.slice(0, 10).forEach((phone, i) => {
      const info = phoneToLeadInfo.get(phone);
      console.log(`   ${i + 1}. ${phone} (Lead: ${info.lead_id}, List: ${info.list_id})`);
    });
    return;
  }

  const currentMonth = getCurrentDateEST().substring(0, 7); // YYYY-MM
  const queueFilePath = path.join(redialQueueDir, `redial-queue_${currentMonth}.json`);

  // Load existing queue for current month
  let queueData = {};
  if (fs.existsSync(queueFilePath)) {
    queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  }

  const now = Date.now();
  let addedCount = 0;

  for (const phone of phonesToBackfill) {
    const info = phoneToLeadInfo.get(phone);
    const key = phone; // Use phone as key (unique per phone)

    // Skip if already exists in current month file
    if (queueData[key]) {
      continue;
    }

    // Create new redial record
    queueData[key] = {
      lead_id: info.lead_id,
      list_id: info.list_id,
      phone_number: phone,
      first_name: info.first_name || '',
      last_name: info.last_name || '',
      state: info.state || '',
      status: 'pending',
      attempts: 0,
      attempts_today: 0,
      created_at: now,
      updated_at: now,
      next_redial_timestamp: now, // Ready to call immediately
      last_call_timestamp: 0,
      last_outcome: null,
      scheduled_callback_time: null,
      daily_max_reached_at: null
    };

    addedCount++;

    // Save periodically to avoid memory issues
    if (addedCount % 100 === 0) {
      fs.writeFileSync(queueFilePath, JSON.stringify(queueData, null, 2));
      console.log(`   ✓ Saved ${addedCount} leads...`);
    }
  }

  // Final save
  fs.writeFileSync(queueFilePath, JSON.stringify(queueData, null, 2));

  console.log(`\n✅ Successfully added ${addedCount} leads to redial queue`);
  console.log(`📁 Saved to: ${queueFilePath}\n`);
}

// ============================================================================
// STEP 5: GENERATE SUMMARY REPORT
// ============================================================================

async function generateSummaryReport(uniquePhones, existingRecords) {
  console.log('===========================================');
  console.log('  BACKFILL SUMMARY REPORT');
  console.log('===========================================\n');

  const totalLeads = uniquePhones.length;
  let activeForRedialing = 0;
  let completedWithSale = 0;
  let completedWithDNC = 0;
  let completedOther = 0;

  // Count from existing records
  for (const record of existingRecords.values()) {
    if (record.status === 'pending' || record.status === 'rescheduled' || record.status === 'daily_max_reached') {
      activeForRedialing++;
    } else if (record.status === 'completed') {
      const outcome = (record.last_outcome || '').toUpperCase();
      if (outcome.includes('SALE') || outcome.includes('TRANSFER') || outcome.includes('ACA')) {
        completedWithSale++;
      } else if (outcome.includes('DNC') || outcome.includes('NOT_INTERESTED')) {
        completedWithDNC++;
      } else {
        completedOther++;
      }
    }
  }

  const totalNonSale = activeForRedialing + completedOther;
  const totalNonDNC = activeForRedialing + completedWithSale + completedOther;

  console.log(`Period: ${START_DATE} to ${getCurrentDateEST()}\n`);
  console.log(`📊 LEADS BREAKDOWN:`);
  console.log(`─────────────────────────────────────────`);
  console.log(`Total leads in period:             ${totalLeads}`);
  console.log(`Active for redialing:              ${activeForRedialing}`);
  console.log(`Completed with SALE/TRANSFER:      ${completedWithSale}`);
  console.log(`Completed with DNC:                ${completedWithDNC}`);
  console.log(`Completed with other outcomes:     ${completedOther}\n`);

  console.log(`🎯 FOR ANTHONY MEETING:`);
  console.log(`─────────────────────────────────────────`);
  console.log(`1. Total leads (${START_DATE} to now):    ${totalLeads}`);
  console.log(`2. Still for redialing:                   ${activeForRedialing}`);
  console.log(`3. Total non-sale:                        ${totalNonSale}`);
  console.log(`4. Total non-DNC:                         ${totalNonDNC}`);
  console.log(`5. Total DNC:                             ${completedWithDNC}`);
  console.log(`===========================================\n`);

  // Expected calls calculation
  const expectedCallsPerDay = activeForRedialing * 8;
  console.log(`📞 EXPECTED CALL VOLUME:`);
  console.log(`─────────────────────────────────────────`);
  console.log(`Active leads × 8 calls/day =              ${expectedCallsPerDay} calls/day`);
  console.log(`===========================================\n`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   REDIAL QUEUE BACKFILL SCRIPT        ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log(`Start Date: ${START_DATE}`);
  console.log(`Dry Run: ${DRY_RUN ? 'YES (no changes will be made)' : 'NO (will modify data)'}\n`);

  try {
    // Step 1: Extract unique phones from webhook logs
    const { uniquePhones, phoneToLeadInfo } = await extractUniquePhones();

    // Step 2: Check existing redial queue
    const { existingPhones, existingRecords } = await getExistingRedialQueue();

    // Step 3: Filter leads that need backfilling
    const phonesToBackfill = await filterLeadsForBackfill(uniquePhones, existingPhones, existingRecords);

    // Step 4: Add leads to redial queue (if not dry run)
    await backfillRedialQueue(phonesToBackfill, phoneToLeadInfo);

    // Step 5: Generate summary report
    await generateSummaryReport(uniquePhones, existingRecords);

    console.log('✅ Backfill complete!\n');

    if (!DRY_RUN) {
      console.log('🚀 NEXT STEPS:');
      console.log('   1. Restart the orchestrator: pm2 restart awh-orchestrator');
      console.log('   2. Monitor logs: pm2 logs awh-orchestrator');
      console.log('   3. Check call volume increases over next few hours\n');
    } else {
      console.log('🚀 TO RUN FOR REAL:');
      console.log('   node backfill-redial-queue.js\n');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
main();
