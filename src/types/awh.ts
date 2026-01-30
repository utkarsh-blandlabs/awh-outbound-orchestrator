// ============================================================================
// AWH Type Definitions
// ============================================================================

/**
 * Incoming webhook payload from Convoso
 * Based on actual payload from Jeff (Nov 28, 2025)
 */
export interface ConvosoWebhookPayload {
  // Required fields
  first_name: string;
  last_name: string;
  phone_number: string;
  state: string;
  lead_id: string;
  list_id: string;
  status: string;

  // Optional fields
  email?: string;
  address1?: string;
  city?: string;
  postal_code?: string;
  date_of_birth?: string;
  age?: string;

  // Call log ID - sent by Convoso when they initiate the call
  // IMPORTANT: Required for updating call transcripts via /v1/log/update
  call_log_id?: string;

  // NEW: For Dec 22nd autonomous dialing
  call_attempts?: number; // How many times this lead has been called
  // status field above now also used for lead status (NEW, TRANSFERRED, SALE, etc.)

  // Allow additional fields
  [key: string]: any;
}

/**
 * Voicemail configuration for Bland API v1
 * Based on: https://docs.bland.ai/api-v1/post/calls
 */
export interface BlandVoicemailConfig {
  message: string;
  action: "leave_message" | "hangup";
  sensitive?: boolean;
  sms?: {
    to: string;
    from: string;
    message: string;
  };
}

/**
 * Payload to send to Bland for outbound call
 * Based on Bland API v1: POST /v1/calls
 * Documentation: https://docs.bland.ai/api-v1/post/calls
 */
export interface BlandOutboundCallRequest {
  phone_number: string;
  pathway_id?: string;
  task?: string;
  from?: string;
  transfer_phone_number?: string;
  start_node_id?: string;

  // Request data (key-value store for AI to access during call)
  // The pathway can access these values via {{key}} syntax
  request_data?: Record<string, any>;

  // Voice and behavior
  voice?: string;
  max_duration?: number;
  wait_for_greeting?: boolean;
  block_interruptions?: boolean;
  record?: boolean;
  wait?: boolean;
  language?: string;

  // First sentence
  first_sentence?: string;

  // Voicemail configuration (Bland API v1 format)
  voicemail?: BlandVoicemailConfig;

  // Webhook URL - Bland will POST to this URL when call completes
  webhook?: string;

  // Other options
  model?: "base" | "turbo";
  reduce_latency?: boolean;
  [key: string]: any;
}

/**
 * Response from Bland after initiating call
 */
export interface BlandOutboundCallResponse {
  call_id: string;
  status: string;
  from_number?: string; // Which pool number was used for this call
  [key: string]: any;
}

/**
 * Call outcome/status from Bland transcript
 */
export enum CallOutcome {
  TRANSFERRED = "TRANSFERRED",
  VOICEMAIL = "VOICEMAIL",
  CALLBACK = "CALLBACK",
  SALE = "SALE",
  CONFUSED = "CONFUSED",
  NOT_INTERESTED = "NOT_INTERESTED",
  NO_ANSWER = "NO_ANSWER",
  BUSY = "BUSY",
  FAILED = "FAILED",
}

/**
 * Complete Convoso status codes mapping (All 71 official codes)
 * Maps Bland.ai call outcomes to Convoso status abbreviations
 *
 * IMPORTANT: Convoso requires ONLY the abbreviation, not the description
 *
 * === Contact Type Categories ===
 *
 * HUMAN (27 codes): Call was answered by a human. AI had a conversation.
 *   - These represent outcomes from actual conversations with people
 *   - Examples: Sale, Not Interested, Callback Request, Transfer
 *
 * SYSTEM (44 codes): Technical/system outcomes. No human conversation.
 *   - These represent technical issues, no-answers, or system-level blocks
 *   - Examples: No Answer, Busy, DNC, Disconnected Number, Fax
 */
