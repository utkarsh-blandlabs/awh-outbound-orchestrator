import { ClientConfig } from "../types";
import { defaultConfig } from "./default";

/**
 * AWH-specific config.
 * Inherits defaults and overrides what's needed.
 */
export const awhConfig: ClientConfig = {
  ...defaultConfig,
  name: "AWH",
  blandApiKey: process.env["BLAND_API_KEY"],
  categorizers: {
    ...defaultConfig.categorizers,
    transferred: {
      requireMergedState: true, // AWH uses warm_transfer_call.state === "MERGED"
    },
  },
};
