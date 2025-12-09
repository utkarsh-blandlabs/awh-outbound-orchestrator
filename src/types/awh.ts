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

  // Allow additional fields
  [key: string]: any;
}

/**
 * Payload to send to Bland for outbound call
 * Based on Bland API: POST /v1/calls
 * Matching Zapier configuration
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
  amd?: boolean; // Answering machine detection
  answered_by_enabled?: boolean;
  wait_for_greeting?: boolean;
  block_interruptions?: boolean;
  record?: boolean;
  wait?: boolean;
  language?: string;

  // First sentence
  first_sentence?: string;

  // Voicemail settings
  voicemail_message?: string;
  voicemail_action?: "leave_message" | "hangup";
  sensitive_voicemail_detection?: boolean;

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
 * Complete Convoso status codes mapping
 * Maps Bland.ai call outcomes to Convoso status abbreviations
 *
 * IMPORTANT: Convoso requires ONLY the abbreviation, not the description
 *
 * HUMAN Contact Types (Agent-related outcomes):
 */
export const CONVOSO_STATUS_MAP: Record<string, string> = {
  // === HUMAN CONTACT TYPES ===
  // Sales and Transfers
  "sale": "SALE",
  "sold": "SALE",
  "transferred": "CALLXR",
  "transfer": "CALLXR",
  "aca_transfer": "ACA",
  "aca": "ACA",
  "front_transfer": "FRONT",
  "front_handoff": "FRONT",
  "spanish_transfer": "SPA",
  "spanish": "SPA",
  "customer_service": "TCR",

  // Call Status
  "voicemail": "A",
  "answering_machine": "A",
  "machine": "A",
  "callback": "CALLBK",
  "call_back": "CALLBK",
  "requested_callback": "CB",
  "not_interested": "NI",
  "ni": "NI",
  "interested": "INST",
  "qualified_no_sale": "QNSALE",
  "confused": "CC",
  "confused_caller": "CC",

  // Availability
  "not_available": "NOTA",
  "post_date": "POST",
  "requested_form": "1095A",
  "form_request": "1095A",

  // Negative Outcomes
  "bad_state": "BACA",
  "cannot_afford": "CA",
  "no_coverage": "NOTCOV",
  "declined_sale": "PIKER",
  "piker": "PIKER",
  "wrong_number": "WRONG",
  "bad_phone": "BPN",
  "bad_phone_number": "BPN",
  "disqualified": "MGMTNQ",

  // Inquiries
  "medicaid": "MCAID",
  "medicare": "MCARE",
  "medicare_tricare": "TRICAR",
  "id_request": "REQID",

  // === SYSTEM CONTACT TYPES ===
  "no_answer": "NOANSR",
  "busy": "UB",
  "system_busy": "B",
  "hang_up": "HU",
  "hangup": "HU",
  "caller_hung_up": "CALLHU",
  "customer_disconnected": "CD",
  "disconnected": "CD",
  "dead_air": "DEADAR",
  "language_barrier": "LB",
  "congestion": "CG",
  "disconnected_number": "DC",
  "do_not_call": "DNC",
  "dnc": "DNC",
  "agent_not_available": "DROP",
  "agent_lost_connection": "ERI",
  "call_done": "DONE",
  "call_rejected": "REJ",
  "operator_intercept": "OI",
  "pbx_hung_up": "PBXHU",
  "call_picked_up": "PU",
  "incomplete": "INCOMP",
  "new_lead": "NEW",
  "failed": "N", // Dead Air/System Glitch

  // Default fallback
  "unknown": "UNKNWN",
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
 */
export interface ConvosoCallLogRequest {
  auth_token: string;
  phone_number: string;
  lead_id: string;
  call_transcript?: string;
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
