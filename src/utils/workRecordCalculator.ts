/**
 * Work Record Calculator
 * 
 * This module handles the transformation from configuration to stored fact:
 * Configuration (useGreekHolidays, excludedDates, etc.) → Calculation → workingDays[]
 * 
 * The workingDays array is the canonical source of truth and is what gets stored.
 * The configuration is preserved for reproducibility and editing purposes.
 */

import { format, isWeekend, getDaysInMonth, parseISO, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';

// ============================================
// Types
// ============================================

export interface WorkRecordConfig {
  useGreekHolidays: boolean;
  excludedDates: string[];   // ISO dates: YYYY-MM-DD
  includedDates: string[];   // ISO dates: YYYY-MM-DD
  autoExcludedWeekends: boolean;
}

export interface WorkDayStatus {
  date: Date;
  dateStr: string;           // YYYY-MM-DD
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName?: string;
  isWorking: boolean;
  isManuallyExcluded: boolean;
  isManuallyIncluded: boolean;
}

export interface CalculationResult {
  workingDays: string[];     // ISO dates that are working days
  holidayNames: Record<string, string>;  // Map of date -> holiday name
  dayStatuses: WorkDayStatus[];  // Full status for each day in month
  totalWorkingDays: number;
}

// ============================================
// Holiday Cache
// ============================================

const holidaysCache: Record<number, Record<string, string>> = {};

/**
 * Fetch Greek holidays for a given year
 */
export const fetchGreekHolidays = async (year: number): Promise<Record<string, string>> => {
  if (holidaysCache[year]) return holidaysCache[year];

  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/GR`);
    if (!res.ok) throw new Error('Failed to fetch holidays');
    const data = await res.json();
    const map: Record<string, string> = {};
    if (Array.isArray(data)) {
      data.forEach((h: any) => {
        map[h.date] = h.localName || h.name;
      });
    }
    holidaysCache[year] = map;
    return map;
  } catch (err) {
    console.error('Failed to fetch Greek holidays', err);
    holidaysCache[year] = {};
    return {};
  }
};

/**
 * Get holiday name for a specific date (synchronous, uses cache)
 */
export const getHolidayName = (date: Date): string | undefined => {
  const year = date.getFullYear();
  const dateStr = format(date, 'yyyy-MM-dd');
  return holidaysCache[year]?.[dateStr];
};

/**
 * Check if a date is a holiday (synchronous, uses cache)
 */
export const isHoliday = (date: Date): boolean => {
  return !!getHolidayName(date);
};

// ============================================
// Core Calculation Logic
// ============================================

/**
 * Calculate working days for a given month and configuration
 * 
 * This is the core function that transforms configuration into the stored fact.
 * 
 * @param monthStr - Month in YYYY-MM format
 * @param config - Work record configuration
 * @returns Calculation result with working days and metadata
 */
export function calculateWorkingDays(
  monthStr: string,
  config: WorkRecordConfig
): CalculationResult {
  const year = parseInt(monthStr.split('-')[0], 10);
  const month = parseInt(monthStr.split('-')[1], 10) - 1; // 0-indexed

  // Get all days in the month
  const start = startOfMonth(new Date(year, month));
  const end = endOfMonth(new Date(year, month));
  const allDays = eachDayOfInterval({ start, end });

  const workingDays: string[] = [];
  const holidayNames: Record<string, string> = {};
  const dayStatuses: WorkDayStatus[] = [];

  for (const day of allDays) {
    const dateStr = format(day, 'yyyy-MM-dd');
    const isWeekendDay = isWeekend(day);
    const holidayName = getHolidayName(day);
    const isHolidayDay = !!holidayName;

    // Check manual overrides (these take precedence)
    const isManuallyExcluded = config.excludedDates.includes(dateStr);
    const isManuallyIncluded = config.includedDates.includes(dateStr);

    // Determine if this is a working day
    let isWorking = false;

    if (isManuallyIncluded) {
      // Manual override: force include (e.g., working weekend)
      isWorking = true;
    } else if (isManuallyExcluded) {
      // Manual override: force exclude (e.g., personal leave)
      isWorking = false;
    } else if (isHolidayDay) {
      // Holiday: not working (unless manually included above)
      isWorking = false;
      holidayNames[dateStr] = holidayName;
    } else if (isWeekendDay && config.autoExcludedWeekends) {
      // Weekend: not working (unless manually included above)
      isWorking = false;
    } else {
      // Normal weekday: working
      isWorking = true;
    }

    // Record the status for this day
    dayStatuses.push({
      date: day,
      dateStr,
      isWeekend: isWeekendDay,
      isHoliday: isHolidayDay,
      holidayName,
      isWorking,
      isManuallyExcluded,
      isManuallyIncluded,
    });

    // Add to working days list if applicable
    if (isWorking) {
      workingDays.push(dateStr);
    }
  }

  return {
    workingDays,
    holidayNames,
    dayStatuses,
    totalWorkingDays: workingDays.length,
  };
}

/**
 * Calculate working days asynchronously (fetches holidays if needed)
 * 
 * Use this when you need to ensure holidays are loaded before calculating.
 */
export async function calculateWorkingDaysAsync(
  monthStr: string,
  config: WorkRecordConfig
): Promise<CalculationResult> {
  const year = parseInt(monthStr.split('-')[0], 10);

  // Ensure holidays are loaded if needed
  if (config.useGreekHolidays && !holidaysCache[year]) {
    await fetchGreekHolidays(year);
  }

  return calculateWorkingDays(monthStr, config);
}

// ============================================
// Utility Functions
// ============================================

/**
 * Toggle a day's status between working and non-working
 * Returns the updated configuration
 */
export function toggleDayInConfig(
  config: WorkRecordConfig,
  dateStr: string,
  defaultIsWorking: boolean
): WorkRecordConfig {
  const newConfig = { ...config };

  if (defaultIsWorking) {
    // Day is normally working, so we need to exclude it
    if (newConfig.includedDates.includes(dateStr)) {
      // It was manually included, remove that
      newConfig.includedDates = newConfig.includedDates.filter(d => d !== dateStr);
    } else {
      // Add to excluded
      newConfig.excludedDates = [...newConfig.excludedDates, dateStr];
    }
  } else {
    // Day is normally non-working, so we need to include it
    if (newConfig.excludedDates.includes(dateStr)) {
      // It was manually excluded, remove that
      newConfig.excludedDates = newConfig.excludedDates.filter(d => d !== dateStr);
    } else {
      // Add to included
      newConfig.includedDates = [...newConfig.includedDates, dateStr];
    }
  }

  return newConfig;
}

/**
 * Get the default configuration for a work record
 */
export function getDefaultConfig(useGreekHolidays: boolean = false): WorkRecordConfig {
  return {
    useGreekHolidays,
    excludedDates: [],
    includedDates: [],
    autoExcludedWeekends: true,
  };
}

/**
 * Check if a date is a working day based on current configuration
 * (synchronous version, requires holidays to be pre-loaded)
 */
export function isWorkingDay(
  date: Date,
  config: WorkRecordConfig
): boolean {
  const dateStr = format(date, 'yyyy-MM-dd');
  const isWeekendDay = isWeekend(date);
  const isHolidayDay = isHoliday(date);

  const isManuallyExcluded = config.excludedDates.includes(dateStr);
  const isManuallyIncluded = config.includedDates.includes(dateStr);

  if (isManuallyIncluded) return true;
  if (isManuallyExcluded) return false;
  if (isHolidayDay) return false;
  if (isWeekendDay && config.autoExcludedWeekends) return false;
  return true;
}

/**
 * Format a month string for display
 */
export function formatMonthDisplay(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1);
  return format(date, 'MMMM yyyy');
}

/**
 * Get all months between two dates (inclusive)
 */
export function getMonthsInRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  const [startYear, startMonthNum] = startMonth.split('-').map(Number);
  const [endYear, endMonthNum] = endMonth.split('-').map(Number);

  let currentYear = startYear;
  let currentMonth = startMonthNum;

  while (
    currentYear < endYear ||
    (currentYear === endYear && currentMonth <= endMonthNum)
  ) {
    months.push(`${currentYear}-${String(currentMonth).padStart(2, '0')}`);
    currentMonth++;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear++;
    }
  }

  return months;
}