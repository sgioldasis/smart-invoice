/**
 * AI Service
 *
 * Provides both Firebase Cloud Functions integration and local prompt parsing
 * for timesheet generation with support for horizontal and vertical Excel layouts.
 *
 * Features:
 * - Cloud-based AI processing via Firebase Functions
 * - Local prompt parsing (no cloud dependency)
 * - Horizontal layout support (days across columns: C13-AG13, hours: C14-AG14)
 * - Vertical layout support (dates in column A, hours in column B)
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { GoogleGenAI, Type } from '@google/genai';

// Initialize Gemini API client
const GEMINI_API_KEY = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || '';
const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

interface ProcessTimesheetPromptRequest {
  prompt: string;
  workingDays: string[];
  clientName?: string;
  month?: string;
  existingMapping?: {
    dateColumn?: string;
    hoursColumn?: string;
    descriptionColumn?: string;
    startRow?: number;
  };
}

interface ProcessTimesheetPromptResponse {
  success: boolean;
  mapping: {
    dateColumn: string;
    hoursColumn: string;
    descriptionColumn?: string;
    startRow: number;
    hoursPerDay: number;
    dateFormat: string;
    instructions: string;
    fillInstructions: Array<{
      type: string;
      column: string;
      description: string;
    }>;
  };
  workingDays: string[];
  error?: string;
  geminiAnalysis?: any;
  fallback?: {
    dateColumn: string;
    hoursColumn: string;
    descriptionColumn?: string;
    startRow: number;
    hoursPerDay: number;
    dateFormat: string;
    instructions: string;
  };
}

const functions = getFunctions();

/**
 * Process a natural language prompt for timesheet generation using AI
 */
export async function processTimesheetPrompt(
  request: ProcessTimesheetPromptRequest
): Promise<ProcessTimesheetPromptResponse> {
  const processPrompt = httpsCallable<
    ProcessTimesheetPromptRequest,
    ProcessTimesheetPromptResponse
  >(functions, 'processTimesheetPrompt');

  try {
    const result = await processPrompt(request);
    return result.data;
  } catch (error) {
    console.error('Error calling processTimesheetPrompt:', error);

    // Return fallback on error
    return {
      success: false,
      mapping: {
        dateColumn: request.existingMapping?.dateColumn || 'A',
        hoursColumn: request.existingMapping?.hoursColumn || 'B',
        descriptionColumn: request.existingMapping?.descriptionColumn,
        startRow: request.existingMapping?.startRow || 2,
        hoursPerDay: 8,
        dateFormat: 'dd/MM/yyyy',
        instructions: 'Using fallback defaults due to AI service error',
        fillInstructions: [],
      },
      workingDays: request.workingDays,
      error: error instanceof Error ? error.message : 'Unknown error',
      fallback: {
        dateColumn: request.existingMapping?.dateColumn || 'A',
        hoursColumn: request.existingMapping?.hoursColumn || 'B',
        descriptionColumn: request.existingMapping?.descriptionColumn,
        startRow: request.existingMapping?.startRow || 2,
        hoursPerDay: 8,
        dateFormat: 'dd/MM/yyyy',
        instructions: 'Using fallback defaults due to AI service error',
      },
    };
  }
}

/**
 * Process timesheet prompt using Gemini API directly
 * This provides better understanding of natural language instructions
 */
