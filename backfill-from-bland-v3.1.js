#!/usr/bin/env node
/**
 * BACKFILL SCRIPT v3.1 - Fetch Once, Organize by Date
 *
 * APPROACH:
 * 1. Fetch ALL calls in date range (like v2)
 * 2. Organize by date AS WE GO
 * 3. Show daily stats at the end
 * 4. Check Convoso (batched)
 * 5. Filter and add to queue
 *
 * Why better than v3:
 * - Only paginates ONCE through all calls
 * - Still shows daily breakdown
 * - Much faster (209 requests vs 7,600!)
 *
 * RUN: node --max-old-space-size=2048 --expose-gc backfill-from-bland-v3.1.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ============================================================================
// CONFIGURATION
// ============================================================================

const START_DATE = '2025-12-01';
const END_DATE = '2026-01-07';

const DRY_RUN = process.argv.includes('--dry-run');

const BLAND_BATCH_DELAY_MS = 1000;
const CONVOSO_BATCH_SIZE = 50;
const CONVOSO_BATCH_DELAY_MS = 1000;

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 60000;

require('dotenv').config();

const BLAND_API_KEY = process.env.BLAND_API_KEY;
const CONVOSO_AUTH_TOKEN = process.env.CONVOSO_AUTH_TOKEN;
const CONVOSO_DOMAIN = process.env.CONVOSO_DOMAIN || 'blandlabs-ai.hostedcc.com';

const redialQueueDir = path.join(__dirname, 'data', 'redial-queue');
const statsFile = path.join(__dirname, 'data', 'backfill-stats.json');

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
// STEP 1: FETCH ALL CALLS, ORGANIZE BY DATE
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

    return { success: false, error: `API returned status ${response.statusCode}` };

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

async function processBlandCallsWithDailyStats() {
  console.log('\n📞 STEP 1: Fetching all calls and organizing by date...\n');

  if (!BLAND_API_KEY) {
    throw new Error('BLAND_API_KEY not found in environment variables');
  }

  const startTimestamp = new Date(`${START_DATE}T00:00:00-05:00`).getTime();
  const endTimestamp = new Date(`${END_DATE}T23:59:59-05:00`).getTime();

  console.log(`Date range: ${START_DATE} to ${END_DATE}`);
  console.log(`Timestamp range: ${startTimestamp} to ${endTimestamp}`);
  console.log(`Batch size: 1000 calls/page (optimized)\n`);

  const phoneMap = new Map(); // Global: phone -> latest lead data
  const dailyStats = new Map(); // date -> {totalCalls, uniquePhones: Set()}

  let page = 1;
  let hasMore = true;
  let totalCallsProcessed = 0;
  let consecutiveErrors = 0;

  while (hasMore) {
    const result = await fetchPageWithRetry(page);

    if (!result.success) {
      console.error(`   ❌ ${result.error}`);
      consecutiveErrors++;
      if (consecutiveErrors >= 10) {
        throw new Error('Too many consecutive API errors');
      }
      await sleep(5000);
      page++;
      continue;
    }

    consecutiveErrors = 0;
    const calls = result.data.calls || [];

    if (calls.length === 0) {
      hasMore = false;
      break;
    }

    let callsInRange = 0;
    for (const call of calls) {
      const callTime = new Date(call.created_at).getTime();

      if (callTime >= startTimestamp && callTime <= endTimestamp) {
        callsInRange++;
        totalCallsProcessed++;

        // Get date string (YYYY-MM-DD)
        const callDate = new Date(callTime).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

        // Initialize daily stats if needed
        if (!dailyStats.has(callDate)) {
          dailyStats.set(callDate, {
            date: callDate,
            totalCalls: 0,
            uniquePhones: new Set()
          });
        }

        const dayStats = dailyStats.get(callDate);
        dayStats.totalCalls++;

        const phone = call.to || call.phone_number;
        if (!phone) continue;

        // Track unique phones for this date
        dayStats.uniquePhones.add(phone);

        const metadata = call.request_data || call.variables || {};
        const leadId = metadata.lead_id || metadata.leadId || call.call_id;
        const listId = metadata.list_id || metadata.listId || '';

        // Keep LATEST call per phone globally
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
            first_seen_date: callDate
          });
        }
      }
    }

    console.log(`   ✓ Page ${page}: ${callsInRange} calls in range | Total unique phones: ${phoneMap.size} | Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

    // Check if we've gone past the start date
    const oldestCallOnPage = calls[calls.length - 1];
    const oldestCallTime = new Date(oldestCallOnPage.created_at).getTime();

    if (oldestCallTime < startTimestamp) {
      hasMore = false;
      console.log(`   → Reached start date, stopping pagination`);
      break;
    }

    // Force GC every 500 pages
    if (page % 500 === 0) {
      console.log(`   🗑️  Forcing garbage collection...`);
      forceGC();
    }

    page++;
    await sleep(BLAND_BATCH_DELAY_MS);
  }

  console.log(`\n✅ Processed ${totalCallsProcessed} total calls`);
  console.log(`✅ Found ${phoneMap.size} unique phone numbers\n`);

  // Convert daily stats for output
  const dailyStatsArray = Array.from(dailyStats.values())
    .map(day => ({
      date: day.date,
      totalCalls: day.totalCalls,
      uniquePhones: day.uniquePhones.size
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Show daily breakdown
  console.log('='.repeat(60));
  console.log('📊 DAILY BREAKDOWN');
  console.log('='.repeat(60) + '\n');

  let cumulativeUnique = 0;
  const seenPhones = new Set();

  dailyStatsArray.forEach(stat => {
    const dayData = dailyStats.get(stat.date);
    dayData.uniquePhones.forEach(phone => seenPhones.add(phone));
    cumulativeUnique = seenPhones.size;

    console.log(`${stat.date}: ${stat.totalCalls.toString().padStart(5)} calls | ${stat.uniquePhones.toString().padStart(3)} unique today | ${cumulativeUnique.toString().padStart(3)} cumulative`);
  });

  const totalCalls = dailyStatsArray.reduce((sum, s) => sum + s.totalCalls, 0);
  console.log('\n' + '-'.repeat(60));
  console.log(`TOTALS: ${totalCalls} calls | ${phoneMap.size} unique phones`);
  console.log('='.repeat(60) + '\n');

  // Save stats
  saveDailyStats(dailyStatsArray);

  return phoneMap;
}

function saveDailyStats(stats) {
  const statsDir = path.dirname(statsFile);
  if (!fs.existsSync(statsDir)) {
    fs.mkdirSync(statsDir, { recursive: true });
  }
  fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
}

// ============================================================================
// STEP 2: CHECK CONVOSO STATUS
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
    return { outcome: 'UNKNOWN', status: 'UNKNOWN' };
  }
}

async function batchCheckConvosoStatus(phoneLeads) {
  console.log('🔍 STEP 2: Checking Convoso status (batched)...\n');

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

    if (outcome.includes('SALE') || outcome.includes('ACA')) {
      skipSale.push(lead);
      continue;
    }

    if (outcome.includes('DNC') || outcome.includes('NOT_INTERESTED') || outcome.includes('DO_NOT_CALL')) {
      skipDNC.push(lead);
      continue;
    }

    if (outcome === 'UNKNOWN') {
      skipUnknown.push(lead);
      shouldRedial.push(lead);
      continue;
    }

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
      console.log(`   ${i + 1}. ${lead.phone_number} (First seen: ${lead.first_seen_date})`);
    });
    return;
  }

  const currentMonth = getCurrentDateEST().substring(0, 7);
  const queueFilePath = path.join(redialQueueDir, `redial-queue_${currentMonth}.json`);

  if (!fs.existsSync(redialQueueDir)) {
    fs.mkdirSync(redialQueueDir, { recursive: true });
  }

  let queueData = {};
  if (fs.existsSync(queueFilePath)) {
    queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  }

  const now = Date.now();
  let addedCount = 0;
  let skippedExisting = 0;

  for (const lead of leadsToAdd) {
    const key = lead.phone_number;

    if (queueData[key]) {
      skippedExisting++;
      continue;
    }

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
      next_redial_timestamp: now,
      last_call_timestamp: 0,
      last_outcome: null,
      scheduled_callback_time: null,
      daily_max_reached_at: null,
      outcomes: []
    };

    addedCount++;

    if (addedCount % 100 === 0) {
      fs.writeFileSync(queueFilePath, JSON.stringify(queueData, null, 2));
      console.log(`   ✓ Saved ${addedCount} leads...`);

      if (addedCount % 500 === 0) {
        forceGC();
      }
    }
  }

  fs.writeFileSync(queueFilePath, JSON.stringify(queueData, null, 2));

  console.log(`\n✅ Successfully added ${addedCount} new leads to redial queue`);
  console.log(`⏭️  Skipped ${skippedExisting} leads (already in queue)`);
  console.log(`📁 Saved to: ${queueFilePath}\n`);

  const expectedDailyCalls = addedCount * 8;
  console.log(`📞 EXPECTED DAILY CALL VOLUME: ${expectedDailyCalls.toLocaleString()} calls/day\n`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   OPTIMIZED BACKFILL v3.1 FROM BLAND.AI         ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  console.log(`Date Range: ${START_DATE} to ${END_DATE}`);
  console.log(`Dry Run: ${DRY_RUN ? 'YES (no changes)' : 'NO (will modify data)'}`);
  console.log(`Heap Limit: ${Math.round(require('v8').getHeapStatistics().heap_size_limit / 1024 / 1024)}MB\n`);

  try {
    const startTime = Date.now();

    const phoneMap = await processBlandCallsWithDailyStats();
    const phoneLeads = Array.from(phoneMap.values());

    const leadsWithStatus = await batchCheckConvosoStatus(phoneLeads);
    const leadsToAdd = filterLeadsForRedial(leadsWithStatus);
    await addLeadsToRedialQueue(leadsToAdd);

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    console.log(`⏱️  Total time: ${duration} seconds\n`);

    console.log('✅ Backfill complete!\n');

    if (!DRY_RUN) {
      console.log('🚀 NEXT STEPS:');
      console.log('   1. View daily stats: cat data/backfill-stats.json');
      console.log('   2. Restart orchestrator: pm2 restart awh-orchestrator');
      console.log('   3. Monitor logs: pm2 logs awh-orchestrator\n');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
