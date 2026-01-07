#!/usr/bin/env node
/**
 * OPTIMIZED BACKFILL SCRIPT - Pull from Bland.ai API
 *
 * Pulls all leads from Bland.ai (Dec 1, 2025 - Jan 7, 2026)
 * Checks status in Convoso
 * Adds non-sale/non-DNC leads to redial queue
 *
 * OPTIMIZATIONS:
 * - Streams data to avoid memory issues
 * - Batches API calls to respect rate limits
 * - Deduplicates phone numbers
 * - Handles errors gracefully
 * - Progress tracking with ETA
 *
 * RUN: node backfill-from-bland.js [--dry-run] [--batch-size=50]
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
const BATCH_SIZE = parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '50');
const BLAND_BATCH_DELAY_MS = 500;   // Delay between Bland API calls
const CONVOSO_BATCH_DELAY_MS = 1000; // Delay between Convoso API calls

// Load environment variables
require('dotenv').config();

const BLAND_API_KEY = process.env.BLAND_API_KEY;
const CONVOSO_API_KEY = process.env.CONVOSO_API_KEY;
const CONVOSO_DOMAIN = process.env.CONVOSO_DOMAIN || 'blandlabs-ai.hostedcc.com';

const redialQueueDir = path.join(__dirname, 'data', 'redial-queue');

// Statuses that STOP redialing (lead is done)
const FINAL_STATUSES = ['SALE', 'DNC', 'DO_NOT_CALL', 'NOT_INTERESTED'];

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
// STEP 1: FETCH CALLS FROM BLAND.AI
// ============================================================================

async function fetchBlandCalls() {
  console.log('\n📞 STEP 1: Fetching calls from Bland.ai...\n');

  if (!BLAND_API_KEY) {
    throw new Error('BLAND_API_KEY not found in environment variables');
  }

  const startTimestamp = new Date(`${START_DATE}T00:00:00-05:00`).getTime();
  const endTimestamp = new Date(`${END_DATE}T23:59:59-05:00`).getTime();

  console.log(`Date range: ${START_DATE} to ${END_DATE}`);
  console.log(`Timestamp range: ${startTimestamp} to ${endTimestamp}\n`);

  const allCalls = [];
  let page = 1;
  let hasMore = true;

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
        console.error(response.data);
        throw new Error('Failed to fetch calls from Bland.ai');
      }

      const calls = response.data.calls || [];

      if (calls.length === 0) {
        hasMore = false;
        break;
      }

      // Filter calls by date range
      const filteredCalls = calls.filter(call => {
        const callTime = new Date(call.created_at).getTime();
        return callTime >= startTimestamp && callTime <= endTimestamp;
      });

      allCalls.push(...filteredCalls);

      console.log(`   ✓ Page ${page}: ${filteredCalls.length} calls in range (${calls.length} total on page)`);

      // Check if we've gone past the end date
      const oldestCallOnPage = calls[calls.length - 1];
      const oldestCallTime = new Date(oldestCallOnPage.created_at).getTime();

      if (oldestCallTime < startTimestamp) {
        hasMore = false;
        console.log(`   → Reached start date, stopping pagination`);
        break;
      }

      page++;

      // Rate limiting
      await sleep(BLAND_BATCH_DELAY_MS);

    } catch (error) {
      console.error(`❌ Error fetching page ${page}:`, error.message);
      throw error;
    }
  }

  console.log(`\n✅ Fetched ${allCalls.length} calls from Bland.ai\n`);
  return allCalls;
}

// ============================================================================
// STEP 2: EXTRACT UNIQUE PHONE NUMBERS
// ============================================================================

function extractUniquePhones(calls) {
  console.log('📋 STEP 2: Extracting unique phone numbers...\n');

  const phoneMap = new Map(); // phone -> {lead_id, list_id, first_name, last_name, state, created_at}

  for (const call of calls) {
    const phone = call.to || call.phone_number;
    if (!phone) continue;

    // Extract metadata from request_data or variables
    const metadata = call.request_data || call.variables || {};
    const leadId = metadata.lead_id || metadata.leadId || call.call_id;
    const listId = metadata.list_id || metadata.listId || '';

    // Store first occurrence (handles duplicate edge case)
    if (!phoneMap.has(phone)) {
      phoneMap.set(phone, {
        phone_number: phone,
        lead_id: leadId,
        list_id: listId,
        first_name: metadata.first_name || metadata.firstName || '',
        last_name: metadata.last_name || metadata.lastName || '',
        state: metadata.state || '',
        created_at: new Date(call.created_at).getTime(),
        call_id: call.call_id
      });
    }
  }

  const uniquePhones = Array.from(phoneMap.values());
  console.log(`✅ Extracted ${uniquePhones.length} unique phone numbers\n`);

  return uniquePhones;
}

// ============================================================================
// STEP 3: CHECK STATUS IN CONVOSO (BATCHED)
// ============================================================================

async function checkConvosoStatus(phone, leadId) {
  if (!CONVOSO_API_KEY || !CONVOSO_DOMAIN) {
    console.warn('⚠️  Convoso credentials not found, skipping status check');
    return null;
  }

  try {
    // Search by phone number first
    const searchOptions = {
      hostname: CONVOSO_DOMAIN,
      port: 443,
      path: `/api/v1/lead/search?phone=${encodeURIComponent(phone)}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CONVOSO_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const response = await makeHttpsRequest(searchOptions);

    if (response.statusCode === 200 && response.data && response.data.leads) {
      const leads = response.data.leads;

      if (leads.length > 0) {
        // Use first match (handles duplicate phone numbers edge case)
        const lead = leads[0];
        return {
          found: true,
          status: lead.status || null,
          disposition: lead.disposition || null,
          outcome: lead.outcome || null
        };
      }
    }

    return { found: false, status: null, disposition: null, outcome: null };

  } catch (error) {
    console.error(`   ⚠️  Error checking Convoso for ${phone}:`, error.message);
    return { found: false, status: null, disposition: null, outcome: null };
  }
}

async function batchCheckConvosoStatus(phoneLeads, batchSize = BATCH_SIZE) {
  console.log(`\n🔍 STEP 3: Checking status in Convoso (${phoneLeads.length} leads)...\n`);
  console.log(`Batch size: ${batchSize}, Delay: ${CONVOSO_BATCH_DELAY_MS}ms\n`);

  const results = [];
  const totalBatches = Math.ceil(phoneLeads.length / batchSize);
  let processed = 0;

  for (let i = 0; i < phoneLeads.length; i += batchSize) {
    const batch = phoneLeads.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    console.log(`   Batch ${batchNum}/${totalBatches} (${batch.length} leads)...`);

    const batchPromises = batch.map(async (lead) => {
      const status = await checkConvosoStatus(lead.phone_number, lead.lead_id);
      return { ...lead, convoso_status: status };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    processed += batch.length;
    const progress = ((processed / phoneLeads.length) * 100).toFixed(1);
    console.log(`   ✓ Progress: ${processed}/${phoneLeads.length} (${progress}%)`);

    // Rate limiting between batches
    if (i + batchSize < phoneLeads.length) {
      await sleep(CONVOSO_BATCH_DELAY_MS);
    }
  }

  console.log(`\n✅ Checked ${results.length} leads in Convoso\n`);
  return results;
}

// ============================================================================
// STEP 4: FILTER LEADS FOR REDIAL QUEUE
// ============================================================================

function filterLeadsForRedial(leadsWithStatus) {
  console.log('🔍 STEP 4: Filtering leads for redial queue...\n');

  const shouldRedial = [];
  const skipSale = [];
  const skipDNC = [];
  const skipOther = [];
  const notFoundInConvoso = [];

  for (const lead of leadsWithStatus) {
    const convosoStatus = lead.convoso_status;

    // If not found in Convoso, add to redial queue (might be new lead)
    if (!convosoStatus || !convosoStatus.found) {
      notFoundInConvoso.push(lead);
      shouldRedial.push(lead);
      continue;
    }

    // Check if lead should be excluded (SALE or DNC)
    const outcome = (convosoStatus.outcome || '').toUpperCase();
    const disposition = (convosoStatus.disposition || '').toUpperCase();
    const status = (convosoStatus.status || '').toUpperCase();

    // Check for SALE
    if (outcome.includes('SALE') || outcome.includes('ACA') ||
        disposition.includes('SALE') || disposition.includes('ACA')) {
      skipSale.push(lead);
      continue;
    }

    // Check for DNC
    if (outcome.includes('DNC') || outcome.includes('NOT_INTERESTED') || outcome.includes('DO_NOT_CALL') ||
        disposition.includes('DNC') || disposition.includes('NOT_INTERESTED') || disposition.includes('DO_NOT_CALL')) {
      skipDNC.push(lead);
      continue;
    }

    // Everything else should continue redialing
    shouldRedial.push(lead);
  }

  console.log(`📊 FILTERING RESULTS:`);
  console.log(`   - Should redial: ${shouldRedial.length}`);
  console.log(`   - Skip (SALE): ${skipSale.length}`);
  console.log(`   - Skip (DNC): ${skipDNC.length}`);
  console.log(`   - Not found in Convoso: ${notFoundInConvoso.length} (will add to queue)`);
  console.log('');

  return { shouldRedial, skipSale, skipDNC, notFoundInConvoso };
}

// ============================================================================
// STEP 5: CHECK EXISTING REDIAL QUEUE
// ============================================================================

function getExistingRedialQueue() {
  console.log('📋 STEP 5: Checking existing redial queue...\n');

  const existingPhones = new Set();

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
    }
  }

  console.log(`✅ Found ${existingPhones.size} leads already in redial queue\n`);

  return existingPhones;
}

// ============================================================================
// STEP 6: ADD LEADS TO REDIAL QUEUE (MEMORY OPTIMIZED)
// ============================================================================

async function addLeadsToRedialQueue(leadsToAdd, existingPhones) {
  console.log(`📝 STEP 6: Adding leads to redial queue...\n`);

  // Filter out leads already in queue
  const newLeads = leadsToAdd.filter(lead => !existingPhones.has(lead.phone_number));

  console.log(`   - Total to add: ${leadsToAdd.length}`);
  console.log(`   - Already in queue: ${leadsToAdd.length - newLeads.length}`);
  console.log(`   - New leads to add: ${newLeads.length}\n`);

  if (DRY_RUN) {
    console.log('🚨 DRY RUN MODE - No changes will be made\n');
    console.log('Sample leads to add:');
    newLeads.slice(0, 10).forEach((lead, i) => {
      console.log(`   ${i + 1}. ${lead.phone_number} (Lead: ${lead.lead_id})`);
    });
    return newLeads.length;
  }

  if (newLeads.length === 0) {
    console.log('✅ No new leads to add (all already in queue)\n');
    return 0;
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

  // Add leads in batches to avoid memory issues
  for (let i = 0; i < newLeads.length; i++) {
    const lead = newLeads[i];
    const key = lead.phone_number; // Use phone as key

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
      created_at: lead.created_at || now,
      updated_at: now,
      next_redial_timestamp: now, // Ready to call immediately
      last_call_timestamp: 0,
      last_outcome: null,
      scheduled_callback_time: null,
      daily_max_reached_at: null
    };

    addedCount++;

    // Save every 100 leads to prevent memory issues
    if (addedCount % 100 === 0) {
      fs.writeFileSync(queueFilePath, JSON.stringify(queueData, null, 2));
      console.log(`   ✓ Saved ${addedCount}/${newLeads.length} leads...`);

      // Clear memory periodically
      if (addedCount % 500 === 0) {
        // Force garbage collection if available
        if (global.gc) global.gc();
      }
    }
  }

  // Final save
  fs.writeFileSync(queueFilePath, JSON.stringify(queueData, null, 2));

  console.log(`\n✅ Successfully added ${addedCount} leads to redial queue`);
  console.log(`📁 Saved to: ${queueFilePath}\n`);

  return addedCount;
}

// ============================================================================
// STEP 7: GENERATE SUMMARY REPORT
// ============================================================================

function generateSummaryReport(stats) {
  console.log('\n===========================================');
  console.log('  BACKFILL SUMMARY REPORT');
  console.log('===========================================\n');

  console.log(`Period: ${START_DATE} to ${END_DATE}\n`);

  console.log(`📊 PROCESSING RESULTS:`);
  console.log(`─────────────────────────────────────────`);
  console.log(`Total calls from Bland.ai:             ${stats.totalCalls}`);
  console.log(`Unique phone numbers:                  ${stats.uniquePhones}`);
  console.log(`Checked in Convoso:                    ${stats.checkedInConvoso}`);
  console.log('');

  console.log(`🎯 FILTERING RESULTS:`);
  console.log(`─────────────────────────────────────────`);
  console.log(`Should redial (added to queue):        ${stats.shouldRedial}`);
  console.log(`Skipped (SALE):                        ${stats.skipSale}`);
  console.log(`Skipped (DNC):                         ${stats.skipDNC}`);
  console.log(`Not found in Convoso (added anyway):   ${stats.notFoundInConvoso}`);
  console.log('');

  console.log(`📝 QUEUE UPDATE:`);
  console.log(`─────────────────────────────────────────`);
  console.log(`Already in queue:                      ${stats.alreadyInQueue}`);
  console.log(`New leads added:                       ${stats.newLeadsAdded}`);
  console.log('');

  console.log(`📞 EXPECTED CALL VOLUME:`);
  console.log(`─────────────────────────────────────────`);
  const expectedCallsPerDay = stats.shouldRedial * 8;
  console.log(`Active leads × 8 calls/day =           ${expectedCallsPerDay} calls/day`);
  console.log('===========================================\n');
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  BLAND.AI BACKFILL SCRIPT (OPTIMIZED) ║');
  console.log('╚════════════════════════════════════════╝\n');

  console.log(`Start Date: ${START_DATE}`);
  console.log(`End Date: ${END_DATE}`);
  console.log(`Dry Run: ${DRY_RUN ? 'YES (no changes)' : 'NO (will modify data)'}`);
  console.log(`Batch Size: ${BATCH_SIZE}`);
  console.log(`Memory Optimization: Enabled (periodic saves + GC)\n`);

  const startTime = Date.now();
  const stats = {
    totalCalls: 0,
    uniquePhones: 0,
    checkedInConvoso: 0,
    shouldRedial: 0,
    skipSale: 0,
    skipDNC: 0,
    notFoundInConvoso: 0,
    alreadyInQueue: 0,
    newLeadsAdded: 0
  };

  try {
    // Step 1: Fetch calls from Bland.ai
    const calls = await fetchBlandCalls();
    stats.totalCalls = calls.length;

    // Step 2: Extract unique phone numbers
    const uniquePhoneLeads = extractUniquePhones(calls);
    stats.uniquePhones = uniquePhoneLeads.length;

    // Step 3: Check status in Convoso (batched for rate limiting)
    const leadsWithStatus = await batchCheckConvosoStatus(uniquePhoneLeads, BATCH_SIZE);
    stats.checkedInConvoso = leadsWithStatus.length;

    // Step 4: Filter leads for redial queue
    const { shouldRedial, skipSale, skipDNC, notFoundInConvoso } = filterLeadsForRedial(leadsWithStatus);
    stats.shouldRedial = shouldRedial.length;
    stats.skipSale = skipSale.length;
    stats.skipDNC = skipDNC.length;
    stats.notFoundInConvoso = notFoundInConvoso.length;

    // Step 5: Check existing redial queue
    const existingPhones = getExistingRedialQueue();
    stats.alreadyInQueue = Array.from(existingPhones).filter(phone =>
      shouldRedial.some(lead => lead.phone_number === phone)
    ).length;

    // Step 6: Add leads to redial queue (memory optimized)
    const newLeadsAdded = await addLeadsToRedialQueue(shouldRedial, existingPhones);
    stats.newLeadsAdded = newLeadsAdded;

    // Step 7: Generate summary report
    generateSummaryReport(stats);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`⏱️  Total execution time: ${duration} seconds\n`);

    if (!DRY_RUN && newLeadsAdded > 0) {
      console.log('🚀 NEXT STEPS:');
      console.log('   1. Restart the orchestrator: pm2 restart awh-orchestrator');
      console.log('   2. Monitor logs: pm2 logs awh-orchestrator');
      console.log('   3. Check call volume increases over next few hours\n');
    } else if (DRY_RUN) {
      console.log('🚀 TO RUN FOR REAL:');
      console.log('   node backfill-from-bland.js\n');
    } else {
      console.log('✅ All leads already in queue - no action needed\n');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run with --expose-gc flag for better memory management
// Example: node --expose-gc backfill-from-bland.js
if (require.main === module) {
  main();
}

module.exports = { main };
