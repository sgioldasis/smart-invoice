/**
 * Migration Utility for Phase 4
 * 
 * Converts existing InvoiceRecord data to the new WorkRecord + Document structure.
 * This is a one-time migration that should be run after deploying the new code.
 */

import type { InvoiceRecord, WorkRecordInput, DocumentInput } from '../types';
import { calculateWorkingDays } from './workRecordCalculator';

/**
 * Migration result with statistics
 */
export interface MigrationResult {
  success: boolean;
  workRecordsCreated: number;
  documentsCreated: number;
  workRecordsSkipped: number;
  errors: string[];
  details: {
    invoiceId: string;
    workRecordId?: string;
    documentId?: string;
    status: 'success' | 'partial' | 'failed' | 'skipped';
    error?: string;
  }[];
}

/**
 * Convert old InvoiceRecord to new WorkRecordInput
 */
export function convertInvoiceToWorkRecord(
  invoice: InvoiceRecord,
  clientDailyRate: number,
  clientCurrency: string
): Omit<WorkRecordInput, 'userId'> & { userId: string } {
  const [year, month] = invoice.month.split('-').map(Number);
  
  // Calculate working days from the old invoice data
  // Old structure: excludedDates (non-working) + includedDates (forced working)
  // New structure: workingDays array
  const daysInMonth = new Date(year, month, 0).getDate();
  const workingDays: string[] = [];
  
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${invoice.month}-${String(day).padStart(2, '0')}`;
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    // Check if explicitly excluded
    const isExcluded = invoice.excludedDates?.some(excluded => 
      excluded.startsWith(dateStr)
    ) ?? false;
    
    // Check if explicitly included (forced working day)
    const isIncluded = invoice.includedDates?.some(included => 
      included.startsWith(dateStr)
    ) ?? false;
    
    // Determine if working day
    let isWorking = false;
    
    if (isIncluded) {
      // Explicitly forced to working
      isWorking = true;
    } else if (isExcluded) {
      // Explicitly excluded
      isWorking = false;
    } else if (isWeekend) {
      // Weekend and not forced to work
      isWorking = false;
    } else {
      // Weekday - check if it's a Greek holiday (if enabled)
      if (invoice.useGreekHolidays) {
        // Note: We can't know the exact holiday names without fetching them
        // The work record will have empty holidayNames for migrated data
        // This is acceptable as the workingDays array is the canonical fact
        isWorking = true; // Assume working, holiday check was done at generation time
      } else {
        isWorking = true;
      }
    }
    
    if (isWorking) {
      workingDays.push(dateStr);
    }
  }
  
  // Calculate total working days
  const totalWorkingDays = workingDays.length;
  
  return {
    userId: invoice.userId,
    clientId: invoice.clientId,
    month: invoice.month,
    workingDays,
    totalWorkingDays,
    config: {
      useGreekHolidays: invoice.useGreekHolidays,
      // We don't have the original excluded/included dates, set empty arrays
      excludedDates: [],
      includedDates: invoice.includedDates || [],
      autoExcludedWeekends: true, // Default assumption
    },
    holidayNames: {}, // Cannot recover exact holiday names from old data
    notes: `Migrated from legacy invoice #${invoice.invoiceNumber || 'unknown'}`,
  };
}

/**
 * Convert old InvoiceRecord to DocumentInput (if it was generated)
 */
export function convertInvoiceToDocument(
  invoice: InvoiceRecord,
  workRecordId: string,
  clientDailyRate: number,
  clientCurrency: string
): DocumentInput | null {
  // Only convert generated invoices
  if (invoice.status !== 'generated') {
    return null;
  }
  
  const workingDays = invoice.totalAmount 
    ? Math.round(invoice.totalAmount / clientDailyRate)
    : 0;
  
  // For migrated documents, we don't have the exact working days array
  // We'll use an empty array to indicate this is a migrated document
  // The outdated logic will treat missing arrays as needing comparison
  const workingDaysArray: string[] = [];
  
  return {
    clientId: invoice.clientId,
    workRecordId,
    type: 'invoice',
    documentNumber: invoice.invoiceNumber || '000',
    month: invoice.month,
    workingDays,
    workingDaysArray,
    dailyRate: clientDailyRate,
    totalAmount: invoice.totalAmount || 0,
    fileName: `Invoice_${invoice.invoiceNumber}_${invoice.month}_migrated.xlsx`,
  };
}

/**
 * Run migration for a single invoice
 */
