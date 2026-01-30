#!/usr/bin/env ts-node
/**
 * Fix AWH Statistics using Transcript-Based Analysis
 *
 * Usage:
 *   npx ts-node scripts/fix-awh-stats.ts 2026-01-27 --dry-run
 *   npx ts-node scripts/fix-awh-stats.ts --all --dry-run
 *   npx ts-node scripts/fix-awh-stats.ts --all
 */

import path from "path";
require("dotenv").config();

import { TranscriptAnalyzer, awhConfig, fixStatsForDate, fixAllStats } from "../src/services/reportAnalysis";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const all = args.includes("--all");
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

  if (!process.env.BLAND_API_KEY) {
    console.error("ERROR: BLAND_API_KEY not set in .env");
    process.exit(1);
  }

  const config = { ...awhConfig, blandApiKey: process.env.BLAND_API_KEY };
  const analyzer = new TranscriptAnalyzer(config);

  console.log("Fix AWH Statistics - Transcript Analysis\n");
  console.log(`  API Key: ${process.env.BLAND_API_KEY.substring(0, 10)}...`);
  console.log(`  Data Dir: ${DATA_DIR}`);
  console.log(`  Dry Run: ${dryRun ? "YES" : "NO"}`);
  console.log("");

  if (!dryRun) {
    console.log("WARNING: This will update your statistics files!");
    console.log("Starting in 3 seconds... (Ctrl+C to cancel)\n");
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (date) {
    // Single date
    console.log(`Processing ${date}...\n`);
    const result = await fixStatsForDate(date, analyzer, DATA_DIR, dryRun);

    if (!result) {
      console.log("No data found for this date.");
      return;
    }

    printComparison(date, result.oldStats, result.newStats, result.changed, dryRun);
  } else if (all) {
    // All dates
    const results = await fixAllStats(analyzer, DATA_DIR, dryRun);

    console.log("\n" + "=".repeat(80));
    console.log("RESULTS\n");

    for (const r of results) {
      printComparison(r.date, r.oldStats, r.newStats, r.changed, dryRun);
    }

    const changedCount = results.filter((r) => r.changed).length;
    console.log("=".repeat(80));
    console.log(`\nTotal: ${results.length} dates processed, ${changedCount} changed`);
  } else {
    console.error("Usage:");
    console.error("  npx ts-node scripts/fix-awh-stats.ts 2026-01-27 --dry-run");
    console.error("  npx ts-node scripts/fix-awh-stats.ts --all --dry-run");
    console.error("  npx ts-node scripts/fix-awh-stats.ts --all");
    process.exit(1);
  }

  console.log("\nDone!");
}

function printComparison(
  date: string,
  old: any,
  curr: any,
  changed: boolean,
  dryRun: boolean
) {
  const fmt = (field: string) => {
    const o = old[field] ?? 0;
    const n = (curr as any)[field] ?? 0;
    const diff = n - o;
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
    return diff !== 0 ? `${o} -> ${n} (${diffStr})` : `${o} (no change)`;
  };

  const tag = changed ? (dryRun ? "WOULD CHANGE" : "UPDATED") : "NO CHANGE";
  console.log(`[${tag}] ${date}`);
  console.log(`  answered:       ${fmt("answered_calls")}`);
  console.log(`  transferred:    ${fmt("transferred_calls")}`);
  console.log(`  voicemail:      ${fmt("voicemail_calls")}`);
  console.log(`  busy:           ${fmt("busy_calls")}`);
  console.log(`  callback:       ${fmt("callback_requested_calls")}`);
  console.log(`  no_answer:      ${fmt("no_answer_calls")}`);
  console.log(`  not_interested: ${fmt("not_interested_calls")}`);
  console.log(`  failed:         ${fmt("failed_calls")}`);
  console.log("");
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
