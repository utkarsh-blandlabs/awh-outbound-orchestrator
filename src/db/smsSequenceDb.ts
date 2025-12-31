import { mongoDBService } from "./mongodb";
import { logger } from "../utils/logger";
import { Collection, ObjectId } from "mongodb";

/**
 * SMS Sequence Document Interface
 */
export interface SMSSequenceDocument {
  _id?: ObjectId;
  lead_id: string;
  phone_number: string;
  list_id: string;
  first_name?: string;
  last_name?: string;
  state?: string;
  timezone: string;

  sequence_started_at: Date;
  current_position: number; // 0, 1, 2, 3, 4 (4 = completed)
  status: "ACTIVE" | "COMPLETED" | "CANCELLED" | "OPTED_OUT";

  messages: SMSMessage[];

  completed_at?: Date;
  cancelled_at?: Date;
  cancelled_reason?: string;

  created_at: Date;
  updated_at: Date;
}

export interface SMSMessage {
  position: number;
  template_id: string;
  scheduled_for: Date;
  sent_at?: Date;
  sms_id?: string;
  delivered?: boolean;
  delivery_status?: string;
  error?: string;
  reply?: string;
  reply_at?: Date;
}

/**
 * SMS Reply Document Interface
 */
export interface SMSReplyDocument {
  _id?: ObjectId;
  phone_number: string;
  lead_id: string;
  reply_text: string;
  reply_type: "POSITIVE" | "NEGATIVE" | "OPT_OUT" | "UNKNOWN";
  received_at: Date;
  sequence_position?: number;
  action_taken?: string;
  convoso_logged: boolean;
  created_at: Date;
}

/**
 * SMS Opt-Out Document Interface
 */
export interface SMSOptOutDocument {
  _id?: ObjectId;
  phone_number: string;
  lead_id?: string;
  opted_out_at: Date;
  opt_out_message: string;
  source: "SMS_REPLY" | "VOICE_CALL" | "MANUAL";
  blocklist_flag_id?: string;
  convoso_updated: boolean;
  created_at: Date;
}

/**
 * SMS Daily Stats Document Interface
 */
export interface SMSDailyStatsDocument {
  _id?: ObjectId;
  date: string; // YYYY-MM-DD

  sequences_started: number;
  sequences_completed: number;
  sequences_cancelled: number;

  sms_sent: {
    position_1: number;
    position_2: number;
    position_3: number;
    position_4: number;
    total: number;
  };

  sms_delivered: number;
  sms_failed: number;

  replies: {
    total: number;
    stop: number;
    yes: number;
    no: number;
    other: number;
  };

  opt_outs: number;
  callbacks_triggered: number;
  tcpa_violations_prevented: number;

  created_at: Date;
  updated_at: Date;
}

/**
 * SMS Sequence Database Service
 *
 * Handles all MongoDB operations for SMS sequences
 * Implements batch operations and efficient querying
 */
class SMSSequenceDbService {
  /**
   * Start a new SMS sequence for a lead
   */
  async startSequence(data: {
    lead_id: string;
    phone_number: string;
    list_id: string;
    first_name?: string;
    last_name?: string;
    state?: string;
    timezone: string;
  }): Promise<SMSSequenceDocument> {
    try {
      const collection = await mongoDBService.getCollection<SMSSequenceDocument>("sms_sequences");

      // Check if sequence already exists
      const existing = await collection.findOne({
        lead_id: data.lead_id,
        phone_number: data.phone_number,
        status: { $in: ["ACTIVE", "COMPLETED"] },
      });

      if (existing) {
        logger.warn("SMS sequence already exists for lead", {
          lead_id: data.lead_id,
          phone_number: data.phone_number,
          status: existing.status,
        });
        return existing;
      }

      const now = new Date();
      const document: SMSSequenceDocument = {
        lead_id: data.lead_id,
        phone_number: data.phone_number,
        list_id: data.list_id,
        first_name: data.first_name,
        last_name: data.last_name,
        state: data.state,
        timezone: data.timezone,
        sequence_started_at: now,
        current_position: 0,
        status: "ACTIVE",
        messages: [],
        created_at: now,
        updated_at: now,
      };

      const result = await collection.insertOne(document);
      document._id = result.insertedId;

      logger.info("SMS sequence started", {
        lead_id: data.lead_id,
        phone_number: data.phone_number,
        sequence_id: result.insertedId,
      });

      return document;

    } catch (error: any) {
      logger.error("Failed to start SMS sequence", {
        error: error.message,
        lead_id: data.lead_id,
      });
      throw error;
    }
  }

