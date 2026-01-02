import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";
import { retry, isRetryableHttpError } from "../utils/retry";
import { BlandTranscript, CONVOSO_STATUS_MAP } from "../types/awh";

class ConvosoService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.convoso.baseUrl,
      timeout: 30000,
    });
  }

  private mapOutcomeToConvosoStatus(outcome: string): string {
    const normalizedOutcome = outcome.toLowerCase().replace(/[_\s-]/g, "_");

    if (CONVOSO_STATUS_MAP[normalizedOutcome]) {
      return CONVOSO_STATUS_MAP[normalizedOutcome];
    }

    if (
      normalizedOutcome.includes("do_not_call_again") ||
      normalizedOutcome.includes("never_call") ||
      normalizedOutcome.includes("remove_from_list") ||
      normalizedOutcome.includes("stop_calling")
    )
      return "DNCA";

    if (normalizedOutcome.includes("transfer")) return "ACA";
    if (
      normalizedOutcome.includes("voicemail") ||
      normalizedOutcome.includes("machine")
    )
      return "A";
    if (
      normalizedOutcome.includes("callback") ||
      normalizedOutcome.includes("call_back")
    )
      return "CB";
    if (normalizedOutcome.includes("sale")) return "SALE";
    if (
      normalizedOutcome.includes("piker") ||
      normalizedOutcome.includes("declined_sale")
    )
      return "PIKER";
    if (normalizedOutcome.includes("confus")) return "CD";
    if (
      normalizedOutcome.includes("not_interest") ||
      normalizedOutcome.includes("ni")
    )
      return "NI";
    if (
      normalizedOutcome.includes("no_answer") ||
      normalizedOutcome.includes("noanswer")
    )
      return "NA";
    if (normalizedOutcome.includes("busy")) return "B";
    if (
      normalizedOutcome.includes("hang") ||
      normalizedOutcome.includes("hangup")
    )
      return "CALLHU";
    if (normalizedOutcome.includes("disconnect")) return "DC";
    if (normalizedOutcome.includes("dead")) return "N";
    if (normalizedOutcome.includes("wrong")) return "WRONG";
    if (normalizedOutcome.includes("bad_phone")) return "BPN";

    logger.warn("Unknown outcome, defaulting to N", { outcome });
    return "N";
  }

  async updateCallLog(
    leadId: string,
    listId: string,
    phoneNumber: string,
    transcript: BlandTranscript
  ): Promise<void> {
    const convosoStatus = this.mapOutcomeToConvosoStatus(transcript.outcome);
    const convosoPhone = phoneNumber.replace(/^\+1/, "");
    const callTranscript = this.formatTranscriptForConvoso(
      transcript,
      convosoStatus
    );

    logger.info("Updating Convoso lead", {
      lead_id: leadId,
      list_id: listId,
      phone: convosoPhone,
      outcome: transcript.outcome,
      status: convosoStatus,
      duration: transcript.duration,
    });

    const requestData: any = {
      auth_token: config.convoso.authToken,
      lead_id: leadId,
      list_id: listId,
      call_transcript: callTranscript,
      status: convosoStatus,
    };

    // Add all available data from transcript
    if (transcript.plan_type) requestData.plan_type = transcript.plan_type;
    if (transcript.member_count)
      requestData.member_count = transcript.member_count;
    if (transcript.zip) requestData.postal_code = transcript.zip;
    if (transcript.state) requestData.state = transcript.state;
    if (transcript.customer_state)
      requestData.state = transcript.customer_state;
    if (transcript.duration) requestData.call_duration = transcript.duration;
    if (transcript.answered_by)
      requestData.answered_by = transcript.answered_by;
    if (transcript.customer_age) requestData.age = transcript.customer_age;
    if (transcript.postal_code)
      requestData.postal_code = transcript.postal_code;
    if (transcript.first_name) requestData.first_name = transcript.first_name;
    if (transcript.last_name) requestData.last_name = transcript.last_name;
    if (transcript.summary) requestData.call_summary = transcript.summary;
    if (transcript.call_ended_by)
      requestData.call_ended_by = transcript.call_ended_by;
    if (transcript.transferred_to)
      requestData.transferred_to = transcript.transferred_to;
    if (transcript.recording_url)
      requestData.recording_url = transcript.recording_url;
    if (convosoPhone) requestData.phone_number = convosoPhone;
    //  Convoso => automation script => Bland.ai (payload and a url to come back) => automation script (webhook to get call logs details) => Filter it => update convoso
    try {
      const response = await retry(
        async () => {
          const result = await this.client.post("/v1/leads/update", null, {
            params: requestData,
          });
          return result.data;
        },
        {
          maxAttempts: config.retry.maxAttempts,
          shouldRetry: isRetryableHttpError,
        }
      );

      if (response.success === false) {
        throw new Error(response.text || `Convoso API error: ${response.code}`);
      }

      logger.info("Lead updated successfully", {
        lead_id: leadId,
        status: convosoStatus,
      });
    } catch (error: any) {
      logger.error("Failed to update lead", {
        error: error.message,
        lead_id: leadId,
        status: convosoStatus,
        response: error.response?.data,
      });
      throw new Error(`Convoso update failed: ${error.message}`);
    }
  }

  /**
   * Check if a lead should be skipped based on current Convoso status
   * Returns true if lead has already been successfully processed (TRANSFERRED, SALE, etc.)
   * This prevents calling leads that were contacted through other channels
   */
  async shouldSkipLead(
    phoneNumber: string,
    successStatuses: string[] = ["ACA", "SALE", "TRANSFERRED"]
  ): Promise<{ skip: boolean; reason?: string; status?: string }> {
    try {
      const convosoPhone = phoneNumber.replace(/^\+1/, "");

      logger.debug("Checking lead status in Convoso before dialing", {
        phone: convosoPhone,
      });

      const requestData = {
        auth_token: config.convoso.authToken,
        phone_number: convosoPhone,
      };

      const response = await retry(
        async () => {
          const result = await this.client.post("/v1/leads/search", null, {
            params: requestData,
          });
          return result.data;
        },
        {
          maxAttempts: 2, // Quick check, don't retry too much
          shouldRetry: isRetryableHttpError,
        }
      );

      if (response.success && response.data?.entries?.length > 0) {
        const leads = response.data.entries;

        // Check if any lead has a success status
        const successLead = leads.find((l: any) =>
          successStatuses.includes(l.status?.toUpperCase())
        );

        if (successLead) {
          logger.info("Lead already processed successfully in Convoso - skipping call", {
            phone: convosoPhone,
            status: successLead.status,
            lead_id: successLead.lead_id || successLead.id,
          });

          return {
            skip: true,
            reason: `Lead already has status: ${successLead.status}`,
            status: successLead.status,
          };
        }
      }

      // No success status found or lead not found - proceed with call
      return { skip: false };
    } catch (error: any) {
      logger.warn("Failed to check lead status in Convoso - proceeding with call", {
        error: error.message,
        phone: phoneNumber,
      });
      // On error, don't skip - better to attempt the call than miss it
      return { skip: false };
    }
  }

  /**
   * Lookup lead by phone number in Convoso
   * Used for inbound calls where we don't have lead_id cached
   */
  async lookupLeadByPhone(phoneNumber: string): Promise<{
    lead_id: string;
    list_id: string;
    first_name?: string;
    last_name?: string;
    state?: string;
  } | null> {
    try {
      const convosoPhone = phoneNumber.replace(/^\+1/, "");

      logger.info("Looking up lead by phone in Convoso", {
        phone: convosoPhone,
      });

      const requestData = {
        auth_token: config.convoso.authToken,
        phone_number: convosoPhone,
      };

      const response = await retry(
        async () => {
          const result = await this.client.post("/v1/leads/search", null, {
            params: requestData,
          });
          return result.data;
        },
        {
          maxAttempts: config.retry.maxAttempts,
          shouldRetry: isRetryableHttpError,
        }
      );

      if (response.success && response.data?.entries?.length > 0) {
        const leads = response.data.entries;

        logger.info("Lead(s) found in Convoso", {
          total_leads: leads.length,
          phone: convosoPhone,
          lead_ids: leads.map((l: any) => l.lead_id).join(", "),
        });

        // Priority 1: Return first non-DNC lead (we want to update it with DNC)
        const nonDncLead = leads.find((l: any) => l.status !== "DNC");
        if (nonDncLead) {
          logger.info("Using non-DNC lead for update", {
            lead_id: nonDncLead.lead_id || nonDncLead.id,
            list_id: nonDncLead.list_id,
            current_status: nonDncLead.status,
          });

          return {
            lead_id: nonDncLead.lead_id || nonDncLead.id,
            list_id: nonDncLead.list_id,
            first_name: nonDncLead.first_name,
            last_name: nonDncLead.last_name,
            state: nonDncLead.state,
          };
        }

        // Priority 2: If all are DNC, return the first one (already DNC'd)
        const firstLead = leads[0];
        logger.info("All leads already DNC, using first", {
          lead_id: firstLead.lead_id || firstLead.id,
          list_id: firstLead.list_id,
          status: firstLead.status,
        });

        return {
          lead_id: firstLead.lead_id || firstLead.id,
          list_id: firstLead.list_id,
          first_name: firstLead.first_name,
          last_name: firstLead.last_name,
          state: firstLead.state,
        };
      }

      logger.warn("No lead found for phone number", {
        phone: convosoPhone,
      });

      return null;
    } catch (error: any) {
      logger.error("Failed to lookup lead by phone", {
        error: error.message,
        phone: phoneNumber,
        response: error.response?.data,
      });
      // Return null instead of throwing - we'll handle missing lead gracefully
      return null;
    }
  }

  private formatTranscriptForConvoso(
    transcript: BlandTranscript,
    convosoStatus: string
  ): string {
    const parts: string[] = [];

    parts.push(`Status: ${convosoStatus}`);
    parts.push(`Outcome: ${transcript.outcome}`);

    if (transcript.plan_type) parts.push(`Plan: ${transcript.plan_type}`);
    if (transcript.member_count)
      parts.push(`Members: ${transcript.member_count}`);
    if (transcript.zip) parts.push(`ZIP: ${transcript.zip}`);
    if (transcript.state) parts.push(`State: ${transcript.state}`);
    if (transcript.duration) parts.push(`Duration: ${transcript.duration}s`);

    parts.push(`\n--- Transcript ---\n${transcript.transcript}`);

    return parts.join("\n");
  }
}

export const convosoService = new ConvosoService();
