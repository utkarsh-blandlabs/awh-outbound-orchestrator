# SMS Automation - TODO & Questions

**Created:** December 30, 2024
**Scope:** 4 SMS messages over 7 days for non-answering leads
**Timeline:** 2 weeks
**Cost:** $1,000

---

## 📋 QUESTIONS TO ASK (BLOCKING)

### 1. Business Hours for SMS
**Question:** Should SMS only be sent during business hours (11 AM - 8 PM EST) or anytime 8 AM - 9 PM in the user's local timezone?

**Options:**
- A) Business hours only (11 AM - 8 PM EST) - More restrictive
- B) TCPA compliant hours (8 AM - 9 PM user's local time) - More flexible

**Recommendation:** **Option B** (8 AM - 9 PM user's timezone)

**Decision:** `[ ]` Pending

---

### 2. Convoso Logging for SMS Events
**Question:** Should all SMS events be logged in Convoso as notes/activities?

**What would be logged:**
- SMS sent: "SMS 1/4 sent: 2024-12-30 10:00 AM"
- SMS delivered: "SMS 1/4 delivered: 2024-12-30 10:00:15 AM"
- SMS reply: "SMS reply: YES - Added to callback queue"
- SMS opt-out: "SMS reply: STOP - Added to DNC blocklist"

**Benefits:**
- ✅ Full audit trail in Convoso
- ✅ Sales team can see SMS history
- ✅ Better lead tracking
- ✅ Compliance documentation

**Costs:**
- ❌ More API calls to Convoso
- ❌ Slightly slower processing

**Recommendation:** **YES** - Log all SMS events

**Decision:** `[ ]` Pending

---

### 3. Lead Status Updates from SMS Replies
**Question:** Should SMS replies automatically update lead status in Convoso?

**Proposed mapping:**
- "STOP" → Status: `DNC` (Do Not Call) + permanent blocklist
- "YES" → Status: `CB` (Callback) + add to redial queue immediately
- "NO" → Status: `NI` (Not Interested) + permanent blocklist
- "LATER" → Status: `CB` (Callback) + schedule for tomorrow
- No reply after 4 SMS → Status: ??? (see question 4)

**Recommendation:** **YES** - Auto-update status for STOP and YES

**Decision:** `[ ]` Pending

---

### 4. No Reply After 4 SMS - What Status?
**Question:** If lead doesn't reply to any of the 4 SMS messages, what should their status be?

**Options:**
- A) Leave unchanged (keep current status)
- B) Mark as `NI` (Not Interested)
- C) Mark as `CD` (Confused/Dead)
- D) Custom status: `SMS_NO_RESPONSE`

**Recommendation:** **Option A** (Leave unchanged) - They might still call back later

**Decision:** `[ ]` Pending

---

### 5. Non-Standard SMS Replies
**Question:** How to handle non-standard replies like "later", "busy", "call me tomorrow", "maybe"?

**Options:**
- A) Ignore completely (only recognize STOP, YES, NO)
- B) Add "LATER" as recognized keyword → Schedule callback for next day
- C) Log all replies to Convoso but don't act on non-standard ones

**Recommendation:** **Option C** - Log everything, only act on STOP/YES/NO

**Decision:** `[ ]` Pending

---

### 6. SMS Script Templates
**Question:** Do we have the final SMS scripts or should we use placeholder templates?

**Status:** You mentioned scripts exist - **Please provide:**
- SMS 1 template (Day 0 - immediate after voicemail)
- SMS 2 template (Day 1)
- SMS 3 template (Day 3)
- SMS 4 template (Day 7)

**Requirements:**
- Must include opt-out language ("Reply STOP to opt out")
- Should include {{first_name}} placeholder
- Should be under 160 characters per SMS (or max 320 for 2-part)

**Decision:** `[ ]` Pending - Waiting for scripts

---

### 7. SMS Sequence Trigger
**Question:** What triggers the SMS sequence to start?