  /**
   * Record SMS sent
   */
  async recordSMSSent(
    lead_id: string,
    message: SMSMessage
  ): Promise<void> {
    try {
      const collection = await mongoDBService.getCollection<SMSSequenceDocument>("sms_sequences");

      await collection.updateOne(
        { lead_id, status: "ACTIVE" },
        {
          $push: { messages: message },
          $set: {
            current_position: message.position,
            updated_at: new Date(),
          },
        }
      );

      logger.info("SMS sent recorded", {
        lead_id,
        position: message.position,
        sms_id: message.sms_id,
      });

    } catch (error: any) {
      logger.error("Failed to record SMS sent", {
        error: error.message,
        lead_id,
      });
      throw error;
    }
  }

  /**
   * Record SMS reply
   */
  async recordReply(data: {
    phone_number: string;
    lead_id: string;
    reply_text: string;
    reply_type: "POSITIVE" | "NEGATIVE" | "OPT_OUT" | "UNKNOWN";
    sequence_position?: number;
    action_taken?: string;
    convoso_logged: boolean;
  }): Promise<void> {
    try {
      const collection = await mongoDBService.getCollection<SMSReplyDocument>("sms_replies");

      const document: SMSReplyDocument = {
        ...data,
        received_at: new Date(),
        created_at: new Date(),
      };

      await collection.insertOne(document);

      // Also update the sequence document if sequence_position provided
      if (data.sequence_position !== undefined) {
        const sequenceCollection = await mongoDBService.getCollection<SMSSequenceDocument>("sms_sequences");
        await sequenceCollection.updateOne(
          {
            lead_id: data.lead_id,
            status: "ACTIVE",
            "messages.position": data.sequence_position,
          },
          {
            $set: {
              "messages.$.reply": data.reply_text,
              "messages.$.reply_at": new Date(),
              updated_at: new Date(),
            },
          }
        );
      }

      logger.info("SMS reply recorded", {
        phone_number: data.phone_number,
        reply_type: data.reply_type,
      });

    } catch (error: any) {
      logger.error("Failed to record SMS reply", {
        error: error.message,
        phone_number: data.phone_number,
      });
      throw error;
    }
  }

  /**
   * Record opt-out
   */
  async recordOptOut(data: {
    phone_number: string;
    lead_id?: string;
    opt_out_message: string;
    source: "SMS_REPLY" | "VOICE_CALL" | "MANUAL";
    blocklist_flag_id?: string;
    convoso_updated: boolean;
  }): Promise<void> {
    try {
      const collection = await mongoDBService.getCollection<SMSOptOutDocument>("sms_opt_outs");

      // Check if already opted out
      const existing = await collection.findOne({ phone_number: data.phone_number });
      if (existing) {
        logger.warn("Phone already opted out", {
          phone_number: data.phone_number,
        });
        return;
      }

      const document: SMSOptOutDocument = {
        ...data,
        opted_out_at: new Date(),
        created_at: new Date(),
      };

      await collection.insertOne(document);

      // Cancel active sequences for this phone
      const sequenceCollection = await mongoDBService.getCollection<SMSSequenceDocument>("sms_sequences");
      await sequenceCollection.updateMany(
        { phone_number: data.phone_number, status: "ACTIVE" },
        {
          $set: {
            status: "OPTED_OUT",
            cancelled_at: new Date(),
            cancelled_reason: "SMS opt-out",
            updated_at: new Date(),
          },
        }
      );

      logger.info("Opt-out recorded", {
        phone_number: data.phone_number,
        source: data.source,
      });

    } catch (error: any) {
      logger.error("Failed to record opt-out", {
        error: error.message,
        phone_number: data.phone_number,
      });
      throw error;
    }
  }

