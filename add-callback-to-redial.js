/**
 * Add specific call to redial queue
 * Usage: node add-callback-to-redial.js <call_id>
 * Example: node add-callback-to-redial.js 699370f8-748c-413b-98fa-71ffcda88b7f
 */

const axios = require("axios");
require("dotenv").config();

const BLAND_API_KEY = process.env.BLAND_API_KEY;
const CONVOSO_AUTH_TOKEN = process.env.CONVOSO_AUTH_TOKEN;
const CONVOSO_BASE_URL = process.env.CONVOSO_BASE_URL || "https://api.convoso.com";

async function fetchCallFromBland(callId) {
  console.log(`\n🔍 Fetching call details from Bland.ai...`);
  console.log(`Call ID: ${callId}`);

  try {
    const response = await axios.get(
      `https://api.bland.ai/v1/calls/${callId}`,
      {
        headers: {
          Authorization: BLAND_API_KEY,
        },
      }
    );

    const call = response.data;

    console.log(`\n✅ Call found in Bland.ai:`);
    console.log(`  Phone: ${call.to || call.from}`);
    console.log(`  Status: ${call.status}`);
    console.log(`  Outcome: ${call.variables?.outcome || "N/A"}`);
    console.log(`  Duration: ${call.call_length || 0}s`);
    console.log(`  Variables:`, JSON.stringify(call.variables, null, 2));

    return call;
  } catch (error) {
    console.error(`\n❌ Error fetching call from Bland:`, error.response?.data || error.message);
    return null;
  }
}

async function fetchLeadFromConvoso(phoneNumber) {
  console.log(`\n🔍 Looking up lead in Convoso by phone: ${phoneNumber}`);

  try {
    // Normalize phone number
    const normalized = phoneNumber.replace(/\D/g, "");
    const formatted = normalized.length === 10 ? `+1${normalized}` : `+${normalized}`;

    const response = await axios.get(
      `${CONVOSO_BASE_URL}/lead/search`,
      {
        params: {
          phone: formatted,
        },
        headers: {
          "X-Auth-Token": CONVOSO_AUTH_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data && response.data.leads && response.data.leads.length > 0) {
      const lead = response.data.leads[0];
      console.log(`\n✅ Lead found in Convoso:`);
      console.log(`  Lead ID: ${lead.id}`);
      console.log(`  List ID: ${lead.list_id}`);
      console.log(`  Name: ${lead.first_name} ${lead.last_name}`);
      console.log(`  State: ${lead.state}`);
      console.log(`  Status: ${lead.status}`);

      return {
        lead_id: lead.id,
        list_id: lead.list_id,
        first_name: lead.first_name || "",
        last_name: lead.last_name || "",
        state: lead.state || "",
        phone_number: formatted,
      };
    } else {
      console.log(`\n⚠️  Lead not found in Convoso for phone: ${formatted}`);
      return null;
    }
  } catch (error) {
    console.error(`\n❌ Error fetching lead from Convoso:`, error.response?.data || error.message);
    return null;
  }
}

async function addToRedialQueue(leadInfo, callId, reason) {
  console.log(`\n📝 Adding to redial queue...`);

  const fs = require("fs");
  const path = require("path");

  // Load redial queue service logic
  const dataDir = path.join(__dirname, "data", "redial-queue");
  const now = Date.now();
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const filePath = path.join(dataDir, `redial-queue_${currentMonth}.json`);

  // Ensure directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Load existing records
  let records = [];
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, "utf-8");
    records = JSON.parse(data);
  }

  // Generate key
  const key = `${leadInfo.lead_id}_${leadInfo.phone_number}`;

  // Check if already exists
  const existingIndex = records.findIndex(r =>
    r.lead_id === leadInfo.lead_id && r.phone_number === leadInfo.phone_number
  );

  // Create record
  const record = {
    lead_id: leadInfo.lead_id,
    phone_number: leadInfo.phone_number,
    list_id: leadInfo.list_id,
    first_name: leadInfo.first_name,
    last_name: leadInfo.last_name,
    state: leadInfo.state,
    attempts: existingIndex >= 0 ? records[existingIndex].attempts : 0,
    attempts_today: existingIndex >= 0 ? records[existingIndex].attempts_today : 0,
    last_attempt_date: new Date().toISOString().split('T')[0],
    last_call_timestamp: now,
    next_redial_timestamp: now + (5 * 60 * 1000), // 5 minutes from now
    scheduled_callback_time: now + (5 * 60 * 1000), // Callback requested - call ASAP
    outcomes: existingIndex >= 0 ? [...records[existingIndex].outcomes, reason] : [reason],
    last_outcome: reason,
    last_call_id: callId,
    created_at: existingIndex >= 0 ? records[existingIndex].created_at : now,
    updated_at: now,
    status: "rescheduled", // High priority - callback requested
  };

  // Update or add record
  if (existingIndex >= 0) {
    records[existingIndex] = record;
    console.log(`✅ Updated existing record in redial queue`);
  } else {
    records.push(record);
    console.log(`✅ Added new record to redial queue`);
  }

  // Save
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf-8");

  console.log(`\n📊 Redial Queue Record:`);
  console.log(`  Lead ID: ${record.lead_id}`);
  console.log(`  Phone: ${record.phone_number}`);
  console.log(`  Name: ${record.first_name} ${record.last_name}`);
  console.log(`  Status: ${record.status}`);
  console.log(`  Next Call: ${new Date(record.next_redial_timestamp).toLocaleString()}`);
  console.log(`  File: ${filePath}`);

  return true;
}

async function main() {
  const callId = process.argv[2] || "699370f8-748c-413b-98fa-71ffcda88b7f";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Add Callback to Redial Queue`);
  console.log(`${"=".repeat(60)}`);

  // Step 1: Fetch call from Bland.ai
  const call = await fetchCallFromBland(callId);
  if (!call) {
    console.error(`\n❌ Failed to fetch call from Bland.ai. Exiting.`);
    process.exit(1);
  }

  // Step 2: Extract phone number
  const phoneNumber = call.to || call.from;
  if (!phoneNumber) {
    console.error(`\n❌ No phone number found in call. Exiting.`);
    process.exit(1);
  }

  // Step 3: Fetch lead from Convoso
  const leadInfo = await fetchLeadFromConvoso(phoneNumber);
  if (!leadInfo) {
    console.error(`\n❌ Failed to fetch lead from Convoso. Exiting.`);
    process.exit(1);
  }

  // Step 4: Verify data
  console.log(`\n✅ Data verification passed:`);
  console.log(`  ✓ Call found in Bland.ai`);
  console.log(`  ✓ Lead found in Convoso`);
  console.log(`  ✓ Lead ID: ${leadInfo.lead_id}`);
  console.log(`  ✓ List ID: ${leadInfo.list_id}`);
  console.log(`  ✓ Phone: ${leadInfo.phone_number}`);

  // Step 5: Add to redial queue
  const success = await addToRedialQueue(leadInfo, callId, "CALLBACK_REQUESTED_SMS");

  if (success) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  ✅ Successfully added to redial queue!`);
    console.log(`  📞 Lead will be called in ~5 minutes if within business hours`);
    console.log(`${"=".repeat(60)}\n`);
  } else {
    console.error(`\n❌ Failed to add to redial queue`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\n❌ Unexpected error:`, error);
  process.exit(1);
});