**Options:**
- A) Only VOICEMAIL outcomes
- B) VOICEMAIL + NO_ANSWER outcomes
- C) Any non-successful outcome (VOICEMAIL, NO_ANSWER, BUSY, CONFUSED)
- D) Manual trigger via API

**Recommendation:** **Option B** (VOICEMAIL + NO_ANSWER) - Most common non-answers

**Decision:** `[ ]` Pending

---

### 8. SMS Sequence Pause/Resume
**Question:** If lead answers a call in the middle of SMS sequence, what happens?

**Scenario:**
- Day 0: Call → Voicemail → SMS 1 sent
- Day 1: SMS 2 sent
- Day 2: Lead answers call, talks to Ashley, gets transferred
- Day 3: SMS 3 scheduled - should it still be sent?

**Options:**
- A) Cancel sequence on successful call (TRANSFERRED, SALE, CALLBACK)
- B) Cancel sequence on any answered call (even CONFUSED)
- C) Continue sequence regardless

**Recommendation:** **Option A** - Cancel on successful outcomes only

**Decision:** `[ ]` Pending

---

### 9. Timezone Detection
**Question:** How do we determine the lead's timezone?

**Options:**
- A) Use state → timezone mapping (PA → EST, CA → PST, etc.)
- B) Use zip code → timezone mapping (more accurate)
- C) Use Convoso field if available
- D) Default to EST if unknown

**Recommendation:** **Option B** (Zip code) with fallback to state, then EST

**Decision:** `[ ]` Pending

---

### 10. Weekend Rescheduling
**Question:** If SMS is scheduled for Saturday/Sunday, when should it be sent?

**Options:**
- A) Next Monday at same time
- B) Next business day (skip holidays too)
- C) Skip that SMS entirely

**Recommendation:** **Option B** - Reschedule to next business day

**Decision:** `[ ]` Pending

---

## 🏗️ IMPLEMENTATION TASKS

### Phase 1: MongoDB Integration (Week 1)
- [ ] **Task 1.1:** Install MongoDB driver and create connection service
- [ ] **Task 1.2:** Design MongoDB schemas (collections)
- [ ] **Task 1.3:** Create database service with connection pooling
- [ ] **Task 1.4:** Add indexes for efficient queries
- [ ] **Task 1.5:** Implement batch write operations
- [ ] **Task 1.6:** Add MongoDB health check to admin API

**Estimated Time:** 2 days

---

### Phase 2: SMS Sequence Core (Week 1)
- [ ] **Task 2.1:** Create `smsSequenceService.ts`
  - Track sequence position per lead
  - Handle progression logic (Day 0 → 1 → 3 → 7)
  - Store in MongoDB for long-term tracking
- [ ] **Task 2.2:** Create `data/sms-sequence-config.json`
  - Sequence cadence configuration
  - TCPA compliance settings
  - Opt-out keywords list
- [ ] **Task 2.3:** Create `data/sms-templates.json`
  - 4 SMS message templates
  - Include {{first_name}} placeholder
  - Include opt-out language
- [ ] **Task 2.4:** Update `smsTrackerService.ts`
  - Add sequence tracking
  - Add reply tracking
  - Keep daily count tracking (existing)

**Estimated Time:** 3 days

---

### Phase 3: TCPA Compliance (Week 1)
- [ ] **Task 3.1:** Create `utils/timezoneHelper.ts`
  - Zip code → timezone mapping
  - State → timezone fallback
  - EST default
- [ ] **Task 3.2:** Create `utils/tcpaChecker.ts`
  - Weekend detection (skip Sat/Sun)
  - Business hours check (8 AM - 9 PM)
  - Holiday detection (use existing scheduler blackout dates)
  - Reschedule logic for non-compliant times
- [ ] **Task 3.3:** Add unit tests for TCPA compliance

**Estimated Time:** 2 days

---

### Phase 4: SMS Scheduler (Week 2)
- [ ] **Task 4.1:** Create `smsSchedulerService.ts`
  - Run every 5 minutes (like redial queue)
  - Query MongoDB for leads needing next SMS
  - Check TCPA compliance
  - Send SMS via Bland AI API
  - Update sequence tracker
  - Log to MongoDB
