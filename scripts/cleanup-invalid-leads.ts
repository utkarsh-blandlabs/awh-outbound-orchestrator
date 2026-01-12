#!/usr/bin/env ts-node
/**
 * Cleanup Invalid Leads from Redial Queue
 *
 * Removes leads with empty list_id from the redial queue
 * These leads cannot be updated in Convoso and waste API calls
 *
 * SAFETY FEATURES:
 * - Does NOT remove leads with attempts_today > 0 (being called today)
 * - Does NOT remove leads with status "pending" (currently dialing)
 * - Creates backups before making changes
 * - Dry-run mode available for preview
 *
 * RECOMMENDED: Stop orchestrator before running for safest cleanup
 *   pm2 stop awh-orchestrator
 *   npx ts-node scripts/cleanup-invalid-leads.ts
 *   pm2 start awh-orchestrator
 *
 * Usage:
 *   npx ts-node scripts/cleanup-invalid-leads.ts --dry-run  # Preview only
 *   npx ts-node scripts/cleanup-invalid-leads.ts            # Apply cleanup
 */

import * as fs from "fs";
import * as path from "path";

interface RedialQueueLead {
  lead_id: string;
  list_id: string;
  phone_number: string;
  first_name: string;
  last_name: string;
  state: string;
  status: string;
  attempts: number;
  attempts_today: number;
  [key: string]: any;
}

const DATA_DIR = path.join(__dirname, "../data/redial-queue");

function loadRedialQueue(filePath: string): Record<string, RedialQueueLead> {
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
  } catch (error: any) {
    console.error(`Failed to load ${filePath}:`, error.message);
    return {};
  }
}

function saveRedialQueue(
  filePath: string,
  queue: Record<string, RedialQueueLead>
): void {
  fs.writeFileSync(filePath, JSON.stringify(queue, null, 2), "utf-8");
}

function analyzeQueue(queue: Record<string, RedialQueueLead>) {
  const leads = Object.values(queue);

  const emptyListId = leads.filter((l) => !l.list_id || l.list_id === "");
  const emptyFirstName = leads.filter((l) => !l.first_name || l.first_name === "");
  const emptyLastName = leads.filter((l) => !l.last_name || l.last_name === "");
  const emptyState = leads.filter((l) => !l.state || l.state === "");
  const invalidPhone = leads.filter(
    (l) => !l.phone_number || l.phone_number.replace(/\D/g, "").length < 10
  );

  return {
    total: leads.length,
    emptyListId: emptyListId.length,
    emptyFirstName: emptyFirstName.length,
    emptyLastName: emptyLastName.length,
    emptyState: emptyState.length,
    invalidPhone: invalidPhone.length,
    valid: leads.filter(
      (l) =>
        l.list_id &&
        l.list_id !== "" &&
        l.phone_number &&
        l.phone_number.replace(/\D/g, "").length >= 10
    ).length,
  };
}