export async function processTimesheetPromptWithGemini(
  request: ProcessTimesheetPromptRequest
): Promise<ProcessTimesheetPromptResponse> {
  if (!genAI) {
    console.warn('Gemini API not initialized, falling back to local parsing');
    const localResult = parseTimesheetPromptLocally(request.prompt, request.existingMapping);
    return {
      success: true,
      mapping: {
        ...localResult,
        dateFormat: 'dd/MM/yyyy',
        instructions: 'Using local parsing (Gemini API not available)',
        fillInstructions: [],
      },
      workingDays: request.workingDays,
    };
  }

  try {
    
    const systemPrompt = `You are a helpful assistant that processes timesheet generation instructions.
Analyze the user's prompt and extract the following information:
1. Which cells contain day numbers (e.g., C13 to AG13)
2. Which cells contain work hours (e.g., C14 to AG14)
3. Which cell contains the period display (e.g., C11)
4. How many hours per working day (default: 8)
5. Any specific styling instructions (white background for working days, gray for weekends)

Respond in JSON format with this structure:
{
  "periodCell": "C11",
  "dayNumbersRange": { "start": "C13", "end": "AG13" },
  "hoursRange": { "start": "C14", "end": "AG14" },
  "hoursPerDay": 8,
  "styleRows": { "start": 14, "end": 20 },
  "styling": {
    "workingDayColor": "white",
    "weekendColor": "light gray"
  }
}`;

    const userPrompt = `Client: ${request.clientName || 'Unknown'}
Month: ${request.month || 'Unknown'}
Working days: ${request.workingDays.join(', ')}

User instructions:
${request.prompt}`;

    const result = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'I understand. I will analyze timesheet instructions and respond in the requested JSON format.' }] },
        { role: 'user', parts: [{ text: userPrompt }] },
      ],
    });

    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      throw new Error('No response from Gemini API');
    }

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const parsedResponse = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    if (!parsedResponse) {
      throw new Error('Could not parse Gemini response');
    }

    // Convert to the expected response format
    return {
      success: true,
      mapping: {
        dateColumn: parsedResponse.dayNumbersRange?.start?.match(/[A-Z]+/)?.[0] || 'C',
        hoursColumn: parsedResponse.hoursRange?.start?.match(/[A-Z]+/)?.[0] || 'C',
        startRow: parseInt(parsedResponse.hoursRange?.start?.match(/\d+/)?.[0]) || 14,
        hoursPerDay: parsedResponse.hoursPerDay || 8,
        dateFormat: 'dd/MM/yyyy',
        instructions: `Period: ${parsedResponse.periodCell}, Day numbers: ${parsedResponse.dayNumbersRange?.start}-${parsedResponse.dayNumbersRange?.end}, Hours: ${parsedResponse.hoursRange?.start}-${parsedResponse.hoursRange?.end}`,
        fillInstructions: [
          { type: 'period', column: parsedResponse.periodCell, description: 'Update period display' },
          { type: 'dayNumbers', column: parsedResponse.dayNumbersRange?.start, description: 'Fill day numbers' },
          { type: 'hours', column: parsedResponse.hoursRange?.start, description: 'Fill working hours' },
        ],
      },
      workingDays: request.workingDays,
      geminiAnalysis: parsedResponse,
    };
  } catch (error) {
    // Check if this is a quota/rate limit error (429)
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isQuotaError = errorMessage.includes('429') ||
                         errorMessage.includes('quota') ||
                         errorMessage.includes('RESOURCE_EXHAUSTED') ||
                         errorMessage.includes('rate limit');
    
    if (isQuotaError) {
      console.warn('Gemini API quota exceeded. Falling back to local parsing. Please check your billing plan.');
    } else {
      console.error('Error calling Gemini API:', error);
    }
    // Fall back to local parsing
    const localResult = parseTimesheetPromptLocally(request.prompt, request.existingMapping);
    return {
      success: false,
      mapping: {
        ...localResult,
        dateFormat: 'dd/MM/yyyy',
        instructions: 'Using local parsing due to Gemini API error',
        fillInstructions: [],
      },
      workingDays: request.workingDays,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Parse timesheet prompt locally (fallback when AI is unavailable)
 */
export function parseTimesheetPromptLocally(
  prompt: string,
  existingMapping?: {
    dateColumn?: string;
    hoursColumn?: string;
    descriptionColumn?: string;
    startRow?: number;
  }
): {
  dateColumn: string;
  hoursColumn: string;
  descriptionColumn?: string;
  startRow: number;
  hoursPerDay: number;
} {
  const promptLower = (prompt || '').toLowerCase();

  // Extract column letters from patterns like "column A", "col B", "column C"
  const dateColumnMatch = promptLower.match(
    /date(?:\s+s)?(?:\s+in)?\s+(?:col(?:umn)?\s+)?([a-z])\b/
  );
  const hoursColumnMatch = promptLower.match(
    /hours?(?:\s+in)?\s+(?:col(?:umn)?\s+)?([a-z])\b/
  );
  const descColumnMatch = promptLower.match(
    /(?:desc|description)(?:\s+in)?\s+(?:col(?:umn)?\s+)?([a-z])\b/
  );

  // Extract start row
  const startRowMatch = promptLower.match(
    /(?:start|begin)(?:\s+from)?\s+row\s+(\d+)/
  );

  // Extract hours per day
  const hoursPerDayMatch = promptLower.match(
    /(\d+(?:\.\d+)?)\s+hours?\s+(?:per|each)\s+day/
  );

  return {
    dateColumn: dateColumnMatch
      ? dateColumnMatch[1].toUpperCase()
      : existingMapping?.dateColumn || 'A',
    hoursColumn: hoursColumnMatch
      ? hoursColumnMatch[1].toUpperCase()
      : existingMapping?.hoursColumn || 'B',
    descriptionColumn: descColumnMatch
      ? descColumnMatch[1].toUpperCase()
      : existingMapping?.descriptionColumn,
    startRow: startRowMatch
      ? parseInt(startRowMatch[1])
      : existingMapping?.startRow || 2,
    hoursPerDay: hoursPerDayMatch
      ? parseFloat(hoursPerDayMatch[1])
      : 8,
  };
}

/**
 * Horizontal timesheet layout configuration
 * For templates where days are laid out horizontally across columns
 * (e.g., day numbers in row 13 cells C13-AG13, hours in row 14 cells C14-AG14)
 */
export interface HorizontalTimesheetConfig {
  type: 'horizontal';
  /** Cell reference for period (e.g., "C11") */
  periodCell: string;
  /** Row number for day numbers (e.g., 13) */
  dayNumbersRow: number;
  /** Starting column for day numbers (e.g., "C") */
  dayNumbersStartCol: string;
  /** Ending column for day numbers (e.g., "AG") */
  dayNumbersEndCol: string;
  /** Row number for hours data (e.g., 14) */
  hoursRow: number;
  /** Hours per working day */
  hoursPerDay: number;
}

/**
 * Vertical timesheet layout configuration
 * For templates where each day is a separate row
 */
export interface VerticalTimesheetConfig {
  type: 'vertical';
  /** Column letter for dates */
  dateColumn: string;
  /** Column letter for hours */
  hoursColumn: string;
  /** Optional column letter for descriptions */
  descriptionColumn?: string;
  /** Row number where data starts */
  startRow: number;
  /** Hours per working day */
  hoursPerDay: number;
}

export type TimesheetConfig = HorizontalTimesheetConfig | VerticalTimesheetConfig;

/**
 * Parse timesheet prompt and detect layout type (horizontal or vertical)
 *
 * Handles prompts like:
 * - Horizontal: "Update day numbers (cells c13 to ag13)... Place number 8 in cells c14 to ag14"
 * - Vertical: "Fill dates in column A, hours in column B, start from row 2"
 */
export function parseTimesheetPrompt(prompt: string): TimesheetConfig {
  const promptLower = (prompt || '').toLowerCase();

  // Check for horizontal layout patterns (cells X## to Y##)
  // Matches patterns like "cells c13 to ag13", "c13 to ag13", "c13-ag13"
  const horizontalDayRangeMatch = promptLower.match(
    /(?:cells?\s+)?([a-z]+)(\d+)\s+(?:to|through|-)\s+([a-z]+)(\d+)/i
  );

  // Check for period cell (e.g., "cell C11", "period (cell C11)")
  const periodCellMatch = promptLower.match(
    /(?:period\s+\()?cell\s+([a-z]+\d+)/i
  );

  // Check for hours row pattern (e.g., "cells c14 up to ag14", "c14 to ag14")
  const hoursRowMatch = promptLower.match(
    /(?:hours?\s+\()?cells?\s+([a-z]+)(\d+)\s+(?:up\s+to|to|through|-)\s+([a-z]+)\d+/i
  );

  // Extract hours per day
  const hoursPerDayMatch = promptLower.match(
    /(\d+(?:\.\d+)?)\s+hours?\s+(?:per|each|of\s+work)/i
  );
  const hoursPerDay = hoursPerDayMatch ? parseFloat(hoursPerDayMatch[1]) : 8;

  // Determine if this is a horizontal layout
  const isHorizontalLayout =
    horizontalDayRangeMatch !== null &&
    (promptLower.includes('day numbers') ||
     promptLower.includes('c13') ||
     promptLower.includes('ag13') ||
     promptLower.includes('c14') ||
     promptLower.includes('ag14'));

  if (isHorizontalLayout && horizontalDayRangeMatch) {
    const startCol = horizontalDayRangeMatch[1].toUpperCase();
    const dayRow = parseInt(horizontalDayRangeMatch[2]);
    const endCol = horizontalDayRangeMatch[3].toUpperCase();
    
    // Determine hours row - either from hoursRowMatch or default to dayRow + 1
    const hoursRow = hoursRowMatch
      ? parseInt(hoursRowMatch[2])
      : dayRow + 1;

    // Determine period cell - either from match or default to C11
    const periodCell = periodCellMatch
      ? periodCellMatch[1].toUpperCase()
      : 'C11';

    return {
      type: 'horizontal',
      periodCell,
      dayNumbersRow: dayRow,
      dayNumbersStartCol: startCol,
      dayNumbersEndCol: endCol,
      hoursRow,
      hoursPerDay,
    };
  }

  // Default to vertical layout parsing
  const dateColumnMatch = promptLower.match(
    /date(?:\s+s)?(?:\s+in)?\s+(?:col(?:umn)?\s+)?([a-z])\b/
  );
  const hoursColumnMatch = promptLower.match(
    /hours?(?:\s+in)?\s+(?:col(?:umn)?\s+)?([a-z])\b/
  );
  const descColumnMatch = promptLower.match(
    /(?:desc|description)(?:\s+in)?\s+(?:col(?:umn)?\s+)?([a-z])\b/
  );
  const startRowMatch = promptLower.match(
    /(?:start|begin)(?:\s+from)?\s+row\s+(\d+)/
  );

  return {
    type: 'vertical',
    dateColumn: dateColumnMatch
      ? dateColumnMatch[1].toUpperCase()
      : 'A',
    hoursColumn: hoursColumnMatch
      ? hoursColumnMatch[1].toUpperCase()
      : 'B',
    descriptionColumn: descColumnMatch
      ? descColumnMatch[1].toUpperCase()
      : undefined,
    startRow: startRowMatch
      ? parseInt(startRowMatch[1])
      : 2,
    hoursPerDay,
  };
}

/**
 * Generate cell-by-cell instructions for horizontal timesheet layout
 *
 * @param config - Horizontal timesheet configuration
 * @param year - Year for the timesheet
 * @param month - Month (0-11) for the timesheet
 * @param workingDays - Array of day numbers that are working days
 * @returns Array of cell instructions for the Excel processor
 */
export function generateHorizontalTimesheetInstructions(
  config: HorizontalTimesheetConfig,
  year: number,
  month: number,
  workingDays: number[]
): Array<{
  cell: string;
  value: string | number;
  action: 'set' | 'clear' | 'formula';
}> {
  const instructions: Array<{
    cell: string;
    value: string | number;
    action: 'set' | 'clear' | 'formula';
  }> = [];

  // Get the number of days in the month
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Format period string (e.g., "01-January-2025 -> 31-January-2025")
  const monthName = new Date(year, month).toLocaleString('en-US', { month: 'long' });
  const startDateStr = `01-${monthName}-${year}`;
  const endDateStr = `${daysInMonth}-${monthName}-${year}`;
  const periodValue = `${startDateStr} -> ${endDateStr}`;

  // Update period cell
  instructions.push({
    cell: config.periodCell,
    value: periodValue,
    action: 'set',
  });

  // Calculate column range (supporting both single and double-letter columns)
  const startColNum = columnToNumber(config.dayNumbersStartCol);
  const endColNum = columnToNumber(config.dayNumbersEndCol);

  // STEP 1: Clear ALL cells in the day numbers row and hours row first
  // This ensures no stale data remains from previous months (e.g., day 29-31 in February)
  for (let colNum = startColNum; colNum <= endColNum; colNum++) {
    const colLetter = numberToColumn(colNum);
    const dayCell = `${colLetter}${config.dayNumbersRow}`;
    const hoursCell = `${colLetter}${config.hoursRow}`;

    // Clear day number cell
    instructions.push({
      cell: dayCell,
      value: '',
      action: 'clear',
    });

    // Clear hours cell
    instructions.push({
      cell: hoursCell,
      value: '',
      action: 'clear',
    });
  }

  // STEP 2: Set day numbers and hours only for valid days of the current month
  let dayCounter = 1;
  for (let colNum = startColNum; colNum <= endColNum && dayCounter <= daysInMonth; colNum++) {
    const colLetter = numberToColumn(colNum);
    const dayCell = `${colLetter}${config.dayNumbersRow}`;
    const hoursCell = `${colLetter}${config.hoursRow}`;

    // Set day number
    instructions.push({
      cell: dayCell,
      value: dayCounter,
      action: 'set',
    });

    // Set hours for working days only (non-working days remain cleared from step 1)
    if (workingDays.includes(dayCounter)) {
      instructions.push({
        cell: hoursCell,
        value: config.hoursPerDay,
        action: 'set',
      });
    }

    dayCounter++;
  }

  return instructions;
}

/**
 * Column letter to number conversion (A=1, B=2, ..., Z=26, AA=27, etc.)
 */
function columnToNumber(col: string): number {
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result;
}

/**
 * Number to column letter conversion (1=A, 2=B, ..., 26=Z, 27=AA, etc.)
 */
function numberToColumn(num: number): string {
  let result = '';
  while (num > 0) {
    num--;
    result = String.fromCharCode('A'.charCodeAt(0) + (num % 26)) + result;
    num = Math.floor(num / 26);
  }
  return result;
}

/**
 * Standard timesheet prompt template for horizontal Excel layouts
 *
 * This is the canonical prompt for timesheets with:
 * - Period display in a single cell (e.g., C11)
 * - Day numbers across columns in a row (e.g., C13 to AG13)
 * - Work hours in the row below (e.g., C14 to AG14)
 *
 * Usage:
 * ```typescript
 * const prompt = TIMESHEET_PROMPT_TEMPLATE;
 * // Or customize: TIMESHEET_PROMPT_TEMPLATE.replace('8 hours', '7.5 hours')
 * ```
 */
export const TIMESHEET_PROMPT_TEMPLATE = `Update Timesheet period (cell C11) according to the current month (eg. 01-January-2025 -> 31-January-2025).
Delete all existing day numbers (cells c13 to ag13). Update the day numbers (cells c13 to ag13) to contain the day number of the days of the current month (c13 always 1).
Delete existing work hours (cells c14 up to ag14).
Place number 8 (8 hours of work) in the data row (cells c14 up to ag14) for each of the working days.
Do NOT add any extra rows or columns.
Finally, use a white background for working days (any working date columns rows 14-20) and a light gray background for weekends (any weekend date columns rows 14-20)`;

/**
 * Parses style instructions from timesheet prompt
 * Extracts:
 * - working day style cell reference
 * - weekend style cell reference
 * - row range for applying styles
 */
export interface StyleInstructions {
  workingDayStyleCell?: string;
  weekendStyleCell?: string;
  styleRowStart?: number;
  styleRowEnd?: number;
}

/**
 * Parse style instructions from the prompt
 */
export function parseStyleInstructions(prompt: string): StyleInstructions {
  const promptLower = prompt.toLowerCase();
  
  // Extract style cell references
  const workingDayStyleMatch = promptLower.match(/style from template cell\s+([a-z]+\d+).*?working days/i);
  const weekendStyleMatch = promptLower.match(/style from template cell\s+([a-z]+\d+).*?weekends/i);
  
  // Parse row range (e.g., "rows 14-20" or "rows 14 to 20")
  const styleRowRangeMatch = promptLower.match(/rows?\s+(\d+)(?:\s*-\s*|\s+to\s+)(\d+)/i);
  
  return {
    workingDayStyleCell: workingDayStyleMatch ? workingDayStyleMatch[1].toUpperCase() : undefined,
    weekendStyleCell: weekendStyleMatch ? weekendStyleMatch[1].toUpperCase() : undefined,
    styleRowStart: styleRowRangeMatch ? parseInt(styleRowRangeMatch[1]) : undefined,
    styleRowEnd: styleRowRangeMatch ? parseInt(styleRowRangeMatch[2]) : undefined,
  };
}

/**
 * Predefined configuration for standard horizontal timesheet template
 * Matches the TIMESHEET_PROMPT_TEMPLATE structure
 */
export const STANDARD_HORIZONTAL_CONFIG: HorizontalTimesheetConfig = {
  type: 'horizontal',
  periodCell: 'C11',
  dayNumbersRow: 13,
  dayNumbersStartCol: 'C',
  dayNumbersEndCol: 'AG',
  hoursRow: 14,
  hoursPerDay: 8,
};

/**
 * Check if a prompt matches the standard horizontal timesheet format
 * Useful for UI hints or auto-detection
 */
/**
 * Main entry point for processing timesheet prompts
 * Tries Gemini API first, falls back to local parsing
 */
export async function processTimesheetPromptSmart(
  request: ProcessTimesheetPromptRequest
): Promise<ProcessTimesheetPromptResponse> {
  // Try Gemini API first if available
  if (genAI && GEMINI_API_KEY) {
    try {
      const result = await processTimesheetPromptWithGemini(request);
      if (result.success) {
        return result;
      }
    } catch (error) {
      console.warn('Gemini API failed, falling back to local parsing:', error);
    }
  }
  
  // Fall back to local parsing
  const localResult = parseTimesheetPromptLocally(request.prompt, request.existingMapping);
  return {
    success: true,
    mapping: {
      ...localResult,
      dateFormat: 'dd/MM/yyyy',
      instructions: 'Using local parsing',
      fillInstructions: [],
    },
    workingDays: request.workingDays,
  };
}

export function isStandardHorizontalPrompt(prompt: string): boolean {
  const normalized = (prompt || '').toLowerCase().replace(/\s+/g, ' ').trim();

  // Check for key identifying markers
  return (
    normalized.includes('c11') &&
    normalized.includes('c13') &&
    normalized.includes('ag13') &&
    normalized.includes('c14') &&
    normalized.includes('ag14') &&
    normalized.includes('period')
  );
}