- [ ] **Task 4.2:** Integrate with existing call outcomes
  - Hook into VOICEMAIL outcome → start sequence
  - Hook into NO_ANSWER outcome → start sequence
  - Hook into TRANSFERRED/SALE → cancel sequence
- [ ] **Task 4.3:** Add SMS scheduler to main server startup

**Estimated Time:** 2 days

---

### Phase 5: SMS Reply Handler (Week 2)
- [ ] **Task 5.1:** Create `routes/smsWebhook.ts`
  - Handle inbound SMS from Bland AI
  - Parse reply text
  - Detect STOP keywords → add to blocklist
  - Detect YES → add to callback queue
  - Log all replies to MongoDB
- [ ] **Task 5.2:** Integrate with blocklist service
  - STOP → permanent blocklist
  - Update Convoso with DNC status
- [ ] **Task 5.3:** Integrate with redial queue
  - YES → immediate callback (priority)
  - LATER → schedule for tomorrow
- [ ] **Task 5.4:** Add Convoso logging for SMS events
  - Log SMS sent
  - Log SMS replies
  - Update lead notes

**Estimated Time:** 2 days

---

### Phase 6: Testing & QA (Week 2)
- [ ] **Task 6.1:** Test TCPA compliance
  - Weekend skipping
  - 8 AM - 9 PM enforcement
  - Timezone handling (EST, PST, CST, MST)
  - Holiday skipping
- [ ] **Task 6.2:** Test opt-out flow
  - STOP → blocklist
  - Verify no more SMS
  - Verify no more calls
  - Convoso update
- [ ] **Task 6.3:** Test sequence progression
  - Day 0, 1, 3, 7 timing
  - Verify correct templates sent
  - Verify sequence stops on success
- [ ] **Task 6.4:** Test SMS replies
  - STOP, YES, NO handling
  - Non-standard reply logging
  - Convoso updates
- [ ] **Task 6.5:** Load testing
  - 1,000 leads in sequence
  - MongoDB performance
  - Memory usage
  - No memory leaks
- [ ] **Task 6.6:** Integration testing
  - End-to-end: Call → Voicemail → SMS sequence → Reply → Action

**Estimated Time:** 3 days

---

### Phase 7: Monitoring & Admin API (Week 2)
- [ ] **Task 7.1:** Add SMS sequence admin endpoints
  - `GET /api/admin/sms/sequences` - View all active sequences
  - `GET /api/admin/sms/sequences/:lead_id` - View specific sequence
  - `POST /api/admin/sms/sequences/:lead_id/cancel` - Cancel sequence
  - `GET /api/admin/sms/stats` - Statistics
- [ ] **Task 7.2:** Add MongoDB monitoring
  - Connection status
  - Collection sizes
  - Query performance
  - Memory usage
- [ ] **Task 7.3:** Add logging and alerts
  - SMS send failures
  - MongoDB connection issues
  - TCPA compliance violations
  - Opt-out processing

**Estimated Time:** 2 days

---

## 📊 MONGODB INTEGRATION STRATEGY

### Collections Design

#### 1. `sms_sequences` Collection
**Purpose:** Track SMS sequence progress per lead

