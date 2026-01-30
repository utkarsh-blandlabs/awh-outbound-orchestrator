// ============================================================================
// Report Generator - Formats analysis results
// ============================================================================

import { AnalysisReport } from "./types";

/**
 * Format report as Slack-compatible markdown
 */
export function formatSlackReport(report: AnalysisReport): string {
  const { stats, category_breakdown } = report;

  let md = `*Daily Call Report - ${report.date}*\n`;
  md += `_Config: ${report.config_name}_\n\n`;

  md += `*Executive Summary*\n`;
  md += `Total Calls: *${stats.total_calls}*\n`;
  md += `Human Answered: *${stats.answered_calls}* (${stats.total_calls > 0 ? ((stats.answered_calls / stats.total_calls) * 100).toFixed(1) : 0}%)\n`;
  md += `Transferred: *${stats.transferred_calls}*\n`;
  md += `Voicemail: *${stats.voicemail_calls}* (${stats.voicemail_rate}%)\n`;
  md += `Busy: *${stats.busy_calls}*\n`;
  md += `No Answer: *${stats.no_answer_calls}*\n`;
  md += `Callback: *${stats.callback_requested_calls}*\n`;
  md += `Not Interested: *${stats.not_interested_calls}*\n`;
  md += `Failed: *${stats.failed_calls}*\n\n`;

  md += `*Rates*\n`;
  md += `Connectivity: *${stats.connectivity_rate}%*\n`;
  md += `Success: *${stats.success_rate}%*\n\n`;

  md += `_Detection: transcript-based analysis (tags used as fallback only)_\n`;

  return md;
}

/**
 * Format report as plain text
 */
export function formatTextReport(report: AnalysisReport): string {
  const { stats } = report;

  let text = `Daily Call Report - ${report.date}\n`;
  text += `Config: ${report.config_name}\n`;
  text += `${"=".repeat(50)}\n\n`;

  text += `SUMMARY\n`;
  text += `  Total Calls:     ${stats.total_calls}\n`;
  text += `  Human Answered:  ${stats.answered_calls}\n`;
  text += `  Transferred:     ${stats.transferred_calls}\n`;
  text += `  Voicemail:       ${stats.voicemail_calls}\n`;
  text += `  Busy:            ${stats.busy_calls}\n`;
  text += `  No Answer:       ${stats.no_answer_calls}\n`;
  text += `  Callback:        ${stats.callback_requested_calls}\n`;
  text += `  Not Interested:  ${stats.not_interested_calls}\n`;
  text += `  Failed:          ${stats.failed_calls}\n\n`;

  text += `RATES\n`;
  text += `  Connectivity:    ${stats.connectivity_rate}%\n`;
  text += `  Transfer:        ${stats.transfer_rate}%\n`;
  text += `  Success:         ${stats.success_rate}%\n`;
  text += `  Voicemail:       ${stats.voicemail_rate}%\n`;

  return text;
}
