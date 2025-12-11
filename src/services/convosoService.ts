import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";
import { retry, isRetryableHttpError } from "../utils/retry";
import {
  BlandTranscript,
  CONVOSO_STATUS_MAP,
} from "../types/awh";

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

    if (normalizedOutcome.includes("do_not_call_again") ||
        normalizedOutcome.includes("never_call") ||
        normalizedOutcome.includes("remove_from_list") ||
        normalizedOutcome.includes("stop_calling")) return "DNCA";

    if (normalizedOutcome.includes("transfer")) return "ACA";
    if (normalizedOutcome.includes("voicemail") || normalizedOutcome.includes("machine")) return "A";
    if (normalizedOutcome.includes("callback") || normalizedOutcome.includes("call_back")) return "CB";
    if (normalizedOutcome.includes("sale")) return "SALE";
    if (normalizedOutcome.includes("piker") || normalizedOutcome.includes("declined_sale")) return "PIKER";
    if (normalizedOutcome.includes("confus")) return "CD";
    if (normalizedOutcome.includes("not_interest") || normalizedOutcome.includes("ni")) return "NI";
    if (normalizedOutcome.includes("no_answer") || normalizedOutcome.includes("noanswer")) return "NA";
    if (normalizedOutcome.includes("busy")) return "B";
    if (normalizedOutcome.includes("hang") || normalizedOutcome.includes("hangup")) return "CALLHU";
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
    const callTranscript = this.formatTranscriptForConvoso(transcript, convosoStatus);

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
    if (transcript.member_count) requestData.member_count = transcript.member_count;
    if (transcript.zip) requestData.postal_code = transcript.zip;
    if (transcript.state) requestData.state = transcript.state;
    if (transcript.customer_state) requestData.state = transcript.customer_state;
    if (transcript.duration) requestData.call_duration = transcript.duration;
    if (transcript.answered_by) requestData.answered_by = transcript.answered_by;
    if (transcript.customer_age) requestData.age = transcript.customer_age;
    if (transcript.postal_code) requestData.postal_code = transcript.postal_code;
    if (transcript.first_name) requestData.first_name = transcript.first_name;
    if (transcript.last_name) requestData.last_name = transcript.last_name;
    if (transcript.summary) requestData.call_summary = transcript.summary;
    if (transcript.call_ended_by) requestData.call_ended_by = transcript.call_ended_by;
    if (transcript.transferred_to) requestData.transferred_to = transcript.transferred_to;
    if (transcript.recording_url) requestData.recording_url = transcript.recording_url;
    if (convosoPhone) requestData.phone_number = convosoPhone;

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

  private formatTranscriptForConvoso(transcript: BlandTranscript, convosoStatus: string): string {
    const parts: string[] = [];

    parts.push(`Status: ${convosoStatus}`);
    parts.push(`Outcome: ${transcript.outcome}`);

    if (transcript.plan_type) parts.push(`Plan: ${transcript.plan_type}`);
    if (transcript.member_count) parts.push(`Members: ${transcript.member_count}`);
    if (transcript.zip) parts.push(`ZIP: ${transcript.zip}`);
    if (transcript.state) parts.push(`State: ${transcript.state}`);
    if (transcript.duration) parts.push(`Duration: ${transcript.duration}s`);

    parts.push(`\n--- Transcript ---\n${transcript.transcript}`);

    return parts.join("\n");
  }
}

export const convosoService = new ConvosoService();
