// ============================================================================
// SMS Scheduler Service
// Sends SMS sequences to leads based on Bland.ai conversation history
// Uses Bland.ai SMS API to track conversations and send messages
// ============================================================================

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";
import { timezoneHelper } from "../utils/timezoneHelper";
import axios from "axios";
import { config } from "../config";

interface SMSTemplate {
  position: number;
  id: string;
  day: number;
  message: string;
  max_length: number;
  description: string;
}

interface SMSTemplateConfig {
  templates: SMSTemplate[];
  opt_out_keywords: string[];
  positive_keywords: string[];
  negative_keywords: string[];
  later_keywords: string[];
}

interface BlandSMSMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface BlandSMSConversation {
  conversation_id: string;
  phone_number: string;
  messages: BlandSMSMessage[];
  created_at: string;
  updated_at: string;
}

interface PendingLead {
  lead_id: string;
  phone_number: string;
  list_id: string;
  first_name: string;
  last_name: string;
  state: string;
  last_outcome: string;
  last_call_timestamp: number;
}

class SMSSchedulerService {
  private intervalId: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private enabled: boolean;
  private intervalMinutes: number;
  private tcpaStartHour: number;
  private tcpaEndHour: number;
  private templates: SMSTemplateConfig;
  private cadence: number[]; // Days for each SMS: [0, 1, 3, 7]
  private pendingLeadsFile: string;

  constructor() {
    this.enabled = config.sms.enabled;
    this.intervalMinutes = parseInt(process.env["SMS_SCHEDULER_INTERVAL_MINUTES"] || "5");
    this.tcpaStartHour = config.sms.startHour;
    this.tcpaEndHour = config.sms.endHour;
    this.pendingLeadsFile = path.join(__dirname, "../../data/sms-pending-leads.json");

    // Use cadence from config (dynamic from ENV)
    this.cadence = config.sms.dayGaps;

    // Load templates (for keywords only, messages come from config now)
    this.templates = this.loadTemplates();

    logger.info("SMS Scheduler initialized", {
      enabled: this.enabled,
      intervalMinutes: this.intervalMinutes,
      tcpaHours: `${this.tcpaStartHour}:00 - ${this.tcpaEndHour}:00`,
      cadence: this.cadence,
      maxMessages: config.sms.maxMessages,
    });

    if (this.enabled) {
      this.start();
    } else {
      logger.info("SMS Scheduler disabled (SMS_AUTOMATION_ENABLED=false)");
    }
  }

  /**
   * Load SMS templates from file
   */
  private loadTemplates(): SMSTemplateConfig {
    const templatesPath = path.join(__dirname, "../../data/sms-templates.json");

    try {
      const data = fs.readFileSync(templatesPath, "utf-8");
      return JSON.parse(data);
    } catch (error: any) {
      logger.error("Failed to load SMS templates", { error: error.message });
      return {
        templates: [],
        opt_out_keywords: ["STOP"],
        positive_keywords: ["YES"],
        negative_keywords: ["NO"],
        later_keywords: ["LATER"],
      };
    }
  }

  /**
   * Load pending leads from file
   */
  private loadPendingLeads(): PendingLead[] {
    try {
      if (fs.existsSync(this.pendingLeadsFile)) {
        const data = fs.readFileSync(this.pendingLeadsFile, "utf-8");
        return JSON.parse(data);
      }
      return [];
    } catch (error: any) {
      logger.error("Failed to load pending leads", { error: error.message });
      return [];
    }
  }

  /**
   * Save pending leads to file
   */
  private savePendingLeads(leads: PendingLead[]): void {
    try {
      const dir = path.dirname(this.pendingLeadsFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.pendingLeadsFile, JSON.stringify(leads, null, 2));
    } catch (error: any) {
      logger.error("Failed to save pending leads", { error: error.message });
    }
  }

  /**
   * Add lead to SMS queue
   */
  addLead(lead: PendingLead): void {
    if (!this.enabled) return;

    const leads = this.loadPendingLeads();

    // Check if lead already exists
    const existingIndex = leads.findIndex(l => l.phone_number === lead.phone_number);

    if (existingIndex >= 0) {
      // Update existing lead
      leads[existingIndex] = lead;
    } else {
      // Add new lead
      leads.push(lead);
    }

    this.savePendingLeads(leads);

    logger.info("Lead added to SMS queue", {
      lead_id: lead.lead_id,
      phone: lead.phone_number,
      total_pending: leads.length,
    });
  }

