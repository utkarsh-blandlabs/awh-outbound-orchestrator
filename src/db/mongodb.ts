import { MongoClient, Db, Collection, Document } from "mongodb";
import { logger } from "../utils/logger";

/**
 * MongoDB Connection Service
 *
 * Implements connection pooling and reuse to avoid exhausting free tier limits.
 * Free tier (Atlas M0): 512 MB storage, 100 max connections
 *
 * Strategy:
 * - Single connection instance (connection pooling)
 * - Lazy connection (connect on first use)
 * - Auto-reconnect on failure
 * - Graceful shutdown
 */
class MongoDBService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private connectionString: string;
  private dbName: string;
  private isConnecting: boolean = false;
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    this.connectionString = process.env["MONGODB_CONNECTION_STRING"] || "";
    this.dbName = process.env["MONGODB_DATABASE_NAME"] || "awh_orchestrator";

    if (!this.connectionString) {
      logger.warn("MongoDB connection string not configured - SMS features will be disabled");
    }
  }

  /**
   * Get database connection (lazy initialization)
   */
  async getDb(): Promise<Db> {
    if (this.db) {
      return this.db;
    }

    if (this.isConnecting && this.connectionPromise) {
      await this.connectionPromise;
      if (this.db) return this.db;
    }

    await this.connect();

    if (!this.db) {
      throw new Error("Failed to establish MongoDB connection");
    }

    return this.db;
  }

  /**
   * Connect to MongoDB
   */
  private async connect(): Promise<void> {
    if (this.isConnecting) {
      return this.connectionPromise || Promise.resolve();
    }

    this.isConnecting = true;
    this.connectionPromise = this._connect();

    try {
      await this.connectionPromise;
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }

  private async _connect(): Promise<void> {
    try {
      if (!this.connectionString) {
        throw new Error("MongoDB connection string not configured");
      }

      logger.info("Connecting to MongoDB...");

      this.client = new MongoClient(this.connectionString, {
        maxPoolSize: 10, // Limit connections for free tier
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        retryWrites: true,
        retryReads: true,
      });

      await this.client.connect();
      this.db = this.client.db(this.dbName);

      // Test connection
      await this.db.command({ ping: 1 });

      logger.info("MongoDB connected successfully", {
        database: this.dbName,
        collections: await this.db.listCollections().toArray(),
      });

      // Create indexes on first connection
      await this.createIndexes();

    } catch (error: any) {
      logger.error("Failed to connect to MongoDB", {
        error: error.message,
        stack: error.stack,
      });

      this.client = null;
      this.db = null;

      throw error;
    }
  }

  /**
   * Create indexes for efficient queries
   */
  private async createIndexes(): Promise<void> {
    try {
      if (!this.db) return;

      logger.info("Creating MongoDB indexes...");

      // SMS Sequences collection indexes
      const smsSequences = this.db.collection("sms_sequences");
      await smsSequences.createIndex({ lead_id: 1 });
      await smsSequences.createIndex({ phone_number: 1 });
      await smsSequences.createIndex({ status: 1, current_position: 1 });
      await smsSequences.createIndex({ "messages.scheduled_for": 1 });
      await smsSequences.createIndex({ sequence_started_at: -1 });

      // SMS Replies collection indexes
      const smsReplies = this.db.collection("sms_replies");
      await smsReplies.createIndex({ phone_number: 1, received_at: -1 });
      await smsReplies.createIndex({ lead_id: 1 });
      await smsReplies.createIndex({ reply_type: 1 });
      await smsReplies.createIndex({ received_at: -1 });

      // SMS Opt-Outs collection indexes
      const smsOptOuts = this.db.collection("sms_opt_outs");
      await smsOptOuts.createIndex({ phone_number: 1 }, { unique: true });
      await smsOptOuts.createIndex({ opted_out_at: -1 });

      // SMS Daily Stats collection indexes
      const smsDailyStats = this.db.collection("sms_daily_stats");
      await smsDailyStats.createIndex({ date: -1 }, { unique: true });

      // TTL index for auto-cleanup (delete sequences older than 90 days)
      await smsSequences.createIndex(
        { created_at: 1 },
        { expireAfterSeconds: 90 * 24 * 60 * 60 } // 90 days
      );

      logger.info("MongoDB indexes created successfully");

    } catch (error: any) {
      logger.error("Failed to create MongoDB indexes", {
        error: error.message,
      });
      // Don't throw - indexes are optimization, not critical
    }
  }

  /**
   * Get a collection
   */
  async getCollection<T extends Document = Document>(name: string): Promise<Collection<T>> {
    const db = await this.getDb();
    return db.collection<T>(name);
  }

  /**
   * Check if MongoDB is connected and healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      if (!this.db) return false;

      await this.db.command({ ping: 1 });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get connection stats
   */
  async getStats(): Promise<any> {
    try {
      if (!this.db) {
        return {
          connected: false,
          error: "Not connected",
        };
      }

      const stats = await this.db.stats();
      const collections = await this.db.listCollections().toArray();

      return {
        connected: true,
        database: this.dbName,
        collections: collections.map((c) => c.name),
        storage: {
          dataSize: stats["dataSize"],
          indexSize: stats["indexSize"],
          storageSize: stats["storageSize"],
          totalSize: stats["dataSize"] + stats["indexSize"],
        },
      };
    } catch (error: any) {
      return {
        connected: false,
        error: error.message,
      };
    }
  }

  /**
   * Gracefully close MongoDB connection
   */
  async close(): Promise<void> {
    try {
      if (this.client) {
        logger.info("Closing MongoDB connection...");
        await this.client.close();
        this.client = null;
        this.db = null;
        logger.info("MongoDB connection closed");
      }
    } catch (error: any) {
      logger.error("Error closing MongoDB connection", {
        error: error.message,
      });
    }
  }
}

// Export singleton instance
export const mongoDBService = new MongoDBService();

// Graceful shutdown handler
process.on("SIGINT", async () => {
  await mongoDBService.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await mongoDBService.close();
  process.exit(0);
});
