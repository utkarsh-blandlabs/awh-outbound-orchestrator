#!/usr/bin/env node
/**
 * Manual SMS Test Script
 * Sends a test SMS to verify Bland.ai SMS API is working
 */

const axios = require('axios');

// Configuration
const BLAND_API_KEY = 'org_95373169f2f2d97cf5ab62908020adb131837e7dcb3028a2c8ab25b3fc19b998b470089f04526d06512069';
const SMS_FROM = '+15619565858';
const TEST_PHONE = '+16284444907'; // User's test number

const TEST_MESSAGE = "TEST: Hey, this is Ashley from American Way Health! This is a test message to verify SMS is working. Text STOP to be removed anytime.";

async function sendTestSMS() {
  try {
    console.log('========================================');
    console.log('TESTING BLAND.AI SMS API');
    console.log('========================================');
    console.log('');
    console.log('Configuration:');
    console.log(`  From: ${SMS_FROM}`);
    console.log(`  To: ${TEST_PHONE}`);
    console.log(`  Message: ${TEST_MESSAGE}`);
    console.log('');

    console.log('Sending SMS via Bland.ai API...');

    const response = await axios.post(
      'https://api.bland.ai/v1/sms/send',
      {
        user_number: TEST_PHONE,
        agent_number: SMS_FROM,
        agent_message: TEST_MESSAGE,
      },
      {
        headers: {
          'authorization': BLAND_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    console.log('');
    console.log('✅ SUCCESS! SMS sent successfully');
    console.log('');
    console.log('Response from Bland.ai:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('');
    console.log('========================================');
    console.log('Check your phone for the SMS!');
    console.log('========================================');

    process.exit(0);
  } catch (error) {
    console.log('');
    console.log('❌ ERROR! Failed to send SMS');
    console.log('');

    if (error.response) {
      console.log('Response status:', error.response.status);
      console.log('Response data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.log('No response received from Bland.ai');
      console.log('Error:', error.message);
    } else {
      console.log('Error:', error.message);
    }

    console.log('');
    console.log('Possible causes:');
    console.log('  1. Invalid API key');
    console.log('  2. Phone number not verified for SMS in Bland.ai');
    console.log('  3. Insufficient SMS credits in Bland.ai account');
    console.log('  4. Invalid phone number format');
    console.log('');

    process.exit(1);
  }
}

sendTestSMS();
