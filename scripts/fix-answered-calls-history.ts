/**
 * Script to fix historical answered_calls data
 *
 * The bug was counting voicemail as answered calls.
 * This script recalculates answered_calls for all historical statistics
 * by only counting calls with "Plan Type" tag (human engagement).
 *
 * Usage:
 *   npx ts-node scripts/fix-answered-calls-history.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

interface DailyCallRecord {
  calls: Array<{
    call_id: string;
    timestamp: string;
    outcome: string;
    pathway_tags?: string[];
  }>;
  final_outcome: string;
  lead_ids: string[];
  last_call_timestamp: string;
}

interface Statistics {
  date: string;
  total_calls: number;
  completed_calls: number;
  answered_calls: number;
  transferred_calls: number;
  voicemail_calls: number;
  busy_calls: number;
  callback_requested_calls: number;
  no_answer_calls: number;
  not_interested_calls: number;
  failed_calls: number;
  transfer_rate: number;
  last_updated: string;
}

const DATA_DIR = join(process.cwd(), 'data');
const STATISTICS_DIR = join(DATA_DIR, 'statistics');
const DAILY_CALLS_DIR = join(DATA_DIR, 'daily-calls');

/**
 * Fix answered_calls for a specific date
 */
function fixAnsweredCallsForDate(date: string): boolean {
  const statsFile = join(STATISTICS_DIR, `stats_${date}.json`);
  const callsFile = join(DAILY_CALLS_DIR, `calls_${date}.json`);

  if (!existsSync(statsFile)) {
    console.log(`⚠️  No statistics file for ${date}, skipping`);
    return false;
  }

  if (!existsSync(callsFile)) {
    console.log(`⚠️  No calls file for ${date}, skipping`);
    return false;
  }

  try {
    // Read statistics
    const stats: Statistics = JSON.parse(readFileSync(statsFile, 'utf-8'));
    const oldAnsweredCalls = stats.answered_calls;

    // Read daily calls
    const dailyCalls: Record<string, DailyCallRecord> = JSON.parse(readFileSync(callsFile, 'utf-8'));

    // Recalculate answered_calls
    let newAnsweredCalls = 0;

    for (const [phoneNumber, record] of Object.entries(dailyCalls)) {
      for (const call of record.calls) {
        const pathwayTags = call.pathway_tags || [];

        // Only count calls with "Plan Type" tag as answered
        // Do NOT count voicemail as answered
        const hasPlanTypeTag = pathwayTags.some(tag =>
          tag && typeof tag === 'string' && tag.toLowerCase().includes('plan type')
        );

        if (hasPlanTypeTag) {
          newAnsweredCalls++;
        }
      }
    }

    // Update statistics
    stats.answered_calls = newAnsweredCalls;

    // Recalculate transfer_rate
    if (stats.completed_calls > 0) {
      stats.transfer_rate = Number(((stats.transferred_calls / stats.completed_calls) * 100).toFixed(2));
    }

    stats.last_updated = new Date().toISOString();

    // Write updated statistics
    writeFileSync(statsFile, JSON.stringify(stats, null, 2), 'utf-8');

    const change = newAnsweredCalls - oldAnsweredCalls;
    const changeStr = change > 0 ? `+${change}` : `${change}`;
    console.log(`✅ ${date}: ${oldAnsweredCalls} → ${newAnsweredCalls} (${changeStr})`);

    return oldAnsweredCalls !== newAnsweredCalls;
  } catch (error: any) {
    console.error(`❌ Error processing ${date}:`, error.message);
    return false;
  }
}

/**
 * Main execution
 */
function main() {
  console.log('🔧 Fixing historical answered_calls data...\n');

  if (!existsSync(STATISTICS_DIR)) {
    console.error('❌ Statistics directory not found:', STATISTICS_DIR);
    process.exit(1);
  }

  if (!existsSync(DAILY_CALLS_DIR)) {
    console.error('❌ Daily calls directory not found:', DAILY_CALLS_DIR);
    process.exit(1);
  }

  // Get all statistics files
  const statsFiles = readdirSync(STATISTICS_DIR)
    .filter(f => f.startsWith('stats_') && f.endsWith('.json'))
    .sort();

  if (statsFiles.length === 0) {
    console.log('⚠️  No statistics files found');
    process.exit(0);
  }

  console.log(`📊 Found ${statsFiles.length} statistics files\n`);

  let processedCount = 0;
  let changedCount = 0;
  let skippedCount = 0;

  for (const file of statsFiles) {
    const date = file.replace('stats_', '').replace('.json', '');
    const changed = fixAnsweredCallsForDate(date);

    processedCount++;
    if (changed) {
      changedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📈 Summary:');
  console.log(`   Total files: ${processedCount}`);
  console.log(`   Updated: ${changedCount}`);
  console.log(`   Unchanged: ${skippedCount}`);
  console.log('='.repeat(50));
  console.log('\n✨ Done!');
}

// Run the script
main();