async function cleanupQueue(dryRun: boolean = false): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("REDIAL QUEUE CLEANUP - REMOVE INVALID LEADS");
  console.log("=".repeat(70));
  console.log(`Mode: ${dryRun ? "DRY RUN (preview only)" : "APPLY CHANGES"}\n`);

  // Find all redial queue files
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("redial-queue_") && f.endsWith(".json"));

  console.log(`Found ${files.length} redial queue file(s):\n`);

  let totalBefore = 0;
  let totalAfter = 0;
  let totalRemoved = 0;
  const allRemovedLeads: Array<{
    lead: RedialQueueLead;
    reason: string;
    file: string;
  }> = [];

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    console.log(`\n📁 Processing: ${file}`);
    console.log("-".repeat(70));

    // Load queue
    const queue = loadRedialQueue(filePath);
    const before = analyzeQueue(queue);
    totalBefore += before.total;

    console.log(`\nBEFORE CLEANUP:`);
    console.log(`  Total leads:          ${before.total}`);
    console.log(`  Empty list_id:        ${before.emptyListId} ❌`);
    console.log(`  Empty first_name:     ${before.emptyFirstName}`);
    console.log(`  Empty last_name:      ${before.emptyLastName}`);
    console.log(`  Empty state:          ${before.emptyState}`);
    console.log(`  Invalid phone:        ${before.invalidPhone} ❌`);
    console.log(`  Valid leads:          ${before.valid} ✅`);

    // Filter out invalid leads (with safety checks)
    const cleanedQueue: Record<string, RedialQueueLead> = {};
    const removedLeads: Array<{
      lead: RedialQueueLead;
      reason: string;
      file: string;
    }> = [];
    let removed = 0;
    let skippedActive = 0;
    const removalReasons: Record<string, number> = {
      empty_list_id: 0,
      invalid_phone: 0,
      both: 0,
    };

    for (const [key, lead] of Object.entries(queue)) {
      const hasEmptyListId = !lead.list_id || lead.list_id === "";
      const hasInvalidPhone =
        !lead.phone_number || lead.phone_number.replace(/\D/g, "").length < 10;

      // SAFETY CHECK: Don't remove leads that are actively being processed
      const isActiveToday = lead.attempts_today > 0;
      const isPending = lead.status === "pending";
      const isBeingCalled = isActiveToday || isPending;

      if (isBeingCalled && (hasEmptyListId || hasInvalidPhone)) {
        // Keep lead but mark it for manual review
        console.log(
          `  ⚠️  SAFETY: Keeping active lead despite issues: ${lead.lead_id} (${lead.phone_number})`
        );
        cleanedQueue[key] = lead;
        skippedActive++;
        continue;
      }

      // Determine removal reason
      let reason = "";
      if (hasEmptyListId && hasInvalidPhone) {
        reason = "Empty list_id AND invalid phone number";
        removalReasons.both++;
        removed++;
        removedLeads.push({ lead, reason, file });
      } else if (hasEmptyListId) {
        reason = "Empty list_id (cannot update Convoso)";
        removalReasons.empty_list_id++;
        removed++;
        removedLeads.push({ lead, reason, file });
      } else if (hasInvalidPhone) {
        reason = "Invalid phone number (less than 10 digits)";
        removalReasons.invalid_phone++;
        removed++;
        removedLeads.push({ lead, reason, file });
      } else {
        // Keep valid lead
        cleanedQueue[key] = lead;
      }
    }

    totalRemoved += removed;
    allRemovedLeads.push(...removedLeads);

    console.log(`\nREMOVAL BREAKDOWN:`);
    console.log(`  Empty list_id only:   ${removalReasons.empty_list_id}`);
    console.log(`  Invalid phone only:   ${removalReasons.invalid_phone}`);
    console.log(`  Both issues:          ${removalReasons.both}`);
    console.log(`  Total to remove:      ${removed} ❌`);
    if (skippedActive > 0) {
      console.log(`  Skipped (active):     ${skippedActive} ⚠️  (being called today)`);
    }

    const after = analyzeQueue(cleanedQueue);
    totalAfter += after.total;

    console.log(`\nAFTER CLEANUP:`);
    console.log(`  Total leads:          ${after.total}`);
    console.log(`  Valid leads:          ${after.valid} ✅`);
    console.log(`  Percentage kept:      ${((after.total / before.total) * 100).toFixed(1)}%`);

    // Save cleaned queue (if not dry run)
    if (!dryRun) {
      // Create backup first
      const backupDir = path.join(DATA_DIR, "backups");
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const backupPath = path.join(
        backupDir,
        `${file}.backup-${Date.now()}`
      );
      fs.copyFileSync(filePath, backupPath);
      console.log(`\n💾 Backup created: ${backupPath}`);

      saveRedialQueue(filePath, cleanedQueue);
      console.log(`✅ Cleaned queue saved to: ${filePath}`);
    } else {
      console.log(`\n⚠️  DRY RUN: No changes applied`);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("CLEANUP SUMMARY");
  console.log("=".repeat(70));
  console.log(`Total leads before:   ${totalBefore}`);
  console.log(`Total leads after:    ${totalAfter}`);
  console.log(`Total removed:        ${totalRemoved} (${((totalRemoved / totalBefore) * 100).toFixed(1)}%)`);

  // Save removed leads to a separate file for review
  if (allRemovedLeads.length > 0) {
    const removedLeadsFile = path.join(
      DATA_DIR,
      `removed-invalid-leads-${Date.now()}.json`
    );

    // Format for easy review
    const formattedRemovedLeads = allRemovedLeads.map((item) => ({
      lead_id: item.lead.lead_id,
      phone_number: item.lead.phone_number,
      list_id: item.lead.list_id,
      first_name: item.lead.first_name,
      last_name: item.lead.last_name,
      state: item.lead.state,
      status: item.lead.status,
      attempts: item.lead.attempts,
      attempts_today: item.lead.attempts_today,
      last_attempt: item.lead.last_attempt,
      reason_for_removal: item.reason,
      original_file: item.file,
    }));

    if (!dryRun) {
      fs.writeFileSync(
        removedLeadsFile,
        JSON.stringify(formattedRemovedLeads, null, 2),
        "utf-8"
      );
      console.log(`\n📋 Removed leads saved to: ${removedLeadsFile}`);
      console.log(`   You can review these ${allRemovedLeads.length} leads before they're permanently deleted`);
    } else {
      console.log(`\n📋 Would save ${allRemovedLeads.length} removed leads to: removed-invalid-leads-[timestamp].json`);
    }
  }

  if (dryRun) {
    console.log(`\n⚠️  DRY RUN MODE: No changes were applied`);
    console.log(`Run without --dry-run to apply cleanup\n`);
  } else {
    console.log(`\n✅ Cleanup completed successfully!`);
    console.log(`💾 Backups saved to: ${path.join(DATA_DIR, "backups")}`);
  }

  // Show expected impact
  const dailyCallsSaved = Math.round((totalRemoved / 30) * 8); // Assuming 30 days retention, 8 calls/day
  console.log("📊 EXPECTED IMPACT:");
  console.log(`  - Reduced wasted Bland.ai calls: ~${dailyCallsSaved}/day`);
  console.log(`  - Reduced failed Convoso updates: ~${Math.round(totalRemoved * 0.25)}/day`);
  console.log(`  - Cleaner logs and better performance ✅`);

  // Safety warning if leads are still being called
  if (totalBefore > totalAfter && totalRemoved > 0) {
    console.log(`\n⚠️  IMPORTANT: Some invalid leads may still get called today`);
    console.log(`   (Leads with attempts_today > 0 were kept for safety)`);
    console.log(`\n💡 For cleanest results, run this script when:`);
    console.log(`   1. After business hours (8 PM EST)`);
    console.log(`   2. OR stop the orchestrator first: pm2 stop awh-orchestrator`);
  }
  console.log("");
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// Run cleanup
cleanupQueue(dryRun).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
