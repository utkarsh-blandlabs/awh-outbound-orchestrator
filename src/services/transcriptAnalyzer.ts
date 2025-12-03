// ============================================================================
// Transcript Analyzer (Optional AI Analysis)
// Uses Claude Haiku (free tier) or local analysis for deeper insights
// ============================================================================

import { logger } from "../utils/logger";
import { CallOutcome } from "../types/awh";

/**
 * Enhanced outcome analysis using transcript content
 * This is OPTIONAL - only use if basic Bland data isn't enough
 */
export class TranscriptAnalyzer {
  /**
   * Analyze transcript for deeper insights
   * WITHOUT using external AI (pattern matching)
   */
  static analyzeTranscriptLocally(transcript: string, variables: any): {
    leadQuality: "hot" | "warm" | "cold";
    objections: string[];
    sentimentScore: number; // 0-10
    isQualified: boolean;
    missingInfo: string[];
  } {
    const text = transcript.toLowerCase();

    // Detect objections
    const objections: string[] = [];
    if (text.includes("too expensive") || text.includes("can't afford")) {
      objections.push("price_concern");
    }
    if (text.includes("already have") || text.includes("don't need")) {
      objections.push("already_insured");
    }
    if (text.includes("call back") || text.includes("later")) {
      objections.push("callback_requested");
    }
    if (text.includes("not interested") || text.includes("no thanks")) {
      objections.push("not_interested");
    }

    // Sentiment analysis (basic)
    let sentimentScore = 5; // neutral
    const positiveWords = ["yes", "interested", "perfect", "great", "sounds good"];
    const negativeWords = ["no", "not interested", "busy", "can't", "don't"];

    positiveWords.forEach((word) => {
      if (text.includes(word)) sentimentScore += 1;
    });
    negativeWords.forEach((word) => {
      if (text.includes(word)) sentimentScore -= 1;
    });
    sentimentScore = Math.max(0, Math.min(10, sentimentScore));

    // Check if qualified (has all 4 pieces of info)
    const missingInfo: string[] = [];
    if (!variables.plan_type) missingInfo.push("plan_type");
    if (!variables.customer_age && !variables.age) missingInfo.push("age");
    if (!variables.postal_code && !variables.zip) missingInfo.push("zip");
    if (!variables.customer_state && !variables.state) missingInfo.push("state");

    const isQualified = missingInfo.length === 0;

    // Determine lead quality
    let leadQuality: "hot" | "warm" | "cold";
    if (isQualified && sentimentScore >= 7 && objections.length === 0) {
      leadQuality = "hot";
    } else if (isQualified && sentimentScore >= 5) {
      leadQuality = "warm";
    } else {
      leadQuality = "cold";
    }

    logger.debug("📊 Transcript Analysis (Local)", {
      leadQuality,
      objections,
      sentimentScore,
      isQualified,
      missingInfo,
    });

    return {
      leadQuality,
      objections,
      sentimentScore,
      isQualified,
      missingInfo,
    };
  }

  /**
   * Enhanced outcome determination using transcript analysis
   * Combines Bland's data with local AI analysis
   */
  static enhancedOutcomeDetection(
    basicOutcome: CallOutcome,
    transcript: string,
    variables: any,
    blandData: any
  ): {
    outcome: CallOutcome;
    leadQuality: "hot" | "warm" | "cold";
    disposition: string;
    notes: string;
  } {
    // If basic outcome is clear (voicemail, no-answer, etc), use it
    if (
      basicOutcome !== CallOutcome.UNKNOWN &&
      basicOutcome !== CallOutcome.TRANSFERRED
    ) {
      return {
        outcome: basicOutcome,
        leadQuality: "cold",
        disposition: basicOutcome,
        notes: `Call ended with ${basicOutcome}`,
      };
    }

    // Analyze transcript for deeper insights
    const analysis = this.analyzeTranscriptLocally(transcript, variables);

    // Refine outcome based on analysis
    let refinedOutcome: CallOutcome = basicOutcome;
    let disposition: string = basicOutcome;

    if (analysis.objections.includes("callback_requested")) {
      refinedOutcome = CallOutcome.CALLBACK;
      disposition = "CALLBACK_REQUESTED";
    } else if (analysis.objections.includes("not_interested")) {
      refinedOutcome = CallOutcome.FAILED;
      disposition = "NOT_INTERESTED";
    } else if (analysis.isQualified && analysis.leadQuality === "hot") {
      refinedOutcome = CallOutcome.TRANSFERRED;
      disposition = "QUALIFIED_HOT_LEAD";
    } else if (analysis.isQualified && analysis.leadQuality === "warm") {
      refinedOutcome = CallOutcome.TRANSFERRED;
      disposition = "QUALIFIED_WARM_LEAD";
    } else if (!analysis.isQualified) {
      refinedOutcome = CallOutcome.FAILED;
      disposition = `INCOMPLETE_${analysis.missingInfo.join("_")}`.toUpperCase();
    }

    // Generate notes
    const notes = this.generateCallNotes(analysis, blandData, transcript);

    return {
      outcome: refinedOutcome,
      leadQuality: analysis.leadQuality,
      disposition,
      notes,
    };
  }

  /**
   * Generate human-readable call notes
   */
  private static generateCallNotes(
    analysis: any,
    blandData: any,
    transcript: string
  ): string {
    const notes: string[] = [];

    // Call duration
    notes.push(
      `Duration: ${blandData.call_length || blandData.corrected_duration || 0} min`
    );

    // Lead quality
    notes.push(`Lead Quality: ${analysis.leadQuality.toUpperCase()}`);

    // Qualification status
    if (analysis.isQualified) {
      notes.push("✓ Fully qualified");
    } else {
      notes.push(`✗ Missing: ${analysis.missingInfo.join(", ")}`);
    }

    // Objections
    if (analysis.objections.length > 0) {
      notes.push(`Objections: ${analysis.objections.join(", ")}`);
    }

    // Sentiment
    notes.push(`Sentiment: ${analysis.sentimentScore}/10`);

    // Transfer status
    if (blandData.transferred_to) {
      notes.push(`Transferred to: ${blandData.transferred_to}`);
    }

    return notes.join(" | ");
  }
}
