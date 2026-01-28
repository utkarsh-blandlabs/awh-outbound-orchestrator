/**
 * Bulk Operations Routes
 *
 * Endpoints for querying and bulk deleting leads/calls by date range and outcome
 */

import express, { Request, Response } from "express";
import { logger } from "../config/logger";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { redialQueueService } from "../services/redialQueueService";
import { dailyCallTrackerService } from "../services/dailyCallTrackerService";

const router = express.Router();

interface BulkQueryParams {
  start_date?: string; // YYYY-MM-DD
  end_date?: string; // YYYY-MM-DD
  outcome?: string; // TRANSFERRED, VOICEMAIL, NO_ANSWER, BUSY, etc.
  status?: string; // pending, completed, etc. (for redial queue)
  source?: 'all' | 'redial_queue' | 'daily_calls';
}

/**
 * GET /api/admin/bulk/query-leads
 * Query leads/calls by date range and outcome for bulk operations
 */
router.get("/query-leads", async (req: Request, res: Response) => {
  try {
    const {
      start_date,
      end_date,
      outcome,
      status,
      source = 'all'
    }: BulkQueryParams = req.query as any;

    logger.info("Bulk query request", { start_date, end_date, outcome, status, source });

    const results: any = {
      query: { start_date, end_date, outcome, status, source },
      results: [],
      summary: {
        total: 0,
        by_source: {}
      }
    };

    // Query from redial queue
    if (source === 'all' || source === 'redial_queue') {
      const queueRecords = await queryRedialQueue({ start_date, end_date, outcome, status });
      results.results.push(...queueRecords.map(r => ({
        ...r,
        source: 'redial_queue'
      })));
      results.summary.by_source.redial_queue = queueRecords.length;
    }

    // Query from daily calls
    if (source === 'all' || source === 'daily_calls') {
      const dailyRecords = await queryDailyCalls({ start_date, end_date, outcome });
      results.results.push(...dailyRecords.map(r => ({
        ...r,
        source: 'daily_calls'
      })));
      results.summary.by_source.daily_calls = dailyRecords.length;
    }

    // Deduplicate by phone_number
    const uniqueMap = new Map();
    for (const record of results.results) {
      const key = record.phone_number;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, record);
      } else {
        // Merge sources
        const existing = uniqueMap.get(key);
        if (existing.source !== record.source) {
          existing.sources = existing.sources || [existing.source];
          existing.sources.push(record.source);
          existing.source = 'multiple';
        }
      }
    }

    results.results = Array.from(uniqueMap.values());
    results.summary.total = results.results.length;

    return res.json({
      success: true,
      ...results
    });
  } catch (error: any) {
    logger.error("Error querying leads for bulk operations", { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/bulk/delete
 * Bulk delete leads from specified sources
 *
 * Body: {
 *   phone_numbers: string[],
 *   sources: ('redial_queue' | 'sms_sequences' | 'bad_numbers')[],
 *   reason?: string
 * }
 */
router.post("/delete", async (req: Request, res: Response) => {
  try {
    const {
      phone_numbers,
      sources,
      reason = "Bulk delete operation"
    } = req.body;

    if (!phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
      return res.status(400).json({
        success: false,
        error: "phone_numbers array is required"
      });
    }

    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({
        success: false,
        error: "sources array is required"
      });
    }

    logger.info("Bulk delete request", {
      count: phone_numbers.length,
      sources,
      reason,
      user: req.headers['x-user'] || 'unknown'
    });

    const results: any = {
      phone_numbers_processed: phone_numbers.length,
      sources_targeted: sources,
      deleted: {
        redial_queue: 0,
        sms_sequences: 0,
        bad_numbers: 0
      },
      errors: []
    };

    // Delete from redial queue
    if (sources.includes('redial_queue')) {
      for (const phone of phone_numbers) {
        try {
          // Get lead_id from redial queue for this phone
          const records = redialQueueService.getAllRecords();
          const record = records.find((r: any) => r.phone_number === phone);

          if (record) {
            await redialQueueService.removeLead(record.lead_id, phone);
            results.deleted.redial_queue++;
          }
        } catch (err: any) {
          results.errors.push({
            phone,
            source: 'redial_queue',
            error: err.message
          });
        }
      }
    }

    // Delete from bad numbers list
    if (sources.includes('bad_numbers')) {
      const { badNumbersService } = require('../services/badNumbersService');
      for (const phone of phone_numbers) {
        try {
          if (badNumbersService.isBadNumber(phone)) {
            badNumbersService.removeBadNumber(phone);
            results.deleted.bad_numbers++;
          }
        } catch (err: any) {
          results.errors.push({
            phone,
            source: 'bad_numbers',
            error: err.message
          });
        }
      }
    }

    // Delete from SMS sequences (if MongoDB is connected)
    if (sources.includes('sms_sequences')) {
      try {
        const { SmsSequence } = require('../models/SmsSequence');
        const deleteResult = await SmsSequence.deleteMany({
          phone_number: { $in: phone_numbers }
        });
        results.deleted.sms_sequences = deleteResult.deletedCount || 0;
      } catch (err: any) {
        logger.warn("SMS sequences deletion skipped (MongoDB may not be connected)", { error: err.message });
        results.errors.push({
          source: 'sms_sequences',
          error: "MongoDB not available or model not found"
        });
      }
    }

    logger.info("Bulk delete completed", results);

    return res.json({
      success: true,
      ...results
    });
  } catch (error: any) {
    logger.error("Error in bulk delete operation", { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Helper: Query redial queue by filters
 */
async function queryRedialQueue(params: BulkQueryParams): Promise<any[]> {
  try {
    const records = redialQueueService.getAllRecords();

    return records.filter((record: any) => {
      // Filter by status
      if (params.status && record.status !== params.status) {
        return false;
      }

      // Filter by outcome
      if (params.outcome && record.last_outcome !== params.outcome) {
        return false;
      }

      // Filter by date range (created_at or last_attempt_date)
      if (params.start_date || params.end_date) {
        const recordDate = record.last_attempt_date || new Date(record.created_at).toISOString().split('T')[0];

        if (params.start_date && recordDate < params.start_date) {
          return false;
        }

        if (params.end_date && recordDate > params.end_date) {
          return false;
        }
      }

      return true;
    }).map((record: any) => ({
      lead_id: record.lead_id,
      phone_number: record.phone_number,
      first_name: record.first_name,
      last_name: record.last_name,
      status: record.status,
      last_outcome: record.last_outcome,
      attempts: record.attempts,
      attempts_today: record.attempts_today,
      last_attempt_date: record.last_attempt_date,
      created_at: record.created_at
    }));
  } catch (error: any) {
    logger.error("Error querying redial queue", { error: error.message });
    return [];
  }
}

/**
 * Helper: Query daily calls by filters
 */
async function queryDailyCalls(params: BulkQueryParams): Promise<any[]> {
  try {
    const dataDir = join(process.cwd(), 'data', 'daily-calls');

    if (!existsSync(dataDir)) {
      return [];
    }

    const files = readdirSync(dataDir).filter(f => f.startsWith('calls_') && f.endsWith('.json'));
    const results: any[] = [];

    for (const file of files) {
      const fileDate = file.replace('calls_', '').replace('.json', '');

      // Filter by date range
      if (params.start_date && fileDate < params.start_date) continue;
      if (params.end_date && fileDate > params.end_date) continue;

      try {
        const filePath = join(dataDir, file);
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));

        // data is a map of phone_number -> DailyCallRecord
        for (const [phone, record] of Object.entries(data as any)) {
          // Filter by outcome
          if (params.outcome && record.final_outcome !== params.outcome) {
            continue;
          }

          results.push({
            phone_number: phone,
            lead_ids: record.lead_ids,
            final_outcome: record.final_outcome,
            attempts: record.calls?.length || 0,
            date: fileDate,
            last_call_timestamp: record.last_call_timestamp
          });
        }
      } catch (err: any) {
        logger.warn(`Failed to read daily calls file: ${file}`, { error: err.message });
      }
    }

    return results;
  } catch (error: any) {
    logger.error("Error querying daily calls", { error: error.message });
    return [];
  }
}

export default router;
