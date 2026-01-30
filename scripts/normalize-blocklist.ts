/**
 * Blocklist Normalization Script
 *
 * This script:
 * 1. Normalizes all phone numbers (removes +1, standardizes to 10 digits)
 * 2. Removes duplicate entries (same normalized phone number)
 * 3. Keeps the earliest entry for each phone number
 * 4. Backs up the original blocklist before modifying
 *
 * Usage: npm run normalize-blocklist
 */

import fs from "fs";
import path from "path";

interface BlocklistFlag {
  id: string;
  field: string;
  value: string;
  reason?: string;
  added_at: string;
  added_by?: string;
  type?: string; // Legacy field
  permanent?: boolean;
}

interface BlocklistConfig {
  enabled: boolean;
  flags: BlocklistFlag[];
}

/**
 * Normalize phone number to consistent format (10 digits)
 */
function normalizePhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, "");

  // If starts with 1 and has 11 digits, remove the leading 1 (US country code)
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.substring(1);
  }

  // Return as-is if already 10 digits
  return digits;
}

async function normalizeBlocklist() {
  const configPath = path.join(process.cwd(), "data", "blocklist-config.json");
  const backupPath = path.join(
    process.cwd(),
    "data",
    `blocklist-config.backup.${Date.now()}.json`
  );

  console.log("📋 Starting blocklist normalization...\n");

  // Check if file exists
  if (!fs.existsSync(configPath)) {
    console.error("❌ Error: blocklist-config.json not found at:", configPath);
    process.exit(1);
  }

  // Load current config
  const rawData = fs.readFileSync(configPath, "utf-8");
  const config: BlocklistConfig = JSON.parse(rawData);

  console.log(`📊 Current state:`);
  console.log(`   - Total flags: ${config.flags.length}`);
  console.log(`   - Enabled: ${config.enabled}`);

  // Create backup
  fs.writeFileSync(backupPath, rawData, "utf-8");
  console.log(`\n💾 Backup created: ${backupPath}`);

  // Normalize and deduplicate
  const phoneMap = new Map<string, BlocklistFlag>();
  const nonPhoneFlags: BlocklistFlag[] = [];
  let normalizedCount = 0;
  let duplicateCount = 0;

  for (const flag of config.flags) {
    // Clean up legacy 'type' field
    if (flag.type) {
      delete flag.type;
    }

    // Handle phone number fields
    if (flag.field === "phone" || flag.field === "phone_number") {
      const originalValue = flag.value;
      const normalizedValue = normalizePhoneNumber(flag.value);

      // Update the flag's value to normalized version
      flag.value = normalizedValue;
      flag.field = "phone"; // Standardize field name

      if (originalValue !== normalizedValue) {
        normalizedCount++;
      }

      // Check for duplicates
      if (phoneMap.has(normalizedValue)) {
        duplicateCount++;
        const existing = phoneMap.get(normalizedValue)!;

        // Keep the earlier entry
        const existingDate = new Date(existing.added_at).getTime();
        const currentDate = new Date(flag.added_at).getTime();

        if (currentDate < existingDate) {
          // Current is older, replace
          phoneMap.set(normalizedValue, flag);
          console.log(`   ⚠️  Duplicate found: ${normalizedValue} (keeping older entry)`);
        } else {
          console.log(`   ⚠️  Duplicate found: ${normalizedValue} (skipping newer entry)`);
        }
      } else {
        phoneMap.set(normalizedValue, flag);
      }
    } else {
      // Non-phone flags (lead_id, email, etc.)
      nonPhoneFlags.push(flag);
    }
  }

  // Combine deduplicated phone flags with non-phone flags
  const deduplicatedFlags = [...phoneMap.values(), ...nonPhoneFlags];

  // Sort by added_at date (oldest first)
  deduplicatedFlags.sort((a, b) => {
    return new Date(a.added_at).getTime() - new Date(b.added_at).getTime();
  });

  // Update config
  config.flags = deduplicatedFlags;

  // Save normalized config
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  console.log(`\n✅ Normalization complete:`);
  console.log(`   - Original flags: ${config.flags.length + duplicateCount}`);
  console.log(`   - Normalized phone numbers: ${normalizedCount}`);
  console.log(`   - Duplicates removed: ${duplicateCount}`);
  console.log(`   - Final flags: ${config.flags.length}`);
  console.log(`   - Phone flags: ${phoneMap.size}`);
  console.log(`   - Non-phone flags: ${nonPhoneFlags.length}`);

  console.log(`\n📝 Summary:`);
  console.log(`   - Backup: ${backupPath}`);
  console.log(`   - Updated: ${configPath}`);
  console.log(`   - Space saved: ${duplicateCount} duplicate entries removed`);

  // Show some examples of normalized numbers
  if (normalizedCount > 0) {
    console.log(`\n📞 Normalized phone numbers (sample):`);
    let count = 0;
    for (const [phone, flag] of phoneMap.entries()) {
      if (count >= 5) break;
      if (flag.value.startsWith("+1")) {
        console.log(`   - ${flag.value} → ${phone}`);
        count++;
      }
    }
  }

  console.log(`\n🎉 Done! Your blocklist is now normalized and deduplicated.`);
}

// Run the script
normalizeBlocklist().catch((error) => {
  console.error("❌ Error normalizing blocklist:", error);
  process.exit(1);
});
