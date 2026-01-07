#!/usr/bin/env node
/**
 * BACKFILL SCRIPT v4 - Date-Filtered API Requests (FINAL)
 *
 * CORRECT APPROACH:
 * 1. Request data DATE BY DATE using created_at filter
 * 2. Get ALL calls for each date (bypasses broken pagination)
 * 3. Filter unique phones locally
 * 4. Track daily stats
 * 5. Check Convoso once for all unique phones
 * 6. Add to redial queue
 *
 * Why this works:
 * - Uses Bland's created_at date filter (no pagination needed!)
 * - Processes locally (no broken API pagination)
 * - Shows daily breakdown
 * - Fast and reliable
 *
 * RUN: node --max-old-space-size=2048 --expose-gc backfill-from-bland-v4.js [--dry-run]
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// ============================================================================
// CONFIGURATION
// ============================================================================

const START_DATE = "2025-12-01";
const END_DATE = "2026-01-07";

const DRY_RUN = process.argv.includes("--dry-run");

const BLAND_REQUEST_DELAY_MS = 1000;
const CONVOSO_BATCH_SIZE = 50;
const CONVOSO_BATCH_DELAY_MS = 1000;

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 60000;

require("dotenv").config();

const BLAND_API_KEY = process.env.BLAND_API_KEY;
const CONVOSO_AUTH_TOKEN = process.env.CONVOSO_AUTH_TOKEN;
const CONVOSO_DOMAIN =
  process.env.CONVOSO_DOMAIN || "blandlabs-ai.hostedcc.com";

const redialQueueDir = path.join(__dirname, "data", "redial-queue");
const statsFile = path.join(__dirname, "data", "backfill-stats.json");

const FINAL_STATUSES = ["SALE", "ACA", "DNC", "DO_NOT_CALL", "NOT_INTERESTED"];

// ============================================================================
// UTILITIES
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCurrentDateEST() {
  const now = new Date();
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function makeHttpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data: data });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (postData) {
      req.write(postData);
    }

    req.end();
  });
}

// ============================================================================
// STEP 1: FETCH CALLS BY DATE (WITH RETRY)
// ============================================================================

async function fetchCallsForDateWithRetry(date, retryCount = 0) {
  const options = {
    hostname: "api.bland.ai",
    port: 443,
    path: `/v1/calls?created_at=${date}&limit=10000`, // High limit to get all for this date
    method: "GET",
    headers: {
      Authorization: BLAND_API_KEY,
      "Content-Type": "application/json",
    },
  };

  try {
    const response = await makeHttpsRequest(options);

    if (response.statusCode === 200) {
      return { success: true, data: response.data };
    }

    if (
      response.statusCode === 429 ||
      response.statusCode === 500 ||
      response.statusCode === 503
    ) {
      if (retryCount < MAX_RETRIES) {
        const delay = Math.min(
          INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount),
          MAX_RETRY_DELAY_MS
        );
        console.log(
          `   ⚠️  API error ${response.statusCode}, retrying in ${delay / 1000}s... (${retryCount + 1}/${MAX_RETRIES})`
        );
        await sleep(delay);
        return fetchCallsForDateWithRetry(date, retryCount + 1);
      }
    }

    const errorMsg =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data);
    return {
      success: false,
      error: `API returned status ${response.statusCode}: ${errorMsg}`,
    };
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const delay = Math.min(
        INITIAL_RETRY_DELAY_MS * Math.pow(2, retryCount),
        MAX_RETRY_DELAY_MS
      );
      console.log(
        `   ⚠️  Network error, retrying in ${delay / 1000}s... (${retryCount + 1}/${MAX_RETRIES})`
      );
      await sleep(delay);
      return fetchCallsForDateWithRetry(date, retryCount + 1);
    }

    return { success: false, error: error.message };
  }
}

async function processBlandCallsByDate() {
  console.log(
    "\n📞 STEP 1: Fetching calls DATE BY DATE (using date filter)...\n"
  );

  if (!BLAND_API_KEY) {
    throw new Error("BLAND_API_KEY not found in environment variables");
  }

  const dates = getDateRange(START_DATE, END_DATE);
  console.log(
    `Processing ${dates.length} dates: ${START_DATE} to ${END_DATE}\n`
  );

  const globalPhoneMap = new Map(); // phone -> latest lead data
  const dailyStats = [];

  for (const date of dates) {
    console.log(`📅 ${date}`);

    try {
      const result = await fetchCallsForDateWithRetry(date);

      if (!result.success) {
        console.log(`   ❌ ${result.error}\n`);
        dailyStats.push({
          date,
          totalCalls: 0,
          uniquePhones: 0,
          newPhones: 0,
          error: result.error,
        });
        continue;
      }

      const calls = result.data.calls || [];
      const dailyPhoneMap = new Map(); // Unique phones for THIS date only

      // Process all calls for this date
      for (const call of calls) {
        const phone = call.to || call.phone_number;
        if (!phone) continue;

        const callTime = new Date(call.created_at).getTime();
        const metadata = call.request_data || call.variables || {};
        const leadId = metadata.lead_id || metadata.leadId || call.call_id;
        const listId = metadata.list_id || metadata.listId || "";

        const leadData = {
          phone_number: phone,
          lead_id: leadId,
          list_id: listId,
          first_name: metadata.first_name || metadata.firstName || "",
          last_name: metadata.last_name || metadata.lastName || "",
          state: metadata.state || "",
          created_at: callTime,
          call_id: call.call_id,
          first_seen_date: date,
        };

        // Track unique for THIS date (keep latest if multiple calls same day)
        const existingDaily = dailyPhoneMap.get(phone);
        if (!existingDaily || callTime > existingDaily.created_at) {
          dailyPhoneMap.set(phone, leadData);
        }
      }

      // Count new phones (not seen before today)
      let newPhones = 0;
      for (const [phone, leadData] of dailyPhoneMap.entries()) {
        if (!globalPhoneMap.has(phone)) {
          newPhones++;
        }

        // Update global map (keep latest across all dates)
        const existingGlobal = globalPhoneMap.get(phone);
        if (
          !existingGlobal ||
          leadData.created_at > existingGlobal.created_at
        ) {
          globalPhoneMap.set(phone, leadData);
        }
      }

      dailyStats.push({
        date,
        totalCalls: calls.length,
        uniquePhones: dailyPhoneMap.size,
        newPhones: newPhones,
        cumulativeUnique: globalPhoneMap.size,
      });

      console.log(
        `   ✓ ${calls.length} calls | ${dailyPhoneMap.size} unique today | ${newPhones} NEW | ${globalPhoneMap.size} total unique\n`
      );

      // Save stats every 5 dates
      if (dailyStats.length % 5 === 0) {
        saveDailyStats(dailyStats);
      }

      // Force GC periodically
      if (dailyStats.length % 7 === 0) {
        forceGC();
      }

      // Rate limit between dates
      await sleep(BLAND_REQUEST_DELAY_MS);
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
      dailyStats.push({
        date,
        totalCalls: 0,
        uniquePhones: 0,
        newPhones: 0,
        error: error.message,
      });
    }
  }

  // Final stats save
  saveDailyStats(dailyStats);

  // Show summary
  console.log("=".repeat(60));
  console.log("📊 DAILY BREAKDOWN");
  console.log("=".repeat(60) + "\n");

  dailyStats.forEach((stat) => {
    if (stat.error) {
      console.log(`${stat.date}:   ERROR - ${stat.error}`);
    } else {
      console.log(
        `${stat.date}: ${stat.totalCalls.toString().padStart(5)} calls | ${stat.uniquePhones.toString().padStart(3)} unique | ${stat.newPhones.toString().padStart(3)} NEW | ${stat.cumulativeUnique.toString().padStart(3)} total`
      );
    }
  });

  const totalCalls = dailyStats.reduce(
    (sum, s) => sum + (s.totalCalls || 0),
    0
  );
  console.log("\n" + "-".repeat(60));
  console.log(
    `TOTALS: ${totalCalls} calls | ${globalPhoneMap.size} unique phones`
  );
  console.log("=".repeat(60) + "\n");

  return globalPhoneMap;
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
    return { outcome: "UNKNOWN", status: "UNKNOWN" };
  }

  try {
    const searchOptions = {
      hostname: CONVOSO_DOMAIN,
      port: 443,
      path: `/api/lead/search?phone=${encodeURIComponent(phoneNumber)}`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${CONVOSO_AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
    };

    const searchResponse = await makeHttpsRequest(searchOptions);

    if (
      searchResponse.statusCode === 200 &&
      searchResponse.data &&
      searchResponse.data.leads &&
      searchResponse.data.leads.length > 0
    ) {
      const lead = searchResponse.data.leads[0];
      return {
        outcome: lead.outcome || lead.status || "UNKNOWN",
        status: lead.status || "UNKNOWN",
      };
    }

    return { outcome: "UNKNOWN", status: "UNKNOWN" };
  } catch (error) {
    return { outcome: "UNKNOWN", status: "UNKNOWN" };
  }
}

async function batchCheckConvosoStatus(phoneLeads) {
  console.log("🔍 STEP 2: Checking Convoso status (batched)...\n");

  const results = [];
  const totalBatches = Math.ceil(phoneLeads.length / CONVOSO_BATCH_SIZE);

  for (let i = 0; i < phoneLeads.length; i += CONVOSO_BATCH_SIZE) {
    const batch = phoneLeads.slice(i, i + CONVOSO_BATCH_SIZE);
    const batchNum = Math.floor(i / CONVOSO_BATCH_SIZE) + 1;

    console.log(
      `   Batch ${batchNum}/${totalBatches}: Checking ${batch.length} leads...`
    );

    const batchPromises = batch.map(async (lead) => {
      const status = await checkConvosoStatus(lead.phone_number, lead.list_id);
      return {
        ...lead,
        convoso_outcome: status.outcome,
        convoso_status: status.status,
      };
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
  console.log("📊 STEP 3: Filtering leads for redial queue...\n");

  const shouldRedial = [];
  const skipSale = [];
  const skipDNC = [];
  const skipUnknown = [];

  for (const lead of leadsWithStatus) {
    const outcome = (lead.convoso_outcome || "").toUpperCase();

    if (outcome.includes("SALE") || outcome.includes("ACA")) {
      skipSale.push(lead);
      continue;
    }

    if (
      outcome.includes("DNC") ||
      outcome.includes("NOT_INTERESTED") ||
      outcome.includes("DO_NOT_CALL")
    ) {
      skipDNC.push(lead);
      continue;
    }

    if (outcome === "UNKNOWN") {
      skipUnknown.push(lead);
      shouldRedial.push(lead);
      continue;
    }

    shouldRedial.push(lead);
  }

  console.log(`   ✅ Should redial: ${shouldRedial.length}`);
  console.log(`   ⏭️  Skip (SALE): ${skipSale.length}`);
  console.log(`   ⏭️  Skip (DNC): ${skipDNC.length}`);
  console.log(
    `   ⚠️  Unknown status (added to queue): ${skipUnknown.length}\n`
  );

  return shouldRedial;
}

// ============================================================================
// STEP 4: ADD TO REDIAL QUEUE
// ============================================================================

async function addLeadsToRedialQueue(leadsToAdd) {
  console.log(
    `📝 STEP 4: Adding ${leadsToAdd.length} leads to redial queue...\n`
  );

  if (DRY_RUN) {
    console.log("🚨 DRY RUN MODE - No changes will be made\n");
    console.log("Sample leads to add:");
    leadsToAdd.slice(0, 10).forEach((lead, i) => {
      console.log(
        `   ${i + 1}. ${lead.phone_number} (First seen: ${lead.first_seen_date})`
      );
    });
    return;
  }

  const currentMonth = getCurrentDateEST().substring(0, 7);
  const queueFilePath = path.join(
    redialQueueDir,
    `redial-queue_${currentMonth}.json`
  );

  if (!fs.existsSync(redialQueueDir)) {
    fs.mkdirSync(redialQueueDir, { recursive: true });
  }

  let queueData = {};
  if (fs.existsSync(queueFilePath)) {
    queueData = JSON.parse(fs.readFileSync(queueFilePath, "utf-8"));
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
      first_name: lead.first_name || "",
      last_name: lead.last_name || "",
      state: lead.state || "",
      status: "pending",
      attempts: 0,
      attempts_today: 0,
      created_at: now,
      updated_at: now,
      next_redial_timestamp: now,
      last_call_timestamp: 0,
      last_outcome: null,
      scheduled_callback_time: null,
      daily_max_reached_at: null,
      outcomes: [],
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

  console.log(
    `\n✅ Successfully added ${addedCount} new leads to redial queue`
  );
  console.log(`⏭️  Skipped ${skippedExisting} leads (already in queue)`);
  console.log(`📁 Saved to: ${queueFilePath}\n`);

  const expectedDailyCalls = addedCount * 8;
  console.log(
    `📞 EXPECTED DAILY CALL VOLUME: ${expectedDailyCalls.toLocaleString()} calls/day\n`
  );
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║   DATE-FILTERED BACKFILL v4 FROM BLAND.AI       ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  console.log(`Date Range: ${START_DATE} to ${END_DATE}`);
  console.log(
    `Dry Run: ${DRY_RUN ? "YES (no changes)" : "NO (will modify data)"}`
  );
  console.log(
    `Method: Date-filtered API requests (bypasses broken pagination)`
  );
  console.log(
    `Heap Limit: ${Math.round(require("v8").getHeapStatistics().heap_size_limit / 1024 / 1024)}MB\n`
  );

  try {
    const startTime = Date.now();

    const phoneMap = await processBlandCallsByDate();
    const phoneLeads = Array.from(phoneMap.values());

    const leadsWithStatus = await batchCheckConvosoStatus(phoneLeads);
    const leadsToAdd = filterLeadsForRedial(leadsWithStatus);
    await addLeadsToRedialQueue(leadsToAdd);

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    console.log(`⏱️  Total time: ${duration} seconds\n`);

    console.log("✅ Backfill complete!\n");

    if (!DRY_RUN) {
      console.log("🚀 NEXT STEPS:");
      console.log("   1. View daily stats: cat data/backfill-stats.json");
      console.log("   2. Restart orchestrator: pm2 restart awh-orchestrator");
      console.log("   3. Monitor logs: pm2 logs awh-orchestrator\n");
    }
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
