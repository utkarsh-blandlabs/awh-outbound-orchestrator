#!/usr/bin/env ts-node
/**
 * Redial Queue Cleanup Script
 *
 * This script:
 * 1. Merges duplicate records (same phone number across multiple files)
 * 2. Identifies and removes invalid records (missing required fields)
 * 3. Generates a detailed report
 * 4. Backs up original files before making changes
 *
 * Usage:
 *   npx ts-node scripts/cleanup-redial-queue.ts
 *   npx ts-node scripts/cleanup-redial-queue.ts --dry-run  (preview only, no changes)
 */

import * as fs from "fs";
import * as path from "path";

interface RedialRecord {
  lead_id: string;
  phone_number: string;
  list_id: string;
  first_name?: string;
  last_name?: string;
  state?: string;
  status: string;
  attempts: number;
  attempts_today: number;
  last_attempt_date: string;
  created_at: number;
  updated_at: number;
  next_attempt_time?: number;
}

interface CleanupReport {
  total_files: number;
  total_records_before: number;
  total_records_after: number;
  duplicates_merged: number;
  invalid_records: number;
  records_by_status: Record<string, number>;
  files_processed: string[];
  invalid_records_details: Array<{
    phone: string;
    lead_id: string;
    reason: string;
    record: any;
  }>;
}

const DATA_DIR = path.join(__dirname, "../data/redial-queue");
const BACKUP_DIR = path.join(__dirname, "../data/redial-queue-backups");
const INVALID_RECORDS_FILE = path.join(__dirname, "../data/invalid-redial-records.json");

const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Validate if a record has all required fields
 */
function isValidRecord(record: any): { valid: boolean; reason?: string } {
  // Required fields
  if (!record.lead_id) {
    return { valid: false, reason: "Missing lead_id" };
  }

  if (!record.phone_number) {
    return { valid: false, reason: "Missing phone_number" };
  }

  if (!record.list_id) {
    return { valid: false, reason: "Missing list_id" };
  }

  // Phone number validation
  const digits = record.phone_number.replace(/\D/g, "");
  if (digits.length < 10) {
    return { valid: false, reason: `Invalid phone number (too short): ${record.phone_number}` };
  }

  // Attempts should be a number
  if (typeof record.attempts !== "number" || record.attempts < 0) {
    return { valid: false, reason: `Invalid attempts count: ${record.attempts}` };
  }

  // Status should be valid
  const validStatuses = ["pending", "completed", "failed", "daily_max_reached", "exhausted"];
  if (!validStatuses.includes(record.status)) {
    return { valid: false, reason: `Invalid status: ${record.status}` };
  }

  return { valid: true };
}

/**
 * Normalize phone number to E.164 format
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  if (digits.startsWith("1") && digits.length === 11) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length >= 10) {
    return `+${digits}`;
  }

  return `+1${digits}`;
}

/**
 * Create backup of all redial queue files
 */
function createBackup(): void {
  if (DRY_RUN) {
    console.log("[DRY RUN] Would create backup in:", BACKUP_DIR);
    return;
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/:/g, "-").split(".")[0];
  const backupSubDir = path.join(BACKUP_DIR, `backup-${timestamp}`);
  fs.mkdirSync(backupSubDir, { recursive: true });

  const files = fs.readdirSync(DATA_DIR);
  let backedUpCount = 0;

  for (const file of files) {
    if (file.startsWith("redial-queue_") && file.endsWith(".json")) {
      const srcPath = path.join(DATA_DIR, file);
      const destPath = path.join(backupSubDir, file);
      fs.copyFileSync(srcPath, destPath);
      backedUpCount++;
    }
  }

  console.log(`✓ Backed up ${backedUpCount} files to: ${backupSubDir}`);
}

/**
 * Load all redial queue records from all files
 */
