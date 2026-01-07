#!/usr/bin/env node
/**
 * Get detailed breakdown of leads by outcome for date range
 * Run this on EC2 production server: node get-detailed-breakdown.js
 *
 * Date Range: December 22, 2025 - January 7, 2026
 */

const fs = require('fs');
const path = require('path');

const redialQueueDir = path.join(__dirname, 'data', 'redial-queue');

// Date range for analysis
const START_DATE = '2025-12-22';
const END_DATE = '2026-01-07';

try {
  console.log('\n===========================================');
  console.log(`  DETAILED LEADS BREAKDOWN`);
  console.log(`  Period: ${START_DATE} to ${END_DATE}`);
  console.log('===========================================\n');

  const startTimestamp = new Date(`${START_DATE}T00:00:00-05:00`).getTime();
  const endTimestamp = new Date(`${END_DATE}T23:59:59-05:00`).getTime();

  // Categories for leads created in the period
  let leadsInPeriod = [];

  // Also track all-time stats for comparison
  let allTimeLeads = [];

  if (!fs.existsSync(redialQueueDir)) {
    console.error('Redial queue directory not found:', redialQueueDir);
    process.exit(1);
  }

  const queueFiles = fs.readdirSync(redialQueueDir).filter(f => f.endsWith('.json'));

  for (const file of queueFiles) {
    const filePath = path.join(redialQueueDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const records = Object.values(data);

    for (const record of records) {
      allTimeLeads.push(record);

      // Filter leads created in our date range
      if (record.created_at >= startTimestamp && record.created_at <= endTimestamp) {
        leadsInPeriod.push(record);
      }
    }
  }

  // ============================================================================
  // CATEGORIZE LEADS IN PERIOD
  // ============================================================================

  // 1. Active leads for redialing (non-sale, non-DNC, not completed)
  const activeForRedialing = leadsInPeriod.filter(
    r => r.status === 'pending' || r.status === 'rescheduled' || r.status === 'daily_max_reached'
  );

  // 2. Completed with SALE/TRANSFER/ACA (successful outcomes)
  // NOTE: TRANSFERRED leads (without sale) should STILL be redialed!
  const completedWithSale = leadsInPeriod.filter(
    r => r.status === 'completed' &&
    (r.last_outcome === 'SALE' ||
     r.last_outcome === 'ACA' ||
     (r.last_outcome && (r.last_outcome.includes('SALE') || r.last_outcome.includes('ACA'))))
  );

  // TRANSFERRED but not sale - should continue redialing
  const transferredNotSale = leadsInPeriod.filter(
    r => (r.last_outcome === 'TRANSFERRED' || (r.last_outcome && r.last_outcome.includes('TRANSFER'))) &&
    !(r.last_outcome && (r.last_outcome.includes('SALE') || r.last_outcome.includes('ACA')))
  );

  // 3. Completed with DNC/NOT_INTERESTED (only these stop redialing)
  const completedWithDNC = leadsInPeriod.filter(
    r => r.status === 'completed' &&
    (r.last_outcome === 'DNC' ||
     r.last_outcome === 'NOT_INTERESTED' ||
     r.last_outcome === 'DO_NOT_CALL' ||
     (r.last_outcome && (r.last_outcome.includes('DNC') || r.last_outcome.includes('NOT_INTERESTED'))))
  );

  // 4. Completed with other outcomes (voicemail, no answer, callback, etc.)
  const completedWithOther = leadsInPeriod.filter(
    r => r.status === 'completed' &&
    r.last_outcome !== 'SALE' &&
    r.last_outcome !== 'ACA' &&
    r.last_outcome !== 'DNC' &&
    r.last_outcome !== 'NOT_INTERESTED' &&
    r.last_outcome !== 'DO_NOT_CALL' &&
    !(r.last_outcome && (r.last_outcome.includes('SALE') || r.last_outcome.includes('ACA') || r.last_outcome.includes('DNC') || r.last_outcome.includes('NOT_INTERESTED')))
  );

  // CRITICAL: Only SALE and DNC stop redialing!
  // Everything else (TRANSFERRED, VOICEMAIL, NO_ANSWER, etc.) continues redialing

  // Leads that SHOULD continue redialing (non-sale, non-DNC)
  const shouldContinueRedialing = activeForRedialing.length + transferredNotSale.length + completedWithOther.length;

  // Total non-sale = Everything except SALE
  const totalNonSale = leadsInPeriod.length - completedWithSale.length;

  // Total non-DNC = Everything except DNC
  const totalNonDNC = leadsInPeriod.length - completedWithDNC.length;

  // ============================================================================
  // ALL-TIME STATS FOR COMPARISON
  // ============================================================================

  const allTimeActive = allTimeLeads.filter(
    r => r.status === 'pending' || r.status === 'rescheduled' || r.status === 'daily_max_reached'
  );

  const allTimeCompleted = allTimeLeads.filter(r => r.status === 'completed');

  const allTimeDNC = allTimeLeads.filter(
    r => r.status === 'completed' &&
    (r.last_outcome === 'DNC' ||
     r.last_outcome === 'NOT_INTERESTED' ||
     (r.last_outcome && (r.last_outcome.includes('DNC') || r.last_outcome.includes('NOT_INTERESTED'))))
  );

  // ============================================================================
  // OUTPUT REPORT
  // ============================================================================

  console.log('📊 LEADS CREATED IN PERIOD (Dec 22 - Jan 7):');
  console.log('─────────────────────────────────────────');
  console.log(`Total leads in period:             ${leadsInPeriod.length}`);
  console.log('');

  console.log('📈 BREAKDOWN BY CATEGORY:');
  console.log('─────────────────────────────────────────');
  console.log(`1. Active for redialing:           ${activeForRedialing.length}`);
  console.log(`   (pending/rescheduled/daily_max)`);
  console.log('');
  console.log(`2. TRANSFERRED (not sale yet):     ${transferredNotSale.length}`);
  console.log(`   (still needs redialing!)`);
  console.log('');
  console.log(`3. Completed with SALE:            ${completedWithSale.length}`);
  console.log(`   (STOPS redialing)`);
  console.log('');
  console.log(`4. Completed with DNC:             ${completedWithDNC.length}`);
  console.log(`   (STOPS redialing)`);
  console.log('');
  console.log(`5. Completed with other outcomes:  ${completedWithOther.length}`);
  console.log(`   (voicemail, no answer, etc.)`);
  console.log('');

  console.log('🎯 CRITICAL METRICS:');
  console.log('─────────────────────────────────────────');
  console.log(`SHOULD CONTINUE REDIALING:         ${shouldContinueRedialing}`);
  console.log(`  (active + transferred + other)`);
  console.log('');
  console.log(`Total NON-SALE:                    ${totalNonSale}`);
  console.log(`  (everything except SALE)`);
  console.log('');
  console.log(`Total NON-DNC:                     ${totalNonDNC}`);
  console.log(`  (everything except DNC)`);
  console.log('');
  console.log(`Total SALE (stops redialing):      ${completedWithSale.length}`);
  console.log(`Total DNC (stops redialing):       ${completedWithDNC.length}`);
  console.log('');

  console.log('===========================================');
  console.log('ALL-TIME COMPARISON:');
  console.log('===========================================');
  console.log(`Total leads (all-time):            ${allTimeLeads.length}`);
  console.log(`Active for redialing (all-time):   ${allTimeActive.length}`);
  console.log(`Completed (all-time):              ${allTimeCompleted.length}`);
  console.log(`DNC (all-time):                    ${allTimeDNC.length}`);
  console.log('');

  console.log('===========================================');
  console.log('FOR DELAINE & ANTHONY:');
  console.log('===========================================');
  console.log(`Period: ${START_DATE} to ${END_DATE}`);
  console.log('');
  console.log(`1. Total leads in period:                 ${leadsInPeriod.length}`);
  console.log(`2. Should continue redialing:             ${shouldContinueRedialing}`);
  console.log(`   (active + transferred + other)`);
  console.log(`3. Total non-sale:                        ${totalNonSale}`);
  console.log(`4. Total non-DNC:                         ${totalNonDNC}`);
  console.log(`5. Total SALE:                            ${completedWithSale.length}`);
  console.log(`6. Total DNC:                             ${completedWithDNC.length}`);
  console.log('');
  console.log(`💡 KEY INSIGHT:`);
  console.log(`   Only SALE (${completedWithSale.length}) and DNC (${completedWithDNC.length}) stop redialing.`);
  console.log(`   Everything else (${shouldContinueRedialing}) continues 8x/day.`);
  console.log('===========================================\n');

  // Detailed outcome breakdown
  console.log('📋 DETAILED OUTCOME ANALYSIS:');
  console.log('─────────────────────────────────────────');
  const outcomeMap = {};
  for (const lead of leadsInPeriod) {
    const outcome = lead.last_outcome || 'NO_OUTCOME_YET';
    const status = lead.status;
    const key = `${status}:${outcome}`;
    outcomeMap[key] = (outcomeMap[key] || 0) + 1;
  }

  const sortedOutcomes = Object.entries(outcomeMap).sort((a, b) => b[1] - a[1]);
  for (const [key, count] of sortedOutcomes) {
    const [status, outcome] = key.split(':');
    console.log(`${status.padEnd(20)} | ${outcome.padEnd(25)} | ${count}`);
  }
  console.log('\n');

  // JSON output
  const jsonOutput = {
    period: {
      start_date: START_DATE,
      end_date: END_DATE
    },
    period_stats: {
      total_leads: leadsInPeriod.length,
      active_for_redialing: activeForRedialing.length,
      transferred_not_sale: transferredNotSale.length,
      should_continue_redialing: shouldContinueRedialing,
      completed_with_sale: completedWithSale.length,
      completed_with_dnc: completedWithDNC.length,
      completed_with_other: completedWithOther.length,
      total_non_sale: totalNonSale,
      total_non_dnc: totalNonDNC
    },
    all_time_stats: {
      total_leads: allTimeLeads.length,
      active_for_redialing: allTimeActive.length,
      completed: allTimeCompleted.length,
      dnc: allTimeDNC.length
    },
    expected_daily_calls: shouldContinueRedialing * 8,
    outcome_breakdown: outcomeMap
  };

  console.log('JSON OUTPUT:');
  console.log('─────────────────────────────────────────');
  console.log(JSON.stringify(jsonOutput, null, 2));
  console.log('\n');

} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}