```javascript
{
  _id: ObjectId("..."),
  lead_id: "7943423",
  phone_number: "2673701787",
  list_id: "12165",
  first_name: "John",
  last_name: "Smith",
  state: "PA",
  timezone: "America/New_York",

  sequence_started_at: ISODate("2024-12-30T10:00:00Z"),
  current_position: 2,  // 0, 1, 2, 3, 4 (4 = completed)
  status: "ACTIVE",  // ACTIVE, COMPLETED, CANCELLED, OPTED_OUT

  messages: [
    {
      position: 1,
      template_id: "sms_1",
      scheduled_for: ISODate("2024-12-30T10:00:00Z"),
      sent_at: ISODate("2024-12-30T10:00:15Z"),
      sms_id: "bland_sms_123",
      delivered: true,
      delivery_status: "delivered",
      error: null
    },
    {
      position: 2,
      template_id: "sms_2",
      scheduled_for: ISODate("2024-12-31T10:00:00Z"),
      sent_at: ISODate("2024-12-31T10:00:20Z"),
      sms_id: "bland_sms_124",
      delivered: true,
      delivery_status: "delivered",
      reply: "YES",
      reply_at: ISODate("2024-12-31T10:15:00Z")
    }
  ],

  completed_at: null,
  cancelled_at: null,
  cancelled_reason: null,

  created_at: ISODate("2024-12-30T10:00:00Z"),
  updated_at: ISODate("2024-12-31T10:15:00Z")
}
```

**Indexes:**
```javascript
db.sms_sequences.createIndex({ lead_id: 1 })
db.sms_sequences.createIndex({ phone_number: 1 })
db.sms_sequences.createIndex({ status: 1, current_position: 1 })
db.sms_sequences.createIndex({ "messages.scheduled_for": 1 })
```

---

#### 2. `sms_replies` Collection
**Purpose:** Track all SMS replies for analytics

```javascript
{
  _id: ObjectId("..."),
  phone_number: "2673701787",
  lead_id: "7943423",
  reply_text: "YES",
  reply_type: "POSITIVE",  // POSITIVE, NEGATIVE, OPT_OUT, UNKNOWN
  received_at: ISODate("2024-12-31T10:15:00Z"),
  sequence_position: 2,  // Which SMS they replied to
  action_taken: "ADDED_TO_CALLBACK_QUEUE",
  convoso_logged: true,
  created_at: ISODate("2024-12-31T10:15:00Z")
}
```

**Indexes:**
```javascript
db.sms_replies.createIndex({ phone_number: 1, received_at: -1 })
db.sms_replies.createIndex({ lead_id: 1 })
db.sms_replies.createIndex({ reply_type: 1 })
```

---

#### 3. `sms_opt_outs` Collection
**Purpose:** Permanent opt-out list (faster than blocklist lookup)

```javascript
{
  _id: ObjectId("..."),
  phone_number: "2673701787",
  lead_id: "7943423",
  opted_out_at: ISODate("2024-12-31T10:15:00Z"),
  opt_out_message: "STOP",
  source: "SMS_REPLY",  // SMS_REPLY, VOICE_CALL, MANUAL
  blocklist_flag_id: "flag_123",
  convoso_updated: true,
  created_at: ISODate("2024-12-31T10:15:00Z")
}
```

**Indexes:**
```javascript
db.sms_opt_outs.createIndex({ phone_number: 1 }, { unique: true })
db.sms_opt_outs.createIndex({ opted_out_at: -1 })
```

---

#### 4. `sms_daily_stats` Collection
**Purpose:** Daily aggregated statistics (for reporting)

```javascript
{
  _id: ObjectId("..."),
  date: "2024-12-30",

  sequences_started: 150,
  sequences_completed: 50,
  sequences_cancelled: 20,

  sms_sent: {
    position_1: 150,
    position_2: 120,
    position_3: 80,
    position_4: 50,
    total: 400
  },

  sms_delivered: 395,
  sms_failed: 5,

  replies: {
    total: 75,
    stop: 20,
    yes: 30,
    no: 10,
    other: 15
  },

  opt_outs: 20,
  callbacks_triggered: 30,

  tcpa_violations_prevented: 45,  // Weekend/time blocks

  created_at: ISODate("2024-12-30T23:59:59Z"),
  updated_at: ISODate("2024-12-30T23:59:59Z")
}
```

**Indexes:**
```javascript
db.sms_daily_stats.createIndex({ date: -1 }, { unique: true })
```

---

### MongoDB Usage Strategy (Free Tier Optimization)

