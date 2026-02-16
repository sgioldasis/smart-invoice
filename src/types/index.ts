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
  templateName?: string;
  templateBase64?: string;
  mapping: CellMapping;
  defaultUseGreekHolidays?: boolean;
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
  /** Whether to automatically exclude weekends */
  autoExcludedWeekends: boolean;
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
  holidayNames?: Record<string, string>;
  config: WorkRecordConfig;
  notes?: string;
  totalWorkingDays: number;
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
  dailyRate: number; // Rate at time of generation
  totalAmount: number;

  // Document metadata
  generatedAt: string; // ISO timestamp
  fileName?: string;

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
  dailyRate: number;
  totalAmount: number;
  fileName?: string;
  isPaid?: boolean;
  paidAt?: string;
  isOutdated?: boolean;
  outdatedAt?: string | null;
}

// ============================================
// Legacy Types (to be deprecated)
// ============================================

/**
 * @deprecated Use WorkRecord and Document instead
 */
export interface InvoiceRecord {
  id: string;
  userId: string;
  clientId: string;
  month: string; // YYYY-MM
  excludedDates: string[]; // ISO strings
  includedDates?: string[]; // ISO strings
  useGreekHolidays: boolean;
  manualAdjustment: number;
  status: 'draft' | 'generated';
  invoiceNumber?: string;
  generatedDate?: string;
  totalAmount?: number;
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
