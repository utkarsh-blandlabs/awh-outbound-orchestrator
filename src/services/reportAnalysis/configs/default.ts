import { ClientConfig } from "../types";

/**
 * Default config - works for most clients.
 * Override per-client by spreading and overriding specific fields.
 */
export const defaultConfig: ClientConfig = {
  name: "default",
  categorizers: {
    voicemail: {
      monologueThresholdSec: 15,
      minMonologueHellos: 2,
    },
    humanAnswered: {
      minTranscriptLength: 50,
      minDurationSec: 20,
    },
    transferred: {
      requireMergedState: true,
    },
    noAnswer: {
      maxDurationSec: 5,
    },
  },
};
