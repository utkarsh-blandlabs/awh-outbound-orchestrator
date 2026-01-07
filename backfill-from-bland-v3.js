#!/usr/bin/env node
/**
 * BACKFILL SCRIPT v3 - Date-by-Date Processing
 *
 * NEW APPROACH:
 * 1. Fetch calls DAY BY DAY (better tracking)
 * 2. Show daily stats (unique leads per day)
 * 3. THEN check all leads in Convoso (batched)
 * 4. Filter out SALE/DNC
 * 5. Add remaining to redial queue
 *
 * Benefits:
 * - Better visibility (daily metrics)
 * - Easier to tally and verify
 * - Can stop/resume by date
 * - Clearer progress tracking
 *
 * RUN: node --max-old-space-size=2048 --expose-gc backfill-from-bland-v3.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ============================================================================
// CONFIGURATION
// ============================================================================

const START_DATE = '2025-12-01'; // December 1, 2025
const END_DATE = '2026-01-07';   // January 7, 2026

const DRY_RUN = process.argv.includes('--dry-run');

// API delays
const BLAND_BATCH_DELAY_MS = 1000;
const CONVOSO_BATCH_SIZE = 50;
const CONVOSO_BATCH_DELAY_MS = 1000;

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 60000;

// Load environment variables
require('dotenv').config();

const BLAND_API_KEY = process.env.BLAND_API_KEY;
const CONVOSO_AUTH_TOKEN = process.env.CONVOSO_AUTH_TOKEN;
const CONVOSO_DOMAIN = process.env.CONVOSO_DOMAIN || 'blandlabs-ai.hostedcc.com';

const redialQueueDir = path.join(__dirname, 'data', 'redial-queue');
const statsFile = path.join(__dirname, 'data', 'backfill-stats.json');

// Statuses that STOP redialing
const FINAL_STATUSES = ['SALE', 'ACA', 'DNC', 'DO_NOT_CALL', 'NOT_INTERESTED'];

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

function forceGC() {
  if (global.gc) {
    global.gc();
  }
}

function getDateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function makeHttpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (postData) {
      req.write(postData);
    }

    req.end();
  });
}

// ============================================================================
// STEP 1: FETCH CALLS BY DATE (WITH RETRY LOGIC)
// ============================================================================

async function fetchPageWithRetry(page, retryCount = 0) {
  const options = {
    hostname: 'api.bland.ai',
    port: 443,
    path: `/v1/calls?page=${page}&limit=1000`,
    method: 'GET',
    headers: {
      'Authorization': BLAND_API_KEY,
      'Content-Type': 'application/json'
    }
  };

  try {
    const response = await makeHttpsRequest(options);

    if (response.statusCode === 200) {
      return { success: true, data: response.data };
    }

    // Rate limiting or server error
    if (response.statusCode === 429 || response.statusCode === 500 || response.statusCode === 503) {
      if (retryCount < MAX_RETRIES) {
        const delay = Math.min(
          INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount),
          MAX_RETRY_DELAY_MS
        );
        console.log(`   ⚠️  API error ${response.statusCode}, retrying in ${delay / 1000}s... (${retryCount + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        return fetchPageWithRetry(page, retryCount + 1);
      }
    }

    return {
      success: false,
      error: `API returned status ${response.statusCode}`
    };

  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const delay = Math.min(
        INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount),
        MAX_RETRY_DELAY_MS
      );
      console.log(`   ⚠️  Network error, retrying in ${delay / 1000}s... (${retryCount + 1}/${MAX_RETRIES})`);
      await sleep(delay);
      return fetchPageWithRetry(page, retryCount + 1);
    }

    return { success: false, error: error.message };
  }
}

async function fetchCallsForDate(date) {
  const dayStart = new Date(`${date}T00:00:00-05:00`).getTime();
  const dayEnd = new Date(`${date}T23:59:59-05:00`).getTime();

  const phoneMap = new Map(); // phone -> {lead_data, created_at}
  let page = 1;
  let hasMore = true;
  let totalCalls = 0;
  let consecutiveErrors = 0;

  while (hasMore) {
    const result = await fetchPageWithRetry(page);

    if (!result.success) {
      console.error(`   ❌ ${result.error}`);
      consecutiveErrors++;
      if (consecutiveErrors >= 5) {
        throw new Error(`Too many errors fetching calls for ${date}`);
      }
      await sleep(5000);
      page++;
      continue;
    }

    consecutiveErrors = 0;
    const calls = result.data.calls || [];

    if (calls.length === 0) {
      break;
    }

    let callsInThisDate = 0;
    let callsBeforeDate = 0;

    for (const call of calls) {
      const callTime = new Date(call.created_at).getTime();

      // Check if we've gone past the target date
      if (callTime < dayStart) {
        callsBeforeDate++;
      }

      // Only process calls from this specific date
      if (callTime >= dayStart && callTime <= dayEnd) {
        callsInThisDate++;
        totalCalls++;

        const phone = call.to || call.phone_number;
        if (!phone) continue;

        const metadata = call.request_data || call.variables || {};
        const leadId = metadata.lead_id || metadata.leadId || call.call_id;
        const listId = metadata.list_id || metadata.listId || '';

        // Keep LATEST call per phone for this date
        const existing = phoneMap.get(phone);
        if (!existing || callTime > existing.created_at) {
          phoneMap.set(phone, {
            phone_number: phone,
            lead_id: leadId,
            list_id: listId,
            first_name: metadata.first_name || metadata.firstName || '',
            last_name: metadata.last_name || metadata.lastName || '',
            state: metadata.state || '',
            created_at: callTime,
            call_id: call.call_id,
            date: date
          });
        }
      }
    }

    // If we found calls before this date, we've gone too far
    if (callsBeforeDate > callsInThisDate && callsInThisDate === 0) {
      hasMore = false;
      break;
    }

    // If no calls in this date, might need to go further
    if (callsInThisDate === 0 && callsBeforeDate === 0) {
      // All calls are after this date, continue
      page++;
      await sleep(BLAND_BATCH_DELAY_MS);
      continue;
    }

    page++;
    await sleep(BLAND_BATCH_DELAY_MS);
  }

  return {
    date,
    totalCalls,
    uniquePhones: phoneMap.size,
    phoneData: Array.from(phoneMap.values())
  };
}

async function processBlandCallsByDate() {
  console.log('\n📞 STEP 1: Processing calls from Bland.ai (DATE BY DATE)...\n');

  if (!BLAND_API_KEY) {
    throw new Error('BLAND_API_KEY not found in environment variables');
  }

  const dates = getDateRange(START_DATE, END_DATE);
  console.log(`Processing ${dates.length} dates: ${START_DATE} to ${END_DATE}\n`);

  const dailyStats = [];
  const allPhones = new Map(); // Global phone map (keeps latest across all dates)

  for (const date of dates) {
    console.log(`📅 ${date}`);

    try {
      const dayResult = await fetchCallsForDate(date);

      // Update global phone map
      for (const phoneData of dayResult.phoneData) {
        const existing = allPhones.get(phoneData.phone_number);
        if (!existing || phoneData.created_at > existing.created_at) {
          allPhones.set(phoneData.phone_number, phoneData);
        }
      }

      dailyStats.push({
        date: dayResult.date,
        totalCalls: dayResult.totalCalls,
        uniquePhones: dayResult.uniquePhones,
        cumulativeUniquePhones: allPhones.size
      });

      console.log(`   ✓ ${dayResult.totalCalls} calls | ${dayResult.uniquePhones} unique today | ${allPhones.size} total unique | Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB\n`);

      // Save stats periodically
      if (dailyStats.length % 5 === 0) {
        saveDailyStats(dailyStats);
      }

      // Force GC periodically
      if (dailyStats.length % 7 === 0) {
        forceGC();
      }

    } catch (error) {
      console.error(`   ❌ Error processing ${date}: ${error.message}\n`);
      // Continue with next date
    }
  }

  // Final stats save
  saveDailyStats(dailyStats);

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY BY DATE');
  console.log('='.repeat(60) + '\n');

  dailyStats.forEach(stat => {
    console.log(`${stat.date}: ${stat.totalCalls.toString().padStart(5)} calls | ${stat.uniquePhones.toString().padStart(3)} new | ${stat.cumulativeUniquePhones.toString().padStart(3)} total`);
  });

  const totalCalls = dailyStats.reduce((sum, s) => sum + s.totalCalls, 0);
  console.log('\n' + '-'.repeat(60));
  console.log(`TOTALS: ${totalCalls} calls | ${allPhones.size} unique phones`);
  console.log('='.repeat(60) + '\n');

  return allPhones;
}

function saveDailyStats(stats) {
  const statsDir = path.dirname(statsFile);
  if (!fs.existsSync(statsDir)) {
    fs.mkdirSync(statsDir, { recursive: true });
  }
  fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
}

// ============================================================================
// STEP 2: CHECK CONVOSO STATUS (BATCHED)
// ============================================================================

async function checkConvosoStatus(phoneNumber, listId) {
  if (!CONVOSO_AUTH_TOKEN) {
    return { outcome: 'UNKNOWN', status: 'UNKNOWN' };
  }

  try {
    const searchOptions = {
      hostname: CONVOSO_DOMAIN,
      port: 443,
      path: `/api/lead/search?phone=${encodeURIComponent(phoneNumber)}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CONVOSO_AUTH_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const searchResponse = await makeHttpsRequest(searchOptions);

    if (searchResponse.statusCode === 200 && searchResponse.data && searchResponse.data.leads && searchResponse.data.leads.length > 0) {
      const lead = searchResponse.data.leads[0];
      return {
        outcome: lead.outcome || lead.status || 'UNKNOWN',
        status: lead.status || 'UNKNOWN'
      };
    }

    return { outcome: 'UNKNOWN', status: 'UNKNOWN' };

  } catch (error) {
    console.error(`   ⚠️  Error checking Convoso for ${phoneNumber}:`, error.message);
    return { outcome: 'UNKNOWN', status: 'UNKNOWN' };
  }
}

async function batchCheckConvosoStatus(phoneLeads) {
  console.log('\n🔍 STEP 2: Checking Convoso status (batched)...\n');

  const results = [];
  const totalBatches = Math.ceil(phoneLeads.length / CONVOSO_BATCH_SIZE);

  for (let i = 0; i < phoneLeads.length; i += CONVOSO_BATCH_SIZE) {
    const batch = phoneLeads.slice(i, i + CONVOSO_BATCH_SIZE);
    const batchNum = Math.floor(i / CONVOSO_BATCH_SIZE) + 1;

    console.log(`   Batch ${batchNum}/${totalBatches}: Checking ${batch.length} leads...`);

    const batchPromises = batch.map(async (lead) => {
      const status = await checkConvosoStatus(lead.phone_number, lead.list_id);
      return { ...lead, convoso_outcome: status.outcome, convoso_status: status.status };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Force GC every 10 batches
    if (batchNum % 10 === 0) {
      forceGC();
    }

    await sleep(CONVOSO_BATCH_DELAY_MS);
  }

  console.log(`\n✅ Checked ${results.length} leads in Convoso\n`);
  return results;
}

// ============================================================================
// STEP 3: FILTER FOR REDIAL QUEUE
// ============================================================================

function filterLeadsForRedial(leadsWithStatus) {
  console.log('📊 STEP 3: Filtering leads for redial queue...\n');

  const shouldRedial = [];
  const skipSale = [];
  const skipDNC = [];
  const skipUnknown = [];

  for (const lead of leadsWithStatus) {
    const outcome = (lead.convoso_outcome || '').toUpperCase();

    // Check for SALE - STOPS redialing
    if (outcome.includes('SALE') || outcome.includes('ACA')) {
      skipSale.push(lead);
      continue;
    }

    // Check for DNC - STOPS redialing
    if (outcome.includes('DNC') || outcome.includes('NOT_INTERESTED') || outcome.includes('DO_NOT_CALL')) {
      skipDNC.push(lead);
      continue;
    }

    // Skip unknown status (couldn't find in Convoso)
    if (outcome === 'UNKNOWN') {
      skipUnknown.push(lead);
      // Add to redial queue anyway (assume needs calling)
      shouldRedial.push(lead);
      continue;
    }

    // Everything else should continue redialing
    shouldRedial.push(lead);
  }

  console.log(`   ✅ Should redial: ${shouldRedial.length}`);
  console.log(`   ⏭️  Skip (SALE): ${skipSale.length}`);
  console.log(`   ⏭️  Skip (DNC): ${skipDNC.length}`);
  console.log(`   ⚠️  Unknown status (added to queue): ${skipUnknown.length}\n`);

  return shouldRedial;
}

// ============================================================================
// STEP 4: ADD TO REDIAL QUEUE
// ============================================================================

async function addLeadsToRedialQueue(leadsToAdd) {
  console.log(`📝 STEP 4: Adding ${leadsToAdd.length} leads to redial queue...\n`);

  if (DRY_RUN) {
    console.log('🚨 DRY RUN MODE - No changes will be made\n');
    console.log('Sample leads to add:');
    leadsToAdd.slice(0, 10).forEach((lead, i) => {
      console.log(`   ${i + 1}. ${lead.phone_number} (Lead: ${lead.lead_id}, Date: ${lead.date})`);
    });
    return;
  }

  const currentMonth = getCurrentDateEST().substring(0, 7); // YYYY-MM
  const queueFilePath = path.join(redialQueueDir, `redial-queue_${currentMonth}.json`);

  // Ensure directory exists
  if (!fs.existsSync(redialQueueDir)) {
    fs.mkdirSync(redialQueueDir, { recursive: true });
  }

  // Load existing queue
  let queueData = {};
  if (fs.existsSync(queueFilePath)) {
    queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  }

  const now = Date.now();
  let addedCount = 0;
  let skippedExisting = 0;

  for (const lead of leadsToAdd) {
    const key = lead.phone_number;

    // Skip if already exists
    if (queueData[key]) {
      skippedExisting++;
      continue;
    }

    // Create new redial record
    queueData[key] = {
      lead_id: lead.lead_id,
      list_id: lead.list_id,
      phone_number: lead.phone_number,
      first_name: lead.first_name || '',
      last_name: lead.last_name || '',
      state: lead.state || '',
      status: 'pending',
      attempts: 0,
      attempts_today: 0,
      created_at: now,
      updated_at: now,
      next_redial_timestamp: now, // Ready to call immediately
      last_call_timestamp: 0,
      last_outcome: null,
      scheduled_callback_time: null,
      daily_max_reached_at: null,
      outcomes: []
    };

    addedCount++;

    // Save every 100 leads
    if (addedCount % 100 === 0) {
      fs.writeFileSync(queueFilePath, JSON.stringify(queueData, null, 2));
      console.log(`   ✓ Saved ${addedCount} leads...`);

      // Force GC every 500 leads
      if (addedCount % 500 === 0) {
        forceGC();
      }
    }
  }

  // Final save
  fs.writeFileSync(queueFilePath, JSON.stringify(queueData, null, 2));

  console.log(`\n✅ Successfully added ${addedCount} new leads to redial queue`);
  console.log(`⏭️  Skipped ${skippedExisting} leads (already in queue)`);
  console.log(`📁 Saved to: ${queueFilePath}\n`);

  // Expected daily calls
  const expectedDailyCalls = addedCount * 8;
  console.log(`📞 EXPECTED DAILY CALL VOLUME: ${expectedDailyCalls.toLocaleString()} calls/day\n`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   DATE-BY-DATE BACKFILL v3 FROM BLAND.AI        ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  console.log(`Date Range: ${START_DATE} to ${END_DATE}`);
  console.log(`Dry Run: ${DRY_RUN ? 'YES (no changes)' : 'NO (will modify data)'}`);
  console.log(`Heap Limit: ${Math.round(require('v8').getHeapStatistics().heap_size_limit / 1024 / 1024)}MB\n`);

  try {
    const startTime = Date.now();

    // Step 1: Process calls DATE BY DATE
    const phoneMap = await processBlandCallsByDate();
    const phoneLeads = Array.from(phoneMap.values());

    // Step 2: Check Convoso status (batched)
    const leadsWithStatus = await batchCheckConvosoStatus(phoneLeads);

    // Step 3: Filter for redial queue
    const leadsToAdd = filterLeadsForRedial(leadsWithStatus);

    // Step 4: Add to redial queue
    await addLeadsToRedialQueue(leadsToAdd);

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    console.log(`⏱️  Total time: ${duration} seconds\n`);

    console.log('✅ Backfill complete!\n');

    if (!DRY_RUN) {
      console.log('🚀 NEXT STEPS:');
      console.log('   1. Restart the orchestrator: pm2 restart awh-orchestrator');
      console.log('   2. Monitor logs: pm2 logs awh-orchestrator');
      console.log('   3. Check call volume increases over next few hours');
      console.log('   4. Review daily stats: cat data/backfill-stats.json\n');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
main();