#### When to Use MongoDB:
✅ **Use MongoDB for:**
1. SMS sequence tracking (grows over time, needs history)
2. SMS replies (permanent audit log)
3. Opt-out records (permanent, needs fast lookup)
4. Daily statistics (aggregated reporting)
5. Historical analytics (trends over weeks/months)

❌ **Keep in JSON for:**
1. Configuration files (rarely changes)
2. Current day call tracking (fast local access)
3. Cache/temp data (cleared frequently)
4. Active call state (in-memory)

#### Write Strategy (Avoid Overload):
- **Batch writes at EOD:** Aggregate daily stats once per day (midnight EST)
- **Immediate writes for:**
  - SMS sequence start (1 write per voicemail)
  - SMS sent (update, not insert - 1 write per SMS)
  - SMS reply (1 write per reply)
  - Opt-out (1 write, critical for compliance)
- **Connection pooling:** Single connection instance, reuse across requests
- **Indexes:** Only on frequently queried fields
- **TTL indexes:** Auto-delete old data (>90 days) to save space

#### Read Strategy (Minimize Queries):
- **Cache in memory:** Active sequences loaded at startup
- **Bulk reads:** Fetch all pending sequences once per scheduler run (every 5 min)
- **Lazy loading:** Only query MongoDB when needed (not every request)
- **Projection:** Only fetch required fields, not entire documents

#### Free Tier Limits:
- **Storage:** 512 MB
- **Estimate:** 1 SMS sequence = ~2 KB → Can store 250,000 sequences
- **Current scale:** ~500 sequences/day → 500 days of data fits in free tier
- **Auto-cleanup:** Delete sequences older than 90 days (configurable)

---

## 📈 SUCCESS METRICS

### KPIs to Track:
1. **SMS Delivery Rate:** % of SMS successfully delivered
2. **Reply Rate:** % of leads who reply to SMS
3. **Opt-Out Rate:** % of leads who opt out
4. **Callback Conversion:** % of YES replies → actual calls
5. **Sequence Completion:** % of leads who get all 4 SMS
6. **TCPA Compliance:** 100% - no violations
7. **MongoDB Performance:** Query times <100ms
8. **System Memory:** No leaks, stable usage

**Target Goals:**
- Delivery rate: >95%
- Reply rate: >10%
- Opt-out rate: <5%
- TCPA compliance: 100%

---

## 🚀 DEPLOYMENT CHECKLIST

### Pre-Deployment:
- [ ] All questions answered
- [ ] SMS scripts provided
- [ ] MongoDB connection tested
- [ ] All tests passing
- [ ] Load testing completed
- [ ] Memory leak testing completed
- [ ] Documentation updated

### Deployment:
- [ ] Deploy to staging
- [ ] Test end-to-end in staging
- [ ] Deploy to production
- [ ] Monitor for 24 hours
- [ ] Verify first SMS sequence works
- [ ] Verify opt-out works
- [ ] Check MongoDB metrics

### Post-Deployment:
- [ ] Daily monitoring for 1 week
- [ ] Gather metrics
- [ ] Report to team
- [ ] Iterate based on feedback

---

## 📝 NOTES

### Dependencies:
- Bland AI SMS API (assumed available)
- MongoDB Atlas free tier
- Existing services: blocklist, redial queue, Convoso integration

### Risks:
1. **MongoDB free tier limits** - Mitigated by auto-cleanup and efficient storage
2. **TCPA violations** - Mitigated by comprehensive timezone/time checks
3. **Opt-out compliance** - Mitigated by immediate blocklist updates
4. **Memory leaks** - Mitigated by connection pooling and proper cleanup

### Future Enhancements (Out of Scope):
- AI-driven dynamic SMS responses
- A/B testing of SMS templates
- Sentiment analysis of replies
- Predictive sending (ML-based optimal times)
- Multi-language support

---

**Created:** December 30, 2024
**Last Updated:** December 30, 2024
**Status:** 🟡 Waiting for answers to questions
**Next Step:** Answer blocking questions, then begin Phase 1 implementation