  /**
   * Check if phone number has opted out
   */
  async isOptedOut(phone_number: string): Promise<boolean> {
    try {
      const collection = await mongoDBService.getCollection<SMSOptOutDocument>("sms_opt_outs");
      const result = await collection.findOne({ phone_number });
      return !!result;

    } catch (error: any) {
      logger.error("Failed to check opt-out status", {
        error: error.message,
        phone_number,
      });
      return false; // Fail open - don't block if DB error
    }
  }

  /**
   * Cancel sequence (e.g., when lead converts)
   */
  async cancelSequence(
    lead_id: string,
    reason: string
  ): Promise<void> {
    try {
      const collection = await mongoDBService.getCollection<SMSSequenceDocument>("sms_sequences");

      await collection.updateOne(
        { lead_id, status: "ACTIVE" },
        {
          $set: {
            status: "CANCELLED",
            cancelled_at: new Date(),
            cancelled_reason: reason,
            updated_at: new Date(),
          },
        }
      );

      logger.info("SMS sequence cancelled", {
        lead_id,
        reason,
      });

    } catch (error: any) {
      logger.error("Failed to cancel SMS sequence", {
        error: error.message,
        lead_id,
      });
      throw error;
    }
  }

  /**
   * Complete sequence
   */
  async completeSequence(lead_id: string): Promise<void> {
    try {
      const collection = await mongoDBService.getCollection<SMSSequenceDocument>("sms_sequences");

      await collection.updateOne(
        { lead_id, status: "ACTIVE" },
        {
          $set: {
            status: "COMPLETED",
            completed_at: new Date(),
            current_position: 4,
            updated_at: new Date(),
          },
        }
      );

      logger.info("SMS sequence completed", { lead_id });

    } catch (error: any) {
      logger.error("Failed to complete SMS sequence", {
        error: error.message,
        lead_id,
      });
      throw error;
    }
  }

  /**
   * Get sequences pending next SMS
   * Returns leads that need their next SMS sent
   */
  async getPendingSequences(): Promise<SMSSequenceDocument[]> {
    try {
      const collection = await mongoDBService.getCollection<SMSSequenceDocument>("sms_sequences");

      const now = new Date();

      // Find active sequences where the next message is due
      const sequences = await collection
        .find({
          status: "ACTIVE",
          current_position: { $lt: 4 },
          $or: [
            // No messages sent yet
            { messages: { $size: 0 } },
            // Last message sent and next message is due
            {
              "messages.scheduled_for": { $lte: now },
              $expr: {
                $lt: [{ $size: "$messages" }, "$current_position"],
              },
            },
          ],
        })
        .toArray();

      return sequences;

    } catch (error: any) {
      logger.error("Failed to get pending sequences", {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Get sequence by lead_id
   */
  async getSequence(lead_id: string): Promise<SMSSequenceDocument | null> {
    try {
      const collection = await mongoDBService.getCollection<SMSSequenceDocument>("sms_sequences");
      return await collection.findOne({ lead_id, status: "ACTIVE" });

    } catch (error: any) {
      logger.error("Failed to get sequence", {
        error: error.message,
        lead_id,
      });
      return null;
    }
  }

  /**
   * Update daily stats (called at end of day)
   */
  async updateDailyStats(date: string, stats: Partial<SMSDailyStatsDocument>): Promise<void> {
    try {
      const collection = await mongoDBService.getCollection<SMSDailyStatsDocument>("sms_daily_stats");

      const now = new Date();

      await collection.updateOne(
        { date },
        {
          $set: {
            ...stats,
            updated_at: now,
          },
          $setOnInsert: {
            created_at: now,
          },
        },
        { upsert: true }
      );

      logger.info("Daily stats updated", { date });

    } catch (error: any) {
      logger.error("Failed to update daily stats", {
        error: error.message,
        date,
      });
    }
  }

  /**
   * Get stats for a date range
   */
  async getStats(startDate: string, endDate: string): Promise<SMSDailyStatsDocument[]> {
    try {
      const collection = await mongoDBService.getCollection<SMSDailyStatsDocument>("sms_daily_stats");

      return await collection
        .find({
          date: {
            $gte: startDate,
            $lte: endDate,
          },
        })
        .sort({ date: -1 })
        .toArray();

    } catch (error: any) {
      logger.error("Failed to get stats", {
        error: error.message,
        startDate,
        endDate,
      });
      return [];
    }
  }
}

export const smsSequenceDb = new SMSSequenceDbService();