  /**
   * Remove lead from SMS queue
   */
  private removeLead(phoneNumber: string): void {
    const leads = this.loadPendingLeads();
    const filtered = leads.filter(l => l.phone_number !== phoneNumber);
    this.savePendingLeads(filtered);
  }

  /**
   * Get SMS message template for a specific position (1-based)
   * Dynamically uses config from ENV
   */
  private getMessageTemplate(position: number): string | null {
    switch (position) {
      case 1:
        return config.sms.message1;
      case 2:
        return config.sms.message2;
      case 3:
        return config.sms.message3;
      case 4:
        return config.sms.message4;
      default:
        return null;
    }
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.intervalId) {
      logger.warn("SMS Scheduler already running");
      return;
    }

    logger.info("Starting SMS Scheduler");

    // Run immediately on start
    this.processPendingLeads();

    // Then run on configured interval
    const intervalMs = this.intervalMinutes * 60 * 1000;
    this.intervalId = setInterval(() => {
      this.processPendingLeads();
    }, intervalMs);

    logger.info("SMS Scheduler started", {
      nextCheckIn: `${this.intervalMinutes} minutes`,
    });
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("SMS Scheduler stopped");
    }
  }

  /**
   * Fetch SMS conversation history from Bland.ai
   */
  private async fetchSMSConversation(phoneNumber: string): Promise<BlandSMSConversation | null> {
    try {
      const response = await axios.get(
        `https://api.bland.ai/v1/sms/conversations`,
        {
          params: {
            phone_number: phoneNumber,
          },
          headers: {
            Authorization: config.bland.apiKey,
          },
          timeout: 30000,
        }
      );

      if (response.status === 200 && response.data) {
        // Bland returns array of conversations, get the most recent one
        const conversations = response.data.conversations || [];
        if (conversations.length > 0) {
          return conversations[0]; // Most recent conversation
        }
      }

      return null;
    } catch (error: any) {
      if (error.response?.status === 404) {
        // No conversation exists yet - this is fine
        return null;
      }
      logger.error("Failed to fetch SMS conversation from Bland", {
        phone: phoneNumber,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Check if conversation contains STOP keyword
   */
  private hasOptedOut(conversation: BlandSMSConversation | null): boolean {
    if (!conversation) return false;

    for (const message of conversation.messages) {
      if (message.role === "user") {
        const content = message.content.toUpperCase();
        if (this.templates.opt_out_keywords.some(kw => content.includes(kw))) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Count how many SMS messages we've sent (assistant messages)
   */
  private countSentMessages(conversation: BlandSMSConversation | null): number {
    if (!conversation) return 0;

    return conversation.messages.filter(m => m.role === "assistant").length;
  }

  /**
   * Process all pending leads for SMS
   */
  private async processPendingLeads(): Promise<void> {
    if (this.isProcessing) {
      logger.debug("SMS processing already in progress, skipping");
      return;
    }

    if (!this.enabled) {
      return;
    }

    try {
      this.isProcessing = true;

      const leads = this.loadPendingLeads();

      if (leads.length === 0) {
        logger.debug("No pending SMS leads");
        return;
      }

      logger.info("Processing SMS pending leads", { count: leads.length });

      let sent = 0;
      let skipped = 0;
      let failed = 0;

      for (const lead of leads) {
        try {
          const result = await this.processLead(lead);
          if (result === "sent") sent++;
          else if (result === "skipped") skipped++;
          else failed++;

          // Small delay between SMS sends
          await this.sleep(100);
        } catch (error: any) {
          failed++;
          logger.error("Failed to process SMS lead", {
            lead_id: lead.lead_id,
            error: error.message,
          });
        }
      }

      logger.info("SMS lead processing completed", {
        total: leads.length,
        sent,
        skipped,
        failed,
      });
    } catch (error: any) {
      logger.error("SMS scheduler error", {
        error: error.message,
        stack: error.stack,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single lead for SMS
   */
  private async processLead(lead: PendingLead): Promise<"sent" | "skipped" | "failed"> {
    // Fetch SMS conversation history from Bland
    const conversation = await this.fetchSMSConversation(lead.phone_number);

    // Check if opted out
    if (this.hasOptedOut(conversation)) {
      logger.info("Lead opted out - removing from SMS queue", {
        lead_id: lead.lead_id,
        phone: lead.phone_number,
      });
      this.removeLead(lead.phone_number);
      return "skipped";
    }

    // Count how many messages we've already sent
    const messagesSent = this.countSentMessages(conversation);

    // Determine next message position (1-based)
    const nextPosition = messagesSent + 1;
    const maxMessages = config.sms.maxMessages;

    if (nextPosition > maxMessages) {
      // All messages sent - remove from queue
      logger.info("All SMS messages sent - removing from queue", {
        lead_id: lead.lead_id,
        phone: lead.phone_number,
        messages_sent: messagesSent,
        max_messages: maxMessages,
      });
      this.removeLead(lead.phone_number);
      return "skipped";
    }

    // Calculate when this SMS should be sent based on cadence
    const daysSinceStart = this.cadence[nextPosition - 1];
    if (daysSinceStart === undefined) {
      logger.error("Invalid SMS position", { nextPosition, cadence: this.cadence });
      return "failed";
    }

    const scheduledTime = new Date(lead.last_call_timestamp);
    scheduledTime.setDate(scheduledTime.getDate() + daysSinceStart);

    // Check if it's time to send
    const now = new Date();
    if (now < scheduledTime) {
      return "skipped"; // Not time yet
    }

    // Check TCPA compliance
    const timezone = timezoneHelper.getTimezoneByState(lead.state);
    const canSend = this.checkTCPACompliance(timezone);
    if (!canSend) {
      logger.debug("SMS skipped due to TCPA hours", {
        lead_id: lead.lead_id,
        timezone,
      });
      return "skipped";
    }

    // Get message template from config (dynamic from ENV)
    const messageTemplate = this.getMessageTemplate(nextPosition);
    if (!messageTemplate) {
      logger.error("No SMS message configured for position", { position: nextPosition });
      return "failed";
    }

    // Replace placeholders
    let message = messageTemplate;
    message = message.replace(/\{\{first_name\}\}/g, lead.first_name || "");
    message = message.replace(/\{\{last_name\}\}/g, lead.last_name || "");

    // Send SMS via Bland AI
    try {
      await this.sendSMS(lead.phone_number, message);

      logger.info("SMS sent successfully", {
        lead_id: lead.lead_id,
        phone: lead.phone_number,
        position: nextPosition,
        messagesSent: messagesSent + 1,
        maxMessages: config.sms.maxMessages,
      });

      // If this was the last message, remove from queue
      if (nextPosition >= config.sms.maxMessages) {
        this.removeLead(lead.phone_number);
        logger.info("Final SMS sent - removed from queue", {
          lead_id: lead.lead_id,
          phone: lead.phone_number,
        });
      }

      return "sent";
    } catch (error: any) {
      logger.error("Failed to send SMS", {
        lead_id: lead.lead_id,
        error: error.message,
      });
      return "failed";
    }
  }

  /**
   * Send SMS via Bland AI API
   */
  private async sendSMS(phoneNumber: string, message: string): Promise<string> {
    const response = await axios.post(
      "https://api.bland.ai/v1/sms",
      {
        phone_number: phoneNumber,
        message: message,
        from: config.bland.smsFrom || config.bland.from,
      },
      {
        headers: {
          Authorization: config.bland.apiKey,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Bland AI SMS API returned status ${response.status}`);
    }

    return response.data.sms_id || response.data.id || `sms_${Date.now()}`;
  }

  /**
   * Check if current time is within TCPA compliance hours (8 AM - 9 PM local time)
   */
  private checkTCPACompliance(timezone: string): boolean {
    try {
      const now = new Date();

      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
        weekday: "short",
      });

      const parts = formatter.formatToParts(now);
      const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0");
      const weekday = parts.find(p => p.type === "weekday")?.value;

      // Check if weekend
      if (weekday === "Sat" || weekday === "Sun") {
        return false; // Don't send SMS on weekends
      }

      // Check if within allowed hours
      if (hour < this.tcpaStartHour || hour >= this.tcpaEndHour) {
        return false;
      }

      return true;
    } catch (error: any) {
      logger.error("TCPA compliance check failed", { error: error.message });
      return false; // Fail safe - don't send if we can't verify compliance
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    enabled: boolean;
    running: boolean;
    processing: boolean;
    intervalMinutes: number;
    tcpaHours: string;
    templatesLoaded: number;
    pendingLeads: number;
  } {
    return {
      enabled: this.enabled,
      running: this.intervalId !== null,
      processing: this.isProcessing,
      intervalMinutes: this.intervalMinutes,
      tcpaHours: `${this.tcpaStartHour}:00 - ${this.tcpaEndHour}:00`,
      templatesLoaded: this.templates.templates.length,
      pendingLeads: this.loadPendingLeads().length,
    };
  }

  /**
   * Enable/disable scheduler
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled && !this.intervalId) {
      this.start();
    } else if (!enabled && this.intervalId) {
      this.stop();
    }
  }
}

export const smsSchedulerService = new SMSSchedulerService();