export const CONVOSO_STATUS_MAP: Record<string, string> = {
  // ============================================================================
  // HUMAN CONTACT TYPES (27 codes)
  // Call was answered by a human - AI had a conversation
  // ============================================================================

  // Sales and Successful Outcomes
  "sale": "SALE",                           // Sale
  "sold": "SALE",

  // Transfers
  "transferred": "ACA",                     // Transferred to ACA (default transfer)
  "transfer": "ACA",
  "aca_transfer": "ACA",                    // Transferred to ACA
  "aca": "ACA",
  "basaca": "BASACA",                       // Transfer to ACA (alternate)
  "front_transfer": "FRONT",                // Front Hand-off
  "front_handoff": "FRONT",
  "front_transfers": "FRNTRS",              // Front Transfers (plural)
  "spanish_transfer": "SPA",                // Transferred To Spanish
  "spanish": "SPA",
  "customer_service": "TCR",                // Transferred To Customer Service

  // Call Status and Requests
  "voicemail": "A",                         // Answering Machine
  "answering_machine": "A",
  "machine": "A",
  "callback": "CB",                         // Requested Callback
  "call_back": "CB",
  "requested_callback": "CB",
  "post_date": "POST",                      // Post Date
  "requested_form": "1095A",                // Requested 10-95A Form
  "form_request": "1095A",

  // Interest Levels
  "not_interested": "NI",                   // Not Interested
  "ni": "NI",
  "not_available": "NOTA",                  // Not Available

  // Negative Outcomes
  "bad_state": "BACA",                      // Bad State/Cannot Sell
  "cannot_sell": "BACA",
  "cannot_afford": "CA",                    // Cannot Afford
  "no_coverage": "NOTCOV",                  // Not Looking for Coverage
  "declined_sale": "PIKER",                 // Declined Sale - PIKER
  "piker": "PIKER",
  "wrong_number": "WRONG",                  // Wrong Number
  "bad_phone": "BPN",                       // Bad Phone Number
  "bad_phone_number": "BPN",
  "disqualified": "MGMTNQ",                 // Disqualified Lead
  "customer_disconnected": "CD",            // Customer Disconnected

  // Inquiries
  "medicaid": "MCAID",                      // Medicaid Inquiry
  "medicare": "MCARE",                      // Medicare Inquiry
  "medicare_tricare": "TRICAR",             // Medicare/Tricare
  "id_request": "REQID",                    // Requested ID Card Number

  // ============================================================================
  // SYSTEM CONTACT TYPES (44 codes)
  // Technical/system outcomes - No human conversation occurred
  // ============================================================================

  // No Answer / Call Not Connected
  "no_answer": "NA",                        // No Answer AutoDial
  "no_answer_inbound": "NAIC",              // No Answer Inbound Call
  "no_route": "NRA",                        // No Route Available
  "new_lead": "NEW",                        // New Lead

  // Busy / Hung Up
  "busy": "B",                              // System Busy
  "system_busy": "B",
  "caller_hung_up": "CALLHU",               // Caller Hung Up
  "pbx_hung_up": "PBXHU",                   // Call ended at PBX
  "answered_hung_up": "AH",                 // Answered & Hung-up

  // Disconnected / Network Issues
  "disconnected_number": "DC",              // Disconnected Number
  "disconnected": "DC",
  "network_out_of_order": "NORD",           // Network Out Of Order

  // Congestion
  "congestion": "CG",                       // Congestion
  "congestion_account_disconnected": "CGD", // Congestion Account Disconnected
  "congestion_out_of_minutes": "CGO",       // Congestion Out of Minutes
  "congested_temporarily": "CGT",           // Congested Temporarily

  // DNC (Do Not Call)
  "do_not_call": "DNC",                     // Do NOT Call
  "dnc": "DNC",
  "do_not_call_again": "DNCA",              // Do NOT Call Again (customer requested)
  "dnca": "DNCA",
  "never_call_again": "DNCA",               // Never call again (customer explicit request)
  "remove_from_list": "DNCA",               // Customer requested removal
  "dnc_campaign_match": "DNCC",             // A match for Campaign DNC settings
  "dnc_carrier_decline": "DNCDEC",          // DNC-Carrier Received Decline Request
  "dnc_hopper_match": "DNCL",               // Do NOT Call Hopper Match
  "dnc_lead_consent": "DNCLCC",             // Do NOT Call Lead Consent Concern
  "dnc_not_found": "DNCNFD",                // DNC-Carrier Reports Number Not Found
  "dnc_queue": "DNCQ",                      // Queue Set Call To DNC
  "dnc_realtime": "DNCRT",                  // Do NOT Call Real Time Match
  "dnc_wireless": "DNCW",                   // Do NOT Call Wireless Number

  // Answering Machine Detected
  "answering_machine_detected": "AA",       // Answering Machine Detected
  "answering_machine_message": "AM",        // Answering Machine Detected Message Left
  "queue_after_hours": "AHXFER",            // Queue After Hours Action Trigger

  // Agent Issues
  "agent_not_available": "DROP",            // Agent Not Available In Campaign
  "agent_lost_connection": "ERI",           // Agent Lost Connection
  "agent_force_logout": "LOGOUT",           // Agent Force Logout

  // Call Handling
  "call_done": "DONE",                      // Call Done
  "call_rejected": "REJ",                   // Call Rejected
  "call_picked_up": "PU",                   // Call Picked Up
  "incomplete": "INCOMP",                   // Incomplete Call
  "lead_in_call": "INCALL",                 // Lead In Call

  // Detection Systems
  "fas_detected": "FASD",                   // FAS Detected
  "fax": "AFAX",                            // CPD Fax
  "blocked_caller_id": "CIDB",              // Blocked Caller ID

  // PBX / Queue Operations
  "pbx_drop": "PXDROP",                     // Drop Call to PBX Application
  "queue_drop": "QDROP",                    // Drop Call to Another Queue
  "queue_drop_action": "WAITTO",            // Queue Drop Call Action Trigger
  "queue_abandoned": "XDROP",               // Call Abandoned In Queue
  "pre_routing_drop": "PDROP",              // Pre-Routing Drop

  // System Errors
  "dead_air": "N",                          // Dead Air/System Glitch
  "failed": "N",
  "operator_intercept": "OI",               // Operator Intercept
  "improper_logout": "IMPL",                // Improper Logout
  "forbidden": "FORBID",                    // Forbidden
}