export async function migrateInvoice(
  invoice: InvoiceRecord,
  clientDailyRate: number,
  clientCurrency: string,
  saveWorkRecord: (wr: WorkRecordInput) => Promise<{ id: string }>,
  saveDocument: (doc: DocumentInput) => Promise<{ id: string }>,
  getExistingWorkRecord: (clientId: string, month: string) => Promise<{ id: string } | null>
): Promise<{
  workRecordId?: string;
  documentId?: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  error?: string;
}> {
  try {
    // Step 1: Check if work record already exists for this client/month
    const existingWorkRecord = await getExistingWorkRecord(invoice.clientId, invoice.month);
    
    if (existingWorkRecord) {
      // Work record already exists - just create document if needed
      let documentId: string | undefined;
      
      if (invoice.status === 'generated' && invoice.invoiceNumber) {
        const documentInput = convertInvoiceToDocument(
          invoice,
          existingWorkRecord.id,
          clientDailyRate,
          clientCurrency
        );
        
        if (documentInput) {
          const document = await saveDocument(documentInput);
          documentId = document.id;
        }
      }
      
      return {
        workRecordId: existingWorkRecord.id,
        documentId,
        status: 'skipped', // Work record already existed
      };
    }
    
    // Step 2: Create WorkRecord (no existing one found)
    const workRecordInput = convertInvoiceToWorkRecord(
      invoice,
      clientDailyRate,
      clientCurrency
    );
    
    const workRecord = await saveWorkRecord(workRecordInput);
    
    // Step 3: Create Document if invoice was generated
    let documentId: string | undefined;
    
    if (invoice.status === 'generated' && invoice.invoiceNumber) {
      const documentInput = convertInvoiceToDocument(
        invoice,
        workRecord.id,
        clientDailyRate,
        clientCurrency
      );
      
      if (documentInput) {
        const document = await saveDocument(documentInput);
        documentId = document.id;
      }
    }
    
    return {
      workRecordId: workRecord.id,
      documentId,
      status: documentId ? 'success' : 'partial',
    };
  } catch (err: any) {
    return {
      status: 'failed',
      error: err?.message || 'Unknown error during migration',
    };
  }
}

/**
 * Run batch migration for all invoices
 */
export async function runMigration(
  invoices: InvoiceRecord[],
  getClientRate: (clientId: string) => { dailyRate: number; currency: string },
  saveWorkRecord: (wr: WorkRecordInput) => Promise<{ id: string }>,
  saveDocument: (doc: DocumentInput) => Promise<{ id: string }>,
  getExistingWorkRecord: (clientId: string, month: string) => Promise<{ id: string } | null>,
  onProgress?: (current: number, total: number) => void
): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    workRecordsCreated: 0,
    documentsCreated: 0,
    workRecordsSkipped: 0,
    errors: [],
    details: [],
  };
  
  for (let i = 0; i < invoices.length; i++) {
    const invoice = invoices[i];
    
    try {
      // Get client rate
      const client = getClientRate(invoice.clientId);
      
      if (!client) {
        throw new Error(`Client not found: ${invoice.clientId}`);
      }
      
      // Migrate
      const migrationResult = await migrateInvoice(
        invoice,
        client.dailyRate,
        client.currency,
        saveWorkRecord,
        saveDocument,
        getExistingWorkRecord
      );
      
      // Track results
      if (migrationResult.status === 'skipped') {
        result.workRecordsSkipped++;
      } else if (migrationResult.workRecordId) {
        result.workRecordsCreated++;
      }
      if (migrationResult.documentId) {
        result.documentsCreated++;
      }
      
      result.details.push({
        invoiceId: invoice.id,
        workRecordId: migrationResult.workRecordId,
        documentId: migrationResult.documentId,
        status: migrationResult.status,
        error: migrationResult.error,
      });
      
      if (migrationResult.error) {
        result.errors.push(`Invoice ${invoice.id}: ${migrationResult.error}`);
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error';
      result.errors.push(`Invoice ${invoice.id}: ${errorMsg}`);
      result.details.push({
        invoiceId: invoice.id,
        status: 'failed',
        error: errorMsg,
      });
    }
    
    // Report progress
    onProgress?.(i + 1, invoices.length);
  }
  
  result.success = result.errors.length === 0;
  return result;
}

/**
 * Preview migration without saving
 */
export function previewMigration(
  invoices: InvoiceRecord[],
  getClientRate: (clientId: string) => { dailyRate: number; currency: string } | null
): {
  totalInvoices: number;
  wouldCreateWorkRecords: number;
  wouldCreateDocuments: number;
  sample: {
    invoiceId: string;
    month: string;
    workingDays: number;
    status: string;
  }[];
} {
  const sample: {
    invoiceId: string;
    month: string;
    workingDays: number;
    status: string;
  }[] = [];
  
  let wouldCreateWorkRecords = 0;
  let wouldCreateDocuments = 0;
  
  for (const invoice of invoices.slice(0, 5)) {
    const client = getClientRate(invoice.clientId);
    
    if (client) {
      const workRecordInput = convertInvoiceToWorkRecord(
        invoice,
        client.dailyRate,
        client.currency
      );
      
      wouldCreateWorkRecords++;
      
      if (invoice.status === 'generated') {
        wouldCreateDocuments++;
      }
      
      sample.push({
        invoiceId: invoice.id,
        month: invoice.month,
        workingDays: workRecordInput.totalWorkingDays,
        status: invoice.status,
      });
    }
  }
  
  return {
    totalInvoices: invoices.length,
    wouldCreateWorkRecords: invoices.length,
    wouldCreateDocuments: invoices.filter(i => i.status === 'generated').length,
    sample,
  };
}
