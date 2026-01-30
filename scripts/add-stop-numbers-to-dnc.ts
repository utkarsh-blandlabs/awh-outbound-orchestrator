#!/usr/bin/env ts-node
/**
 * Add STOP Numbers to DNC Blocklist
 *
 * This script manually adds phone numbers that sent STOP to:
 * 1. Blocklist (permanent DNC)
 * 2. Remove from SMS queue
 * 3. Mark as completed in redial queue
 */

import { blocklistService } from "../src/services/blocklistService";
import { smsSchedulerService } from "../src/services/smsSchedulerService";
import { redialQueueService } from "../src/services/redialQueueService";
import { logger } from "../src/utils/logger";

const STOP_NUMBERS = [
  "+12097691762",
  "+15127493053",
  "+12093217280",
  "+12532548048",
  "+15303101773",
  "+18036134177",
  "+13524458207",
  "+15626072981",
  "+18623323633",
  "+14234389608",
  "+19183121480",
  "+14582457468",
  "+15637709733",
  "+18432675526",
  "+13466982847",
  "+15048814609",
  "+12148756523",
  "+17148535136",
  "+12035921073",
  "+18015565287",
  "+14138242655",
  "+12529434936",
  "+19014841427",
  "+15406426444",
  "+15733943569",
  "+19109706890",
  "+19402551920",
  "+15707091117",
  "+15013183466",
  "+18704900184",
  "+16263438551",
  "+12525088344",
  "+16148974824",
  "+18438094103",
  "+16099290683",
  "+19788702074",
  "+14705054594",
  "+12542621198",
  "+16147149388",
  "+15868386905",
  "+15674189719",
];

async function addStopNumbersToDNC(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("ADD STOP NUMBERS TO DNC BLOCKLIST");
  console.log("=".repeat(60));
  console.log(`\nProcessing ${STOP_NUMBERS.length} phone numbers...\n`);

  let successCount = 0;
  let errorCount = 0;
  const errors: Array<{ phone: string; error: string }> = [];

  for (const phoneNumber of STOP_NUMBERS) {
    try {
      // Normalize phone number (remove +1)
      const normalizedPhone = phoneNumber.replace(/^\+1/, "").replace(/\D/g, "");

      console.log(`Processing ${phoneNumber} (${normalizedPhone})...`);

      // 1. Add to blocklist
      const result = blocklistService.addFlag(
        "phone",
        normalizedPhone,
        "DNC requested via SMS: Manual addition from STOP list 2026-01-10",
        `manual_stop_${Date.now()}_${normalizedPhone}`
      );

      if (result.alreadyExists) {
        console.log(`  ℹ Already in blocklist (flag: ${result.flag.id})`);
      } else {
        console.log(`  ✓ Added to blocklist (flag: ${result.flag.id})`);
      }

      // 2. Remove from SMS queue
      try {
        smsSchedulerService.removeLead(normalizedPhone);
        console.log(`  ✓ Removed from SMS queue`);
      } catch (error: any) {
        console.log(`  ⚠ SMS queue removal: ${error.message}`);
      }

      // 3. Mark as completed in redial queue
      try {
        await redialQueueService.markLeadAsCompleted(
          normalizedPhone,
          "DNC requested via SMS - manual addition"
        );
        console.log(`  ✓ Marked as completed in redial queue`);
      } catch (error: any) {
        console.log(`  ⚠ Redial queue: ${error.message}`);
      }

      successCount++;
      console.log(`  ✅ Successfully processed\n`);
    } catch (error: any) {
      errorCount++;
      errors.push({ phone: phoneNumber, error: error.message });
      console.log(`  ❌ Error: ${error.message}\n`);
    }
  }

  console.log("=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total numbers processed: ${STOP_NUMBERS.length}`);
  console.log(`Successfully added to DNC: ${successCount}`);
  console.log(`Errors: ${errorCount}`);

  if (errors.length > 0) {
    console.log(`\nErrors encountered:`);
    for (const err of errors) {
      console.log(`  ${err.phone}: ${err.error}`);
    }
  }

  console.log("\n✅ Script completed!\n");
}

// Run the script
addStopNumbersToDNC().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
