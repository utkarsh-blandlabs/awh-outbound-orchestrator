#!/usr/bin/env node
/**
 * Quick script to get total leads data
 * Run this on EC2 production server: node get-total-leads.js
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data', 'redial-queue');

// Function to get current date in EST timezone (YYYY-MM-DD format)
function getCurrentDateEST() {
  const now = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Function to get yesterday's date in EST timezone
function getYesterdayDateEST() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return yesterday.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

try {
  // Get all JSON files in the redial-queue directory
  const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    console.log('No redial queue data found.');
    process.exit(0);
  }

  let totalLeads = 0;
  let activeLeads = 0;
  let completedLeads = 0;
  let dailyMaxReached = 0;
  let fromYesterday = 0;
  let fromOlderDays = 0;

  const today = getCurrentDateEST();
  const yesterday = getYesterdayDateEST();
  const yesterdayStart = new Date(`${yesterday}T00:00:00-05:00`).getTime();
  const yesterdayEnd = new Date(`${yesterday}T23:59:59-05:00`).getTime();

  // Read all redial queue files
  for (const file of files) {
    const filePath = path.join(dataDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const records = Object.values(data);

    for (const record of records) {
      totalLeads++;

      // Count by status
      if (record.status === 'pending' || record.status === 'rescheduled' || record.status === 'daily_max_reached') {
        activeLeads++;

        // Count by age
        if (record.created_at >= yesterdayStart && record.created_at <= yesterdayEnd) {
          fromYesterday++;
        } else if (record.created_at < yesterdayStart) {
          fromOlderDays++;
        }
      } else if (record.status === 'completed') {
        completedLeads++;
      }

      if (record.status === 'daily_max_reached') {
        dailyMaxReached++;
      }
    }
  }

  const nonSaleNonDNC = activeLeads; // All active leads are non-sale, non-DNC

  console.log('\n===========================================');
  console.log('  TOTAL LEADS REPORT');
  console.log('===========================================\n');
  console.log(`Total leads (lifetime):        ${totalLeads}`);
  console.log(`Active leads (for redialing):  ${activeLeads}`);
  console.log(`  - From yesterday:            ${fromYesterday}`);
  console.log(`  - From older days:           ${fromOlderDays}`);
  console.log(`Daily max reached today:       ${dailyMaxReached}`);
  console.log(`Completed leads:               ${completedLeads}`);
  console.log('\n===========================================');
  console.log('For Anthony Sync:');
  console.log('===========================================');
  console.log(`Total leads for redialing (from Ashley's beginning): ${totalLeads}`);
  console.log(`Non-sale & non-DNC leads from yesterday: ${fromYesterday}`);
  console.log('===========================================\n');

} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
