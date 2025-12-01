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
 */
export interface BlandOutboundCallRequest {
  phone_number: string;
  pathway_id: string;
  start_node_id?: string;
  from_number?: string;
  transfer_phone_number?: string;
  voicemail_message?: string;
  caller_id?: string;
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
  NO_ANSWER = "NO_ANSWER",
  BUSY = "BUSY",
  FAILED = "FAILED",
  UNKNOWN = "UNKNOWN",
}

/**
 * Parsed transcript data from Bland
 */
export interface BlandTranscript {
  call_id: string;
  transcript: string;
  outcome: CallOutcome;
  plan_type?: "Individual" | "Family";
  member_count?: number;
  zip?: string;
  state?: string;
  duration?: number;
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
