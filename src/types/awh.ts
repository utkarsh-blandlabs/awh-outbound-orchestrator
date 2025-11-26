//  Incoming webhook payload from Convoso
export interface ConvosoWebhookPayload {
  first_name: string;
  last_name: string;
  phone: string;
  state: string;
  lead_id?: string;
  // TODO: Add other fields once we see the real payload (pending)
  [key: string]: any;
}

//  Payload to send to Bland for outbound call

export interface BlandOutboundCallRequest {
  phone_number: string;
  pathway_id: string;
  start_node_id?: string;
  from_number?: string;
  transfer_phone_number?: string;
  voicemail_message?: string;
  caller_id?: string;
  // TODO: Add other Bland-specific fields (penfing)
  [key: string]: any;
}

// Response from Bland after initiating call

export interface BlandOutboundCallResponse {
  call_id: string;
  status: string;
  // TODO: Add other response fields from Bland (pending)
  [key: string]: any;
}

// Call outcome/status from Bland transcript

export enum CallOutcome {
  TRANSFERRED = "TRANSFERRED",
  VOICEMAIL = "VOICEMAIL",
  CALLBACK = "CALLBACK",
  NO_ANSWER = "NO_ANSWER",
  BUSY = "BUSY",
  FAILED = "FAILED",
  UNKNOWN = "UNKNOWN",
}

// Parsed transcript data from Bland

export interface BlandTranscript {
  call_id: string;
  transcript: string;
  outcome: CallOutcome;
  plan_type?: "Individual" | "Family";
  member_count?: number;
  zip?: string;
  state?: string;
  duration?: number;
  // TODO: Add other transcript fields (pending)
  [key: string]: any;
}

// Convoso lead data

export interface ConvosoLead {
  lead_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  state?: string;
  status?: string;
  // TODO: Add other lead fields (pending)
  [key: string]: any;
}

// Request to log a call in Convoso

export interface ConvosoCallLogRequest {
  lead_id: string;
  call_id: string;
  phone_number: string;
  timestamp: string;
  // TODO: Add other call log fields (pending)
  [key: string]: any;
}

//  * Request to update Convoso lead after call

export interface ConvosoLeadUpdateRequest {
  lead_id: string;
  status?: string;
  disposition?: string;
  notes?: string;
  plan_type?: string;
  member_count?: number;
  zip?: string;
  state?: string;
  transcript?: string;
  // TODO: Add other update fields
  [key: string]: any;
}

//  Final orchestration result

export interface OrchestrationResult {
  success: boolean;
  lead_id: string;
  call_id: string;
  outcome: CallOutcome;
  error?: string;
  transcript?: BlandTranscript;
}

// Path logic types (A/B/C branching)

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
