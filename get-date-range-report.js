#!/usr/bin/env node
/**
 * Get leads and calls data for a specific date range
 * Run this on EC2 production server: node get-date-range-report.js
 *
 * Date Range: December 22, 2025 - January 7, 2026
 */

const fs = require("fs");
const path = require("path");

const redialQueueDir = path.join(__dirname, "data", "redial-queue");
const statsDir = path.join(__dirname, "data", "statistics");

// Date range for analysis
const START_DATE = "2025-12-22";
const END_DATE = getCurrentDateEST();

function getCurrentDateEST() {
  const now = new Date();
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

try {
  console.log("\n===========================================");
  console.log(`  LEADS & CALLS REPORT`);
  console.log(`  Period: ${START_DATE} to ${END_DATE}`);
  console.log("===========================================\n");

  // ============================================================================
  // Part 1: REDIAL QUEUE DATA (Total Leads)
  // ============================================================================

  let totalLeads = 0;
  let activeLeadsForRedialing = 0;
  let completedLeads = 0;
  let leadsCreatedInPeriod = 0;

  const startTimestamp = new Date(`${START_DATE}T00:00:00-05:00`).getTime();
  const endTimestamp = new Date(`${END_DATE}T23:59:59-05:00`).getTime();

  if (fs.existsSync(redialQueueDir)) {
    const queueFiles = fs
      .readdirSync(redialQueueDir)
      .filter((f) => f.endsWith(".json"));

    for (const file of queueFiles) {
      const filePath = path.join(redialQueueDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const records = Object.values(data);

      for (const record of records) {
        // Check if lead was created in our date range
        if (
          record.created_at >= startTimestamp &&
          record.created_at <= endTimestamp
        ) {
          leadsCreatedInPeriod++;
        }

        // Count total leads (regardless of creation date)
        totalLeads++;

        // Count active leads for redialing (non-sale, non-DNC)
        if (
          record.status === "pending" ||
          record.status === "rescheduled" ||
          record.status === "daily_max_reached"
        ) {
          activeLeadsForRedialing++;
        }

        // Count completed leads
        if (record.status === "completed") {
          completedLeads++;
        }
      }
    }
  }

  // ============================================================================
  // Part 2: STATISTICS DATA (Total Calls, Redials)
  // ============================================================================

  let totalCallsInPeriod = 0;
  let completedCallsInPeriod = 0;
  let failedCallsInPeriod = 0;
  let answeredCallsInPeriod = 0;
  let transferredCallsInPeriod = 0;
  let voicemailCallsInPeriod = 0;
  let noAnswerCallsInPeriod = 0;
  let daysWithData = 0;

  if (fs.existsSync(statsDir)) {
    const statsFiles = fs
      .readdirSync(statsDir)
      .filter((f) => f.startsWith("stats_") && f.endsWith(".json"));

    for (const file of statsFiles) {
      // Extract date from filename: stats_2026-01-05.json -> 2026-01-05
      const match = file.match(/stats_(\d{4}-\d{2}-\d{2})\.json/);
      if (!match || !match[1]) continue;

      const fileDate = match[1];

      // Check if date is in our range
      if (fileDate >= START_DATE && fileDate <= END_DATE) {
        const filePath = path.join(statsDir, file);
        const dayStats = JSON.parse(fs.readFileSync(filePath, "utf-8"));

        totalCallsInPeriod += dayStats.total_calls || 0;
        completedCallsInPeriod += dayStats.completed_calls || 0;
        failedCallsInPeriod += dayStats.failed_calls || 0;
        answeredCallsInPeriod += dayStats.answered_calls || 0;
        transferredCallsInPeriod += dayStats.transferred_calls || 0;
        voicemailCallsInPeriod += dayStats.voicemail_calls || 0;
        noAnswerCallsInPeriod += dayStats.no_answer_calls || 0;

        daysWithData++;
      }
    }
  }

  // ============================================================================
  // Calculate Redials (calls beyond the first attempt)
  // ============================================================================

  // Total redials = Total calls - Total unique leads created in period
  // This gives us how many calls were RE-dials (not first attempts)
  const totalRedials = totalCallsInPeriod - leadsCreatedInPeriod;

  // ============================================================================
  // OUTPUT REPORT
  // ============================================================================

  console.log("📊 LEADS DATA:");
  console.log("─────────────────────────────────────────");
  console.log(`Total leads created in period:     ${leadsCreatedInPeriod}`);
  console.log(`Total leads (all-time):            ${totalLeads}`);
  console.log(`Active leads for redialing:        ${activeLeadsForRedialing}`);
  console.log(`  (non-sale & non-DNC)`);
  console.log(`Completed leads:                   ${completedLeads}`);
  console.log("");

  console.log("📞 CALLS DATA:");
  console.log("─────────────────────────────────────────");
  console.log(`Total calls in period:             ${totalCallsInPeriod}`);
  console.log(`Total redials in period:           ${totalRedials}`);
  console.log(`  (calls beyond first attempt)`);
  console.log(`Completed calls:                   ${completedCallsInPeriod}`);
  console.log(`Failed calls:                      ${failedCallsInPeriod}`);
  console.log("");

  console.log("📈 CALL OUTCOMES:");
  console.log("─────────────────────────────────────────");
  console.log(`Answered calls:                    ${answeredCallsInPeriod}`);
  console.log(`Transferred calls:                 ${transferredCallsInPeriod}`);
  console.log(`Voicemail calls:                   ${voicemailCallsInPeriod}`);
  console.log(`No answer calls:                   ${noAnswerCallsInPeriod}`);
  console.log("");

  console.log("📆 PERIOD INFO:");
  console.log("─────────────────────────────────────────");
  console.log(`Days with data:                    ${daysWithData}`);
  console.log(
    `Avg calls per day:                 ${daysWithData > 0 ? Math.round(totalCallsInPeriod / daysWithData) : 0}`
  );
  console.log("");

  console.log("===========================================");
  console.log("FOR DELAINE & ANTHONY SYNC:");
  console.log("===========================================");
  console.log(
    `1. Total leads (${START_DATE} to now):        ${leadsCreatedInPeriod}`
  );
  console.log(
    `2. Leads still for redialing:                 ${activeLeadsForRedialing}`
  );
  console.log(`   (non-sale & non-DNC)`);
  console.log(
    `3. Total calls done:                          ${totalCallsInPeriod}`
  );
  console.log(`4. Total redials:                             ${totalRedials}`);
  console.log("===========================================\n");

  // Also output as JSON for easy parsing
  const jsonOutput = {
    period: {
      start_date: START_DATE,
      end_date: END_DATE,
      days_with_data: daysWithData,
    },
    leads: {
      created_in_period: leadsCreatedInPeriod,
      total_all_time: totalLeads,
      active_for_redialing: activeLeadsForRedialing,
      completed: completedLeads,
    },
    calls: {
      total_in_period: totalCallsInPeriod,
      total_redials: totalRedials,
      completed: completedCallsInPeriod,
      failed: failedCallsInPeriod,
      answered: answeredCallsInPeriod,
      transferred: transferredCallsInPeriod,
      voicemail: voicemailCallsInPeriod,
      no_answer: noAnswerCallsInPeriod,
    },
    metrics: {
      avg_calls_per_day:
        daysWithData > 0 ? Math.round(totalCallsInPeriod / daysWithData) : 0,
      redial_rate:
        leadsCreatedInPeriod > 0
          ? ((totalRedials / leadsCreatedInPeriod) * 100).toFixed(2) + "%"
          : "0%",
      connectivity_rate:
        totalCallsInPeriod > 0
          ? ((answeredCallsInPeriod / totalCallsInPeriod) * 100).toFixed(2) +
            "%"
          : "0%",
      transfer_rate:
        answeredCallsInPeriod > 0
          ? ((transferredCallsInPeriod / answeredCallsInPeriod) * 100).toFixed(
              2
            ) + "%"
          : "0%",
    },
  };

  console.log("JSON OUTPUT (for programmatic access):");
  console.log("─────────────────────────────────────────");
  console.log(JSON.stringify(jsonOutput, null, 2));
  console.log("\n");
} catch (error) {
  console.error("Error:", error.message);
  console.error(error.stack);
  process.exit(1);
}
