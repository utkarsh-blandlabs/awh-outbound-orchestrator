/**
 * Timezone Helper
 * Determines lead's timezone based on state or zip code for TCPA compliance
 */

// State to timezone mapping
const STATE_TIMEZONE_MAP: { [key: string]: string } = {
  // Eastern Time
  CT: "America/New_York",
  DE: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  NH: "America/New_York",
  NJ: "America/New_York",
  NY: "America/New_York",
  NC: "America/New_York",
  OH: "America/New_York",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  VT: "America/New_York",
  VA: "America/New_York",
  WV: "America/New_York",

  // Central Time
  AL: "America/Chicago",
  AR: "America/Chicago",
  IL: "America/Chicago",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/Chicago",
  LA: "America/Chicago",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  NE: "America/Chicago",
  OK: "America/Chicago",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  WI: "America/Chicago",

  // Mountain Time
  AZ: "America/Phoenix", // Arizona doesn't observe DST
  CO: "America/Denver",
  ID: "America/Denver",
  MT: "America/Denver",
  NM: "America/Denver",
  UT: "America/Denver",
  WY: "America/Denver",

  // Pacific Time
  CA: "America/Los_Angeles",
  NV: "America/Los_Angeles",
  OR: "America/Los_Angeles",
  WA: "America/Los_Angeles",

  // Alaska Time
  AK: "America/Anchorage",

  // Hawaii Time
  HI: "America/Honolulu",
};

/**
 * Get timezone for a lead based on state
 * Falls back to EST if state is unknown
 */
export function getTimezoneByState(state: string | undefined): string {
  if (!state) {
    return "America/New_York"; // Default to EST
  }

  const upperState = state.toUpperCase().trim();
  return STATE_TIMEZONE_MAP[upperState] || "America/New_York";
}

/**
 * Get current time in a specific timezone
 * Returns Date object
 */
export function getCurrentTimeInTimezone(timezone: string): Date {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const year = parseInt(parts.find((p) => p.type === "year")?.value || "0");
  const month = parseInt(parts.find((p) => p.type === "month")?.value || "1") - 1;
  const day = parseInt(parts.find((p) => p.type === "day")?.value || "1");
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
  const second = parseInt(parts.find((p) => p.type === "second")?.value || "0");

  return new Date(year, month, day, hour, minute, second);
}

/**
 * Get current hour in a specific timezone (0-23)
 */
export function getCurrentHourInTimezone(timezone: string): number {
  const time = getCurrentTimeInTimezone(timezone);
  return time.getHours();
}

/**
 * Get current day of week in a specific timezone (0=Sunday, 6=Saturday)
 */
export function getCurrentDayOfWeekInTimezone(timezone: string): number {
  const time = getCurrentTimeInTimezone(timezone);
  return time.getDay();
}

/**
 * Check if current day is a weekend in the given timezone
 */
export function isWeekendInTimezone(timezone: string): boolean {
  const dayOfWeek = getCurrentDayOfWeekInTimezone(timezone);
  return dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
}

/**
 * Calculate time until next valid sending window
 * Returns milliseconds until next valid time
 */
export function getMillisecondsUntilNextValidTime(
  timezone: string,
  startHour: number,
  endHour: number
): number {
  const now = getCurrentTimeInTimezone(timezone);
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // If currently within valid hours and not weekend
  if (
    currentHour >= startHour &&
    currentHour < endHour &&
    !isWeekendInTimezone(timezone)
  ) {
    return 0; // Can send now
  }

  // Calculate next valid time
  let nextValidTime = new Date(now);

  // If weekend, move to next Monday
  if (isWeekendInTimezone(timezone)) {
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
    nextValidTime.setDate(now.getDate() + daysUntilMonday);
    nextValidTime.setHours(startHour, 0, 0, 0);
  }
  // If after valid hours today, move to tomorrow at start hour
  else if (currentHour >= endHour) {
    nextValidTime.setDate(now.getDate() + 1);
    nextValidTime.setHours(startHour, 0, 0, 0);

    // Check if tomorrow is weekend
    if (nextValidTime.getDay() === 0 || nextValidTime.getDay() === 6) {
      const daysUntilMonday = nextValidTime.getDay() === 0 ? 1 : 2;
      nextValidTime.setDate(nextValidTime.getDate() + daysUntilMonday);
    }
  }
  // Before valid hours today, move to start hour today
  else {
    nextValidTime.setHours(startHour, 0, 0, 0);
  }

  return nextValidTime.getTime() - now.getTime();
}