/**
 * Parsed transcript data from Bland
 * Based on Bland API: GET /v1/calls/{call_id} response
 */
export interface BlandTranscript {
  call_id: string;
  transcript: string;
  outcome: CallOutcome;
  // Custom extracted variables
  plan_type?: "Individual" | "Family";
  member_count?: number;
  zip?: string;
  state?: string;
  duration?: number;
  // Additional Bland API fields
  summary?: string;
  answered_by?: string;
  call_ended_by?: string;
  completed?: boolean;
  status?: string;
  // Customer information from variables
  customer_age?: number;
  postal_code?: string;
  customer_state?: string;
  first_name?: string;
  last_name?: string;
  // Pathway information
  pathway_tags?: string[];
  // Transfer information
  transferred_to?: string;
  transferred_at?: string;
  // Recording
  recording_url?: string;
  // Warm transfer details
  warm_transfer_call?: any;
  // Error information (for failed calls)
  error_message?: string;
  [key: string]: any;
}

/**
 * Convoso lead data
 */
export interface ConvosoLead {
  lead_id: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  state?: string;
  city?: string;
  postal_code?: string;
  date_of_birth?: string;
  list_id?: string;
  status?: string;
  [key: string]: any;
}

/**
 * Request to insert/update a lead in Convoso
 * Based on /v1/leads/insert endpoint
 */
export interface ConvosoLeadInsertRequest {
  auth_token: string;
  list_id: string;
  phone_number: string;
  first_name: string;
  last_name: string;
  date_of_birth?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  lead_id?: string;
  status?: string;
  [key: string]: any;
}

/**
 * Request to log/update call in Convoso
 * Based on /v1/log/update endpoint
 *
 * IMPORTANT: According to Convoso support (Josh), required params are:
 * - auth_token
 * - call_log_id (NOT lead_id or phone_number!)
 *
 * This endpoint allows appending:
 * - call_transcript (appears in "Call Transcript" column)
 * - extra_field_01
 * - extra_field_02
 */
export interface ConvosoCallLogRequest {
  auth_token: string;
  call_log_id: string;  // REQUIRED: Convoso's internal call log ID
  call_transcript?: string;  // Appears in "Call Transcript" column in Convoso
  extra_field_01?: string;  // Can be used for additional data
  extra_field_02?: string;  // Can be used for metadata
  [key: string]: any;
}

/**
 * Final orchestration result
 */
export interface OrchestrationResult {
  success: boolean;
  lead_id: string;
  call_id: string;
  outcome: CallOutcome;
  error?: string;
  transcript?: BlandTranscript;
}

/**
 * Path logic types (A/B/C branching)
 */
export enum PathType {
  PATH_A = "PATH_A",
  PATH_B = "PATH_B",
  PATH_C = "PATH_C",
}

export interface PathResult {
  path: PathType;
  disposition: string;
  status: string;
  notes: string;
}
