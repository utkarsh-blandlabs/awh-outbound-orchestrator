// ============================================================================
// Report Analysis Types
// ============================================================================

/**
 * Raw call data from Bland API
 */
export interface CallData {
  call_id: string;
  to_number?: string;
  from_number?: string;
  concatenated_transcript?: string;
  status?: string;               // "completed", "failed", etc.
  answered_by?: string;           // "human", "voicemail", "machine", "no-answer", "busy"
  call_length?: number;           // Duration in seconds
  corrected_duration?: number;    // Fallback duration
  error_message?: string;
  pathway_tags?: any[];
  warm_transfer_call?: {
    state?: string;               // "MERGED" = successful transfer
    [key: string]: any;
  };
  variables?: Record<string, any>;
  summary?: string;
  inbound?: boolean;
  created_at?: string;
}

/**
 * Call categories
 */
export type CallCategory =
  | 'failed'
  | 'voicemail'
  | 'busy'
  | 'no_answer'
  | 'callback'
  | 'transferred'
  | 'not_interested'
  | 'human_answered';

/**
 * Result of analyzing a single call
 */
export interface AnalysisResult {
  call_id: string;
  category: CallCategory;
  confidence: 'high' | 'medium' | 'low';
  detection_method: 'transcript' | 'fallback' | 'derived';
  reason?: string;
  transcript_snippet?: string;
  duration?: number;
  phone_number?: string;
}

/**
 * Categorizer function signature
 */
export interface Categorizer {
  name: CallCategory;
  priority: number;
  analyze: (call: CallData, config: CategorizerConfig) => CategorizerResult | null;
}

/**
 * Result from a single categorizer
 */
export interface CategorizerResult {
  category: CallCategory;
  confidence: 'high' | 'medium' | 'low';
  detection_method: 'transcript' | 'fallback' | 'derived';
  reason: string;
}

/**
 * Per-categorizer config (overridable per client)
 */
export interface CategorizerConfig {
  voicemail?: {
    extraPatterns?: string[];            // Extra regex patterns (as strings)
    monologueThresholdSec?: number;      // Default 15
    minMonologueHellos?: number;         // Default 2
  };
  humanAnswered?: {
    minTranscriptLength?: number;        // Default 50
    minDurationSec?: number;             // Default 20
  };
  transferred?: {
    requireMergedState?: boolean;        // Default true
  };
  busy?: {
    extraPatterns?: string[];
  };
  callback?: {
    extraPatterns?: string[];
  };
  failed?: Record<string, never>;
  notInterested?: {
    extraPatterns?: string[];
  };
  noAnswer?: {
    maxDurationSec?: number;             // Default 5
  };
}

/**
 * Full client configuration
 */
export interface ClientConfig {
  name: string;
  blandApiKey?: string;
  categorizers: CategorizerConfig;
}

/**
 * Aggregated stats from analysis
 */
export interface AnalysisStats {
  date: string;
  total_calls: number;
  completed_calls: number;
  failed_calls: number;
  answered_calls: number;
  transferred_calls: number;
  voicemail_calls: number;
  busy_calls: number;
  no_answer_calls: number;
  callback_requested_calls: number;
  not_interested_calls: number;
  // Rates
  connectivity_rate: number;
  transfer_rate: number;
  success_rate: number;
  voicemail_rate: number;
}

/**
 * Full report output
 */
export interface AnalysisReport {
  date: string;
  config_name: string;
  stats: AnalysisStats;
  calls: AnalysisResult[];
  category_breakdown: Record<CallCategory, AnalysisResult[]>;
  generated_at: string;
}
