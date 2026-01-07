/**
 * Backfill Missing Convoso Leads
 *
 * Creates leads in Convoso from failed "No such Lead" errors.
 * Run this after Jeff confirms which leads to create.
 *
 * USAGE:
 *   node backfill-missing-convoso-leads.js 2026-01-07           # Specific date
 *   node backfill-missing-convoso-leads.js 2026-01-07 --dry-run # Test run
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

require("dotenv").config();

const CONVOSO_AUTH_TOKEN = process.env.CONVOSO_AUTH_TOKEN;
const CONVOSO_DOMAIN = process.env.CONVOSO_DOMAIN || "blandlabs-ai.hostedcc.com";

const DRY_RUN = process.argv.includes("--dry-run");
const DATE_ARG = process.argv[2];

// ============================================================================
// UTILITIES
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
// CONVOSO API
// ============================================================================

/**
 * Create a lead in Convoso
 */
async function createLeadInConvoso(lead) {
  const phone = lead.phone_number.replace(/\D/g, "");

  const leadData = {
    phone: phone,
    first_name: lead.first_name || "",
    last_name: lead.last_name || "",
    state: lead.state || "",
    list_id: lead.list_id || "",
    // Add outcome from the call
    outcome: lead.outcome || "",
    status: lead.status || "",
  };

  const options = {
    hostname: CONVOSO_DOMAIN,
    port: 443,
    path: "/api/lead/create",
    method: "POST",
    headers: {
      Authorization: `Bearer ${CONVOSO_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
  };

  const response = await makeHttpsRequest(options, JSON.stringify(leadData));

  if (response.statusCode === 200 || response.statusCode === 201) {
    return { success: true, data: response.data };
  }

  return {
    success: false,
    error: `API returned ${response.statusCode}: ${JSON.stringify(response.data)}`,
  };
}

/**
 * Update existing lead in Convoso
 */
async function updateLeadInConvoso(leadId, outcome, status, duration) {
  const updateData = {
    outcome: outcome,
    status: status,
    call_duration: duration || 0,
  };

  const options = {
    hostname: CONVOSO_DOMAIN,
    port: 443,
    path: `/api/lead/${leadId}`,
    method: "PUT",
    headers: {
      Authorization: `Bearer ${CONVOSO_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
  };

  const response = await makeHttpsRequest(options, JSON.stringify(updateData));

  if (response.statusCode === 200) {
    return { success: true, data: response.data };
  }

  return {
    success: false,
    error: `API returned ${response.statusCode}: ${JSON.stringify(response.data)}`,
  };
}

// ============================================================================
// LOAD FAILED UPDATES
// ============================================================================

function loadFailedUpdates(date) {
  const filePath = path.join(__dirname, "data", "failed-convoso-updates", `${date}.json`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ No failed updates file found for ${date}`);
    console.error(`   Expected: ${filePath}`);
    return [];
  }

  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error(`❌ Failed to read file: ${error.message}`);
    return [];
  }
}

// ============================================================================
// BACKFILL PROCESS
// ============================================================================

async function backfillMissingLeads(date) {
  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║   BACKFILL MISSING CONVOSO LEADS                ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  console.log(`Date: ${date}`);
  console.log(`Dry Run: ${DRY_RUN ? "YES (no changes)" : "NO (will create leads)"}\n`);

  if (!CONVOSO_AUTH_TOKEN) {
    throw new Error("CONVOSO_AUTH_TOKEN not found in environment");
  }

  // Load failed updates
  const failedUpdates = loadFailedUpdates(date);

  if (failedUpdates.length === 0) {
    console.log("✅ No failed updates to backfill");
    return;
  }

  console.log(`Found ${failedUpdates.length} failed updates\n`);

  if (DRY_RUN) {
    console.log("📋 Sample of leads to be created:\n");
    failedUpdates.slice(0, 10).forEach((lead, i) => {
      console.log(`${i + 1}. ${lead.phone_number} - ${lead.first_name} ${lead.last_name}`);
      console.log(`   Outcome: ${lead.outcome}, Status: ${lead.status}`);
      console.log(`   Call ID: ${lead.call_id}\n`);
    });

    console.log(`Total: ${failedUpdates.length} leads would be created`);
    return;
  }

  // Backfill leads
  let created = 0;
  let updated = 0;
  let failed = 0;

  console.log("Processing leads...\n");

  for (const lead of failedUpdates) {
    try {
      console.log(`Processing: ${lead.phone_number} (${lead.first_name} ${lead.last_name})`);

      // Create lead in Convoso
      const createResult = await createLeadInConvoso(lead);

      if (createResult.success) {
        created++;
        console.log(`   ✓ Lead created in Convoso`);

        // Try to update with call outcome
        const newLeadId = createResult.data.lead_id || createResult.data.id;
        if (newLeadId) {
          const updateResult = await updateLeadInConvoso(
            newLeadId,
            lead.outcome,
            lead.status,
            lead.duration
          );

          if (updateResult.success) {
            updated++;
            console.log(`   ✓ Call outcome updated`);
          } else {
            console.log(`   ⚠️  Lead created but update failed: ${updateResult.error}`);
          }
        }
      } else {
        failed++;
        console.log(`   ❌ Failed to create: ${createResult.error}`);
      }

      // Rate limit: 1 request per 100ms
      await sleep(100);

    } catch (error) {
      failed++;
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 BACKFILL SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total processed: ${failedUpdates.length}`);
  console.log(`✅ Leads created: ${created}`);
  console.log(`✅ Outcomes updated: ${updated}`);
  console.log(`❌ Failed: ${failed}`);
  console.log("=".repeat(60) + "\n");
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  if (!DATE_ARG || !/^\d{4}-\d{2}-\d{2}$/.test(DATE_ARG)) {
    console.error("❌ Please provide a date in YYYY-MM-DD format");
    console.error("\nUsage:");
    console.error("  node backfill-missing-convoso-leads.js 2026-01-07");
    console.error("  node backfill-missing-convoso-leads.js 2026-01-07 --dry-run");
    process.exit(1);
  }

  try {
    await backfillMissingLeads(DATE_ARG);
    console.log("✅ Backfill complete!\n");
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
