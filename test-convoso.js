// Quick Convoso API Test
// Run with: node test-convoso.js

const axios = require("axios");
require("dotenv").config();

const CONVOSO_AUTH_TOKEN = process.env.CONVOSO_AUTH_TOKEN;
const CONVOSO_BASE_URL =
  process.env.CONVOSO_BASE_URL || "https://api.convoso.com";
const CONVOSO_LIST_ID = process.env.CONVOSO_LIST_ID || "16529";

async function testConvosoConnection() {
  console.log("🧪 Testing Convoso API Connection...\n");

  console.log("📋 Configuration:");
  console.log(`   Base URL: ${CONVOSO_BASE_URL}`);
  console.log(`   Auth Token: ${CONVOSO_AUTH_TOKEN ? "✓ Set" : "✗ Missing"}`);
  console.log(`   List ID: ${CONVOSO_LIST_ID}\n`);

  if (!CONVOSO_AUTH_TOKEN) {
    console.error("❌ CONVOSO_AUTH_TOKEN is not set in .env file");
    process.exit(1);
  }

  // Test 1: Insert/Update a test lead
  console.log("📝 Test 1: Inserting test lead...");
  try {
    const leadResponse = await axios.post(
      `${CONVOSO_BASE_URL}/v1/leads/insert`,
      null,
      {
        params: {
          auth_token: CONVOSO_AUTH_TOKEN,
          list_id: CONVOSO_LIST_ID,
          phone_number: "6284444907",
          first_name: "Test",
          last_name: "User",
          lead_id: "test_lead_12345",
          status: "NEW",
        },
        timeout: 10000,
      }
    );

    console.log("✅ Lead Insert Response:");
    console.log(JSON.stringify(leadResponse.data, null, 2));
    console.log("");
  } catch (error) {
    console.error("❌ Lead Insert Failed:");
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(
        `   Message: ${JSON.stringify(error.response.data, null, 2)}`
      );
    } else {
      console.error(`   Error: ${error.message}`);
    }
    console.log("");
  }

  // Test 2: Update call log
  console.log("📞 Test 2: Updating call log...");
  try {
    const logResponse = await axios.post(
      `${CONVOSO_BASE_URL}/v1/log/update`,
      null,
      {
        params: {
          auth_token: CONVOSO_AUTH_TOKEN,
          phone_number: "6284444907",
          lead_id: "test_lead_12345",
          call_transcript: "Test transcript from API check",
        },
        timeout: 10000,
      }
    );

    console.log("✅ Call Log Update Response:");
    console.log(JSON.stringify(logResponse.data, null, 2));
    console.log("");
  } catch (error) {
    console.error("❌ Call Log Update Failed:");
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(
        `   Message: ${JSON.stringify(error.response.data, null, 2)}`
      );
    } else {
      console.error(`   Error: ${error.message}`);
    }
    console.log("");
  }

  console.log("🏁 Convoso API test complete!");
  console.log(
    "\nℹ️  If both tests passed, your Convoso integration is working correctly."
  );
  console.log("ℹ️  If tests failed, check:");
  console.log("   1. CONVOSO_AUTH_TOKEN is correct");
  console.log("   2. CONVOSO_BASE_URL is correct");
  console.log("   3. CONVOSO_LIST_ID exists in your Convoso account");
}

testConvosoConnection().catch(console.error);
