// SmartInvoice Type Definitions

// ============================================
// Cell Mapping Types
// ============================================

export interface CellMapping {
  date: string;
  invoiceNumber: string;
  description: string;
  daysWorked: string;
  dailyRate: string;
  totalAmount: string;
}

/**
 * Timesheet column mapping configuration
 * Used to fill existing cells in the template without adding/removing rows or columns
 */
export interface TimesheetMapping {
  dateColumn?: string;      // Column letter for dates (e.g., 'A')
  hoursColumn?: string;     // Column letter for hours (e.g., 'B')
  descriptionColumn?: string;  // Optional column letter for descriptions (e.g., 'C')
  startRow?: number;        // Row number where data starts (default: 2 to skip header)
}

// ============================================
// Template Types (NEW)
// ============================================

export interface Template {
  id: string;
  userId: string;
  clientId: string;
  type: 'invoice' | 'timesheet';
  name: string;
  fileName: string;
  base64Data: string;
  mapping?: CellMapping;          // For invoice templates
  timesheetMapping?: TimesheetMapping;  // For timesheet templates
  timesheetPrompt?: string;       // For timesheet templates
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Client Types
// ============================================

export interface Client {
  id: string;
  userId: string; // Owner of this client
  name: string; // The Client's Name (Bill To)
  issuerName?: string; // The User's Name (From)
  issuerDetails?: string; // Address/Tax/Bank for PDF Header/Footer
  dailyRate: number;
  currency: string;
  mapping: CellMapping;
  defaultUseGreekHolidays?: boolean;
  // Template references (new structure)
  invoiceTemplateId?: string;     // Reference to template doc
  timesheetTemplateId?: string;   // Reference to template doc
  // Legacy fields (kept for migration compatibility)
  templateName?: string;
  templateBase64?: string;
  timesheetTemplateName?: string;
  timesheetTemplateBase64?: string;
  timesheetPrompt?: string;
  timesheetMapping?: TimesheetMapping;
  timesheetTemplateFileName?: string;
}

// ============================================
// Work Record Types (NEW)
// ============================================

/**
 * Configuration for calculating a work record
 * These are INPUT parameters that determine which days are working days
 */
export interface WorkRecordConfig {
  /** Whether to exclude Greek public holidays */
  useGreekHolidays: boolean;
  /** Dates manually excluded (e.g., personal leave days) */
  excludedDates: string[];
  /** Dates manually included (e.g., working weekends/holidays) */
  includedDates: string[];
}

/**
 * Work Record - The core entity representing days worked in a month
 * 
 * Design principle: workingDays is the STORED FACT (canonical source of truth).
 * The config object stores how this fact was derived, enabling reproducibility
 * and editing capabilities.
 */
export interface WorkRecord {
  id: string;
  userId: string;
  clientId: string;
  month: string; // YYYY-MM format

  // STORED FACT: Explicit list of working days (ISO date strings: YYYY-MM-DD)
  // This is the canonical source of truth for days worked
  workingDays: string[];

  // DISPLAY METADATA: Holiday names for UI display purposes only
  // Map of date -> holiday name (e.g., {"2024-03-25": "Independence Day"})
  holidayNames?: Record<string, string>;

  // ALL weekend dates in the month (ISO date strings: YYYY-MM-DD)
  // Stored once at creation so we don't need to recalculate
  weekendDates: string[];

  // CONFIGURATION: How workingDays was calculated
  // These are INPUT parameters, not the stored fact
  config: WorkRecordConfig;

  // User notes about this work period
  notes?: string;

  // Metadata
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp

  // Calculated fields (stored for performance)
  totalWorkingDays: number;
}

/**
 * Input type for creating/updating a work record
 * Omits system-generated fields
 */
export interface WorkRecordInput {
  clientId: string;
  month: string;
  workingDays: string[];
  weekendDates: string[];
  holidayNames?: Record<string, string>;
  config: WorkRecordConfig;
  notes?: string;
  totalWorkingDays: number;
}

// ============================================
// Timesheet Types (NEW)
// ============================================

/**
 * Timesheet template override for a specific work record/month
 * Allows uploading a different template for a specific month
 */
export interface WorkRecordTimesheet {
  id: string;
  userId: string;
  clientId: string;
  workRecordId: string; // Link to the work record
  month: string; // YYYY-MM format
  
  // Month-specific template (optional - falls back to client's default)
  templateName?: string;
  templateBase64?: string;
  
  // Month-specific prompt (optional - falls back to client's default)
  prompt?: string;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
}

/**
 * Input type for creating/updating a work record timesheet
 */
export interface WorkRecordTimesheetInput {
  clientId: string;
  workRecordId: string;
  month: string;
  templateName?: string | null;
  templateBase64?: string | null;
  prompt?: string | null;
}

// ============================================
// Document Types (NEW - replaces InvoiceRecord)
// ============================================

export type DocumentType = 'invoice' | 'timesheet';

/**
 * Document - A generated artifact (invoice, timesheet, etc.)
 * 
 * Documents are immutable snapshots of a work record at the time of generation.
 * They link to a work record but store their own copy of the data for historical accuracy.
 */
export interface Document {
  id: string;
  userId: string;
  clientId: string;
  workRecordId: string; // Link to the work record

  type: DocumentType;
  documentNumber: string; // Invoice # or Timesheet #

  // Snapshot of work data at generation time (immutable)
  month: string;
  workingDays: number; // Count of days
  workingDaysArray: string[]; // Array of ISO date strings (YYYY-MM-DD) used at generation time
  weekendDatesArray?: string[]; // Array of weekend dates in the month for outdated detection
  dailyRate: number; // Rate at time of generation
  totalAmount: number;

  // Document metadata
  generatedAt: string; // ISO timestamp
  fileName?: string;

  // File data for download
  fileData?: string; // Base64 encoded Excel file

  // Invoice-specific fields
  isPaid?: boolean;
  paidAt?: string;

  // Outdated flag - set when work record is updated after document generation
  isOutdated?: boolean;
  outdatedAt?: string; // ISO timestamp when marked as outdated
}

/**
 * Input type for creating a document
 */
export interface DocumentInput {
  clientId: string;
  workRecordId: string;
  type: DocumentType;
  documentNumber: string;
  month: string;
  workingDays: number;
  workingDaysArray: string[];
  weekendDatesArray?: string[];
  dailyRate: number;
  totalAmount: number;
  fileName?: string;
  fileData?: string; // Base64 encoded Excel file
  isPaid?: boolean;
  paidAt?: string;
  isOutdated?: boolean;
  outdatedAt?: string | null;
}

// ============================================
// AI Analysis Types
// ============================================

export interface AnalysisResult {
  mapping: Partial<CellMapping>;
  metadata: {
    clientName?: string;
    issuerName?: string;
    currency?: string;
    dailyRate?: number;
  };
}

// ============================================
// UI/Component Types
// ============================================

export interface WorkDayStatus {
  date: Date;
  dateStr: string; // YYYY-MM-DD
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName?: string;
  isWorking: boolean;
  isManuallyExcluded: boolean;
  isManuallyIncluded: boolean;
}

export interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  status: WorkDayStatus;
}