function loadAllRecords(): Map<string, RedialRecord> {
  const allRecords = new Map<string, RedialRecord>();

  if (!fs.existsSync(DATA_DIR)) {
    console.error(`Error: Data directory not found: ${DATA_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(DATA_DIR);

  for (const file of files) {
    if (!file.startsWith("redial-queue_") || !file.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(DATA_DIR, file);

    try {
      const data = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(data);

      for (const [key, record] of Object.entries<any>(parsed)) {
        const normalizedPhone = normalizePhone(record.phone_number);
        const existingRecord = allRecords.get(normalizedPhone);

        if (existingRecord) {
          // Merge: keep the one with more attempts or more recent
          if (record.attempts > existingRecord.attempts || record.updated_at > existingRecord.updated_at) {
            allRecords.set(normalizedPhone, record as RedialRecord);
          }
        } else {
          allRecords.set(normalizedPhone, record as RedialRecord);
        }
      }
    } catch (error: any) {
      console.error(`Error loading file ${file}:`, error.message);
    }
  }

  return allRecords;
}

/**
 * Clean up records and generate report
 */
function cleanupRecords(): CleanupReport {
  const report: CleanupReport = {
    total_files: 0,
    total_records_before: 0,
    total_records_after: 0,
    duplicates_merged: 0,
    invalid_records: 0,
    records_by_status: {},
    files_processed: [],
    invalid_records_details: [],
  };

  // Load all records (automatically merges duplicates)
  const allRecords = loadAllRecords();
  report.total_records_before = allRecords.size;

  // Separate valid and invalid records
  const validRecords = new Map<string, RedialRecord>();
  const invalidRecords: any[] = [];

  for (const [phone, record] of allRecords.entries()) {
    const validation = isValidRecord(record);

    if (validation.valid) {
      validRecords.set(phone, record);

      // Count by status
      const status = record.status || "unknown";
      report.records_by_status[status] = (report.records_by_status[status] || 0) + 1;
    } else {
      invalidRecords.push({
        phone,
        lead_id: record.lead_id,
        reason: validation.reason,
        record,
      });
      report.invalid_records++;
    }
  }

  report.total_records_after = validRecords.size;
  report.invalid_records_details = invalidRecords;

  // Calculate duplicates merged
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith("redial-queue_") && f.endsWith(".json"));
  let totalRecordsInFiles = 0;

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    try {
      const data = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(data);
      totalRecordsInFiles += Object.keys(parsed).length;
      report.files_processed.push(file);
    } catch (error) {
      // Ignore
    }
  }

  report.total_files = files.length;
  report.duplicates_merged = totalRecordsInFiles - report.total_records_after - report.invalid_records;

  // Save invalid records to separate file
  if (invalidRecords.length > 0 && !DRY_RUN) {
    fs.writeFileSync(INVALID_RECORDS_FILE, JSON.stringify(invalidRecords, null, 2));
    console.log(`\n⚠️  Saved ${invalidRecords.length} invalid records to: ${INVALID_RECORDS_FILE}`);
  }

  // Write cleaned records back to current month file
  if (!DRY_RUN && validRecords.size > 0) {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const cleanedFilePath = path.join(DATA_DIR, `redial-queue_${currentMonth}.json`);

    const cleanedData: Record<string, RedialRecord> = {};
    for (const [phone, record] of validRecords.entries()) {
      cleanedData[phone] = record;
    }

    fs.writeFileSync(cleanedFilePath, JSON.stringify(cleanedData, null, 2));
    console.log(`\n✓ Wrote ${validRecords.size} cleaned records to: ${cleanedFilePath}`);

    // Delete old files (keep only current month)
    for (const file of files) {
      if (file !== `redial-queue_${currentMonth}.json`) {
        const filePath = path.join(DATA_DIR, file);
        fs.unlinkSync(filePath);
        console.log(`  Deleted old file: ${file}`);
      }
    }
  }

  return report;
}

/**
 * Print cleanup report
 */
function printReport(report: CleanupReport): void {
  console.log("\n" + "=".repeat(60));
  console.log("REDIAL QUEUE CLEANUP REPORT");
  console.log("=".repeat(60));

  console.log(`\n📁 Files Processed: ${report.total_files}`);
  console.log(`   ${report.files_processed.join(", ")}`);

  console.log(`\n📊 Records Summary:`);
  console.log(`   Total records before: ${report.total_records_before}`);
  console.log(`   Duplicates merged:    ${report.duplicates_merged}`);
  console.log(`   Invalid records:      ${report.invalid_records}`);
  console.log(`   Total records after:  ${report.total_records_after}`);

  console.log(`\n📈 Records by Status:`);
  for (const [status, count] of Object.entries(report.records_by_status).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${status.padEnd(20)} ${count}`);
  }

  if (report.invalid_records > 0) {
    console.log(`\n❌ Invalid Records (${report.invalid_records}):`);
    for (const invalid of report.invalid_records_details.slice(0, 10)) {
      console.log(`   Phone: ${invalid.phone}, Lead: ${invalid.lead_id}`);
      console.log(`   Reason: ${invalid.reason}`);
    }

    if (report.invalid_records_details.length > 10) {
      console.log(`   ... and ${report.invalid_records_details.length - 10} more`);
    }

    console.log(`\n   Full details saved to: ${INVALID_RECORDS_FILE}`);
  }

  console.log("\n" + "=".repeat(60));

  if (DRY_RUN) {
    console.log("\n[DRY RUN] No changes were made. Remove --dry-run to apply changes.");
  } else {
    console.log("\n✅ Cleanup completed successfully!");
  }
}

/**
 * Main execution
 */
function main(): void {
  console.log("Redial Queue Cleanup Script");
  console.log("===========================\n");

  if (DRY_RUN) {
    console.log("🔍 DRY RUN MODE - No changes will be made\n");
  }

  // Step 1: Create backup
  console.log("Step 1: Creating backup...");
  createBackup();

  // Step 2: Clean up records
  console.log("\nStep 2: Analyzing and cleaning records...");
  const report = cleanupRecords();

  // Step 3: Print report
  printReport(report);
}

// Run the script
main();
