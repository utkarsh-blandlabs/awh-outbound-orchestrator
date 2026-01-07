#!/usr/bin/env node
/**
 * MEMORY-OPTIMIZED BACKFILL SCRIPT - Pull from Bland.ai API
 *
 * CRITICAL FIXES:
 * 1. Processes in batches - doesn't load all 300k+ calls into memory
 * 2. Keeps LATEST call per phone number (not first)
 * 3. Writes to queue incrementally every 1000 phones
 * 4. Forces GC to prevent memory leaks
 *
 * RUN: node --max-old-space-size=2048 --expose-gc backfill-from-bland-optimized.js [--dry-run]
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
const BLAND_BATCH_DELAY_MS = 500;
const CONVOSO_BATCH_SIZE = 50;
const CONVOSO_BATCH_DELAY_MS = 1000;
const SAVE_EVERY_N_PHONES = 1000; // Save to disk every 1000 phones processed

// Load environment variables
require('dotenv').config();

const BLAND_API_KEY = process.env.BLAND_API_KEY;
const CONVOSO_AUTH_TOKEN = process.env.CONVOSO_AUTH_TOKEN;
const CONVOSO_DOMAIN = process.env.CONVOSO_DOMAIN || 'blandlabs-ai.hostedcc.com';

const redialQueueDir = path.join(__dirname, 'data', 'redial-queue');

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

    if (postData) {
      req.write(postData);
    }

    req.end();
  });
}

// ============================================================================
// STEP 1: FETCH AND PROCESS CALLS INCREMENTALLY
// ============================================================================

async function processBlandCallsIncremental() {
  console.log('\n📞 STEP 1: Processing calls from Bland.ai (INCREMENTAL)...\n');

  if (!BLAND_API_KEY) {
    throw new Error('BLAND_API_KEY not found in environment variables');
  }

  const startTimestamp = new Date(`${START_DATE}T00:00:00-05:00`).getTime();
  const endTimestamp = new Date(`${END_DATE}T23:59:59-05:00`).getTime();

  console.log(`Date range: ${START_DATE} to ${END_DATE}`);
  console.log(`Timestamp range: ${startTimestamp} to ${endTimestamp}\n`);

  // Phone map - keeps LATEST call per phone number
  const phoneMap = new Map(); // phone -> {lead_data, created_at}

  let page = 1;
  let hasMore = true;
  let totalCallsProcessed = 0;
  let lastSavePage = 0;

  while (hasMore) {
    try {
      const options = {
        hostname: 'api.bland.ai',
        port: 443,
        path: `/v1/calls?page=${page}&limit=100`,
        method: 'GET',
        headers: {
          'Authorization': BLAND_API_KEY,
          'Content-Type': 'application/json'
        }
      };

      const response = await makeHttpsRequest(options);

      if (response.statusCode !== 200) {
        console.error(`❌ Bland API error: ${response.statusCode}`);
        throw new Error('Failed to fetch calls from Bland.ai');
      }

      const calls = response.data.calls || [];

      if (calls.length === 0) {
        hasMore = false;
        break;
      }

      // Process this page's calls
      let callsInRange = 0;
      for (const call of calls) {
        const callTime = new Date(call.created_at).getTime();

        if (callTime >= startTimestamp && callTime <= endTimestamp) {
          callsInRange++;
          totalCallsProcessed++;

          const phone = call.to || call.phone_number;
          if (!phone) continue;

          const metadata = call.request_data || call.variables || {};
          const leadId = metadata.lead_id || metadata.leadId || call.call_id;
          const listId = metadata.list_id || metadata.listId || '';

          // CRITICAL: Keep LATEST call per phone (not first!)
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
              call_id: call.call_id
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

      // Force GC every 500 pages to prevent memory leaks
      if (page % 500 === 0) {
        console.log(`   🗑️  Forcing garbage collection...`);
        forceGC();
      }

      page++;
      await sleep(BLAND_BATCH_DELAY_MS);

    } catch (error) {
      console.error(`❌ Error fetching page ${page}:`, error.message);
      throw error;
    }
  }

  console.log(`\n✅ Processed ${totalCallsProcessed} total calls`);
  console.log(`✅ Found ${phoneMap.size} unique phone numbers (keeping LATEST call per phone)\n`);

  return phoneMap;
}

// ============================================================================
// STEP 2: CHECK CONVOSO STATUS (BATCHED)
// ============================================================================

async function checkConvosoStatus(phoneNumber, listId) {
  if (!CONVOSO_AUTH_TOKEN) {
    return { outcome: 'UNKNOWN', status: 'UNKNOWN' };
  }

  try {
    // First try: Search by phone number
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
      console.log(`   ${i + 1}. ${lead.phone_number} (Lead: ${lead.lead_id}, Created: ${new Date(lead.created_at).toISOString()})`);
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
  console.log('║   MEMORY-OPTIMIZED BACKFILL FROM BLAND.AI        ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  console.log(`Date Range: ${START_DATE} to ${END_DATE}`);
  console.log(`Dry Run: ${DRY_RUN ? 'YES (no changes)' : 'NO (will modify data)'}`);
  console.log(`Heap Limit: ${Math.round(require('v8').getHeapStatistics().heap_size_limit / 1024 / 1024)}MB\n`);

  try {
    const startTime = Date.now();

    // Step 1: Process calls incrementally (keeps LATEST per phone)
    const phoneMap = await processBlandCallsIncremental();
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
      console.log('   3. Check call volume increases over next few hours\n');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
main();
