/**
 * Document Status Utilities
 *
 * Provides helper functions and constants for document status management:
 * - Valid status transitions
 * - Status metadata (colors, labels, icons)
 * - Status validation functions
 */

import type { DocumentStatus, StatusHistoryEntry, Document } from '../types';

// ============================================
// Status Metadata
// ============================================

export interface StatusMetadata {
  label: string;
  color: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
  icon: string;
  description: string;
  allowedTransitions: DocumentStatus[];
}

export const STATUS_METADATA: Record<DocumentStatus | 'final', StatusMetadata> = {
  generated: {
    label: 'Generated',
    color: 'blue',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    textColor: 'text-blue-700 dark:text-blue-400',
    borderColor: 'border-blue-200 dark:border-blue-800',
    icon: 'FileSpreadsheet',
    description: 'Initial Excel document generated from template',
    allowedTransitions: ['excel-uploaded', 'pdf-uploaded'],
  },
  'excel-uploaded': {
    label: 'Excel Uploaded',
    color: 'purple',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    textColor: 'text-purple-700 dark:text-purple-400',
    borderColor: 'border-purple-200 dark:border-purple-800',
    icon: 'Upload',
    description: 'Excel file uploaded by user',
    allowedTransitions: ['pdf-uploaded', 'sent'],
  },
  'pdf-uploaded': {
    label: 'PDF Uploaded',
    color: 'indigo',
    bgColor: 'bg-indigo-100 dark:bg-indigo-900/30',
    textColor: 'text-indigo-700 dark:text-indigo-400',
    borderColor: 'border-indigo-200 dark:border-indigo-800',
    icon: 'Upload',
    description: 'PDF file uploaded by user',
    allowedTransitions: ['sent'],
  },
  sent: {
    label: 'Sent',
    color: 'green',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-700 dark:text-green-400',
    borderColor: 'border-green-200 dark:border-green-800',
    icon: 'Send',
    description: 'Document sent to client',
    allowedTransitions: ['paid'],
  },
  paid: {
    label: 'Paid',
    color: 'green',
    bgColor: 'bg-green-500 dark:bg-green-600',
    textColor: 'text-white font-semibold',
    borderColor: 'border-green-600 dark:border-green-500',
    icon: 'CheckCircle',
    description: 'Invoice paid by client',
    allowedTransitions: [],
  },
  // Legacy status for backward compatibility
  final: {
    label: 'Uploaded',
    color: 'purple',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    textColor: 'text-purple-700 dark:text-purple-400',
    borderColor: 'border-purple-200 dark:border-purple-800',
    icon: 'Upload',
    description: 'Document uploaded (legacy)',
    allowedTransitions: ['sent'],
  },
};

// ============================================
// Status Transition Validation
// ============================================

/**
 * Check if a status transition is valid
 */
export function isValidStatusTransition(
  currentStatus: DocumentStatus,
  newStatus: DocumentStatus,
  documentType: 'invoice' | 'timesheet'
): boolean {
  // Can't transition to the same status
  if (currentStatus === newStatus) {
    return false;
  }

  // Get allowed transitions for current status
  const allowedTransitions = STATUS_METADATA[currentStatus].allowedTransitions;

  // Check if new status is in allowed transitions
  if (!allowedTransitions.includes(newStatus)) {
    return false;
  }

  // 'paid' status is only valid for invoices
  if (newStatus === 'paid' && documentType !== 'invoice') {
    return false;
  }

  return true;
}

/**
 * Get the next valid statuses for a document
 */
export function getNextValidStatuses(
  currentStatus: DocumentStatus,
  documentType: 'invoice' | 'timesheet'
): DocumentStatus[] {
  const allNext = STATUS_METADATA[currentStatus].allowedTransitions;

  // Filter out 'paid' for timesheets
  if (documentType === 'timesheet') {
    return allNext.filter((status) => status !== 'paid');
  }

  return allNext;
}

/**
 * Get all possible status transitions for UI display
 */
export function getStatusTransitionOptions(
  currentStatus: DocumentStatus,
  documentType: 'invoice' | 'timesheet'
): { status: DocumentStatus; metadata: StatusMetadata }[] {
  const nextStatuses = getNextValidStatuses(currentStatus, documentType);
  return nextStatuses.map((status) => ({
    status,
    metadata: STATUS_METADATA[status],
  }));
}

// ============================================
// Status History Helpers
// ============================================

/**
 * Create a new status history entry
 */
export function createStatusHistoryEntry(
  status: DocumentStatus,
  note?: string
): StatusHistoryEntry {
  return {
    status,
    timestamp: new Date().toISOString(),
    ...(note && { note }),
  };
}

/**
 * Add a status entry to the history
 */
export function addStatusToHistory(
  history: StatusHistoryEntry[],
  status: DocumentStatus,
  note?: string
): StatusHistoryEntry[] {
  return [...history, createStatusHistoryEntry(status, note)];
}

/**
 * Get the timestamp for a specific status from history
 */
export function getStatusTimestamp(
  history: StatusHistoryEntry[],
  status: DocumentStatus
): string | undefined {
  const entry = history.find((entry) => entry.status === status);
  return entry?.timestamp;
}

/**
 * Get the most recent status change
 */
export function getMostRecentStatusChange(
  history: StatusHistoryEntry[]
): StatusHistoryEntry | undefined {
  if (history.length === 0) return undefined;
  return history[history.length - 1];
}

// ============================================
// Status Date Helpers
// ============================================

/**
 * Get the date field name for a status
 */
export function getStatusDateField(
  status: DocumentStatus
): keyof Document | null {
  switch (status) {
    case 'generated':
      return 'generatedAt';
    case 'excel-uploaded':
    case 'pdf-uploaded':
      return 'finalizedAt';
    case 'sent':
      return 'sentAt';
    case 'paid':
      return 'paidAt';
    default:
      return null;
  }
}

/**
 * Get all status dates for a document
 */
export function getStatusDates(document: Document): {
  status: DocumentStatus;
  date: string | undefined;
}[] {
  return [
    { status: 'generated', date: document.generatedAt },
    { status: 'excel-uploaded', date: document.finalizedAt },
    { status: 'pdf-uploaded', date: document.finalizedAt },
    { status: 'sent', date: document.sentAt },
    { status: 'paid', date: document.paidAt },
  ];
}

// ============================================
// Document Status Helpers
// ============================================

/**
 * Check if a document has a final version uploaded
 * Checks both the new finalDocuments array and legacy fields
 */
export function hasFinalVersion(document: Document): boolean {
  // Check new finalDocuments array first
  if (document.finalDocuments && document.finalDocuments.length > 0) {
    return true;
  }
  // Fall back to legacy fields
  if (document.finalStoragePath || document.finalDownloadUrl || document.finalFileName) {
    return true;
  }
  return false;
}

/**
 * Get all final documents for a document
 * Returns finalDocuments array if available, otherwise wraps legacy fields
 */
export function getFinalDocuments(document: Document): Array<{
  fileName: string;
  downloadUrl: string;
  storagePath: string;
  fileExtension: string;
}> {
  // If new finalDocuments array exists, use it
  if (document.finalDocuments && document.finalDocuments.length > 0) {
    return document.finalDocuments.map(fd => ({
      fileName: fd.fileName,
      downloadUrl: fd.downloadUrl,
      storagePath: fd.storagePath,
      fileExtension: fd.fileExtension,
    }));
  }
  
  // Fall back to legacy fields
  if (document.finalFileName && document.finalDownloadUrl && document.finalStoragePath) {
    const ext = document.finalFileName.toLowerCase().split('.').pop() || '';
    return [{
      fileName: document.finalFileName,
      downloadUrl: document.finalDownloadUrl,
      storagePath: document.finalStoragePath,
      fileExtension: ext,
    }];
  }
  
  return [];
}

/**
 * Get the effective status of a document
 * This handles legacy documents that have a final version uploaded
 * but their status field wasn't updated (e.g., "generated" -> "final")
 */
export function getEffectiveStatus(document: Document): DocumentStatus {
  // Debug logging - show ALL potential file fields
  console.log('[getEffectiveStatus] Checking:', {
    id: document.id?.slice(0, 8),
    status: document.status,
    finalFileName: document.finalFileName,
    finalStoragePath: document.finalStoragePath?.slice(0, 50),
    finalDownloadUrl: document.finalDownloadUrl?.slice(0, 50),
    // Additional fields
    downloadUrl: document.downloadUrl?.slice(0, 50),
    fileName: document.fileName,
    storagePath: document.storagePath?.slice(0, 50),
    hasFinalDocs: !!document.finalDocuments?.length,
    finalDocs: document.finalDocuments?.map(fd => ({
      name: fd.fileName,
      ext: fd.fileExtension,
      path: fd.storagePath?.slice(0, 30),
    })),
  });

  // If document is paid, that's the highest status
  if (document.status === 'paid' || document.isPaid) {
    console.log('[getEffectiveStatus] Returning: paid');
    return 'paid';
  }
  
  // If document was sent, show sent status
  if (document.status === 'sent') {
    console.log('[getEffectiveStatus] Returning: sent');
    return 'sent';
  }
  
  // Check ALL file fields: finalDocuments, legacy final fields, AND main storage fields
  const finalDocs = document.finalDocuments || [];
  
  // Check finalDocuments array for file types
  let hasPdf = finalDocs.some(fd => fd.fileExtension?.toLowerCase() === 'pdf');
  let hasExcel = finalDocs.some(fd =>
    fd.fileExtension?.toLowerCase() === 'xlsx' ||
    fd.fileExtension?.toLowerCase() === 'xls'
  );
  
  // Check legacy FINAL fields (finalFileName, finalStoragePath, finalDownloadUrl)
  const finalFileName = document.finalFileName || '';
  const finalStoragePath = document.finalStoragePath || '';
  const finalDownloadUrl = document.finalDownloadUrl || '';
  
  if (finalFileName.toLowerCase().endsWith('.pdf')) hasPdf = true;
  if (finalFileName.toLowerCase().endsWith('.xlsx') || finalFileName.toLowerCase().endsWith('.xls')) hasExcel = true;
  if (finalStoragePath.toLowerCase().endsWith('.pdf')) hasPdf = true;
  if (finalStoragePath.toLowerCase().endsWith('.xlsx') || finalStoragePath.toLowerCase().endsWith('.xls')) hasExcel = true;
  if (finalDownloadUrl.toLowerCase().includes('.pdf')) hasPdf = true;
  if (finalDownloadUrl.toLowerCase().includes('.xlsx') || finalDownloadUrl.toLowerCase().includes('.xls')) hasExcel = true;
  
  // ALSO check MAIN storage fields (fileName, storagePath, downloadUrl)
  // This handles documents where files are stored in the generated fields
  const mainFileName = document.fileName || '';
  const mainStoragePath = document.storagePath || '';
  const mainDownloadUrl = document.downloadUrl || '';
  
  if (mainFileName.toLowerCase().endsWith('.pdf')) hasPdf = true;
  if (mainFileName.toLowerCase().endsWith('.xlsx') || mainFileName.toLowerCase().endsWith('.xls')) hasExcel = true;
  if (mainStoragePath.toLowerCase().endsWith('.pdf')) hasPdf = true;
  if (mainStoragePath.toLowerCase().endsWith('.xlsx') || mainStoragePath.toLowerCase().endsWith('.xls')) hasExcel = true;
  if (mainDownloadUrl.toLowerCase().includes('.pdf')) hasPdf = true;
  if (mainDownloadUrl.toLowerCase().includes('.xlsx') || mainDownloadUrl.toLowerCase().includes('.xls')) hasExcel = true;
  
  // Check if there's likely an Excel sibling file
  // This handles cases where both PDF and Excel exist in storage but only PDF is linked in Firestore
  // e.g., "05-Tesselate-Invoice-FEBRUARY-2026.pdf" likely has "05-Tesselate-Invoice-FEBRUARY-2026.xlsx" sibling
  if (mainStoragePath.toLowerCase().endsWith('.pdf') && mainStoragePath.includes('/invoice/')) {
    hasExcel = true;
  }
  
  console.log('[getEffectiveStatus] Results:', { hasPdf, hasExcel, finalDocsLength: finalDocs.length });

  // If we found any files, return appropriate status
  if (hasPdf) {
    console.log('[getEffectiveStatus] Returning: pdf-uploaded');
    return 'pdf-uploaded';
  }
  if (hasExcel) {
    console.log('[getEffectiveStatus] Returning: excel-uploaded');
    return 'excel-uploaded';
  }
  
  // If no files found but status says uploaded, preserve it
  if (document.status === 'pdf-uploaded' || document.status === 'excel-uploaded') {
    console.log('[getEffectiveStatus] Returning stored:', document.status);
    return document.status;
  }
  
  // Otherwise return the stored status or default to 'generated'
  console.log('[getEffectiveStatus] Returning default:', document.status || 'generated');
  return document.status || 'generated';
}

/**
 * Get the effective download URL for a document
 * Returns the first final URL if available, otherwise generated URL
 * For multiple final documents, this returns the most recently uploaded one
 */
export function getEffectiveDownloadUrl(document: Document): string {
  // Check new finalDocuments array first
  if (document.finalDocuments && document.finalDocuments.length > 0) {
    return document.finalDocuments[document.finalDocuments.length - 1].downloadUrl;
  }
  // Fall back to legacy fields
  return document.finalDownloadUrl || document.downloadUrl;
}

/**
 * Get the effective storage path for a document
 * Returns the first final path if available, otherwise generated path
 * For multiple final documents, this returns the most recently uploaded one
 */
export function getEffectiveStoragePath(document: Document): string {
  // Check new finalDocuments array first
  if (document.finalDocuments && document.finalDocuments.length > 0) {
    return document.finalDocuments[document.finalDocuments.length - 1].storagePath;
  }
  // Fall back to legacy fields
  return document.finalStoragePath || document.storagePath;
}

/**
 * Get the effective filename for a document
 * Returns the first final filename if available, otherwise generated filename
 * For multiple final documents, this returns the most recently uploaded one
 */
export function getEffectiveFileName(document: Document): string | undefined {
  // Check new finalDocuments array first
  if (document.finalDocuments && document.finalDocuments.length > 0) {
    return document.finalDocuments[document.finalDocuments.length - 1].fileName;
  }
  // Fall back to legacy fields
  return document.finalFileName || document.fileName;
}

/**
 * Check if a document can be marked as final
 */
export function canMarkAsFinal(document: Document): boolean {
  return document.status === 'generated';
}

/**
 * Check if a document can be marked as sent
 */
export function canMarkAsSent(document: Document): boolean {
  return (document.status === 'excel-uploaded' || document.status === 'pdf-uploaded') && hasFinalVersion(document);
}

/**
 * Check if a document can be marked as paid
 */
export function canMarkAsPaid(document: Document): boolean {
  return document.type === 'invoice' && document.status === 'sent';
}

// ============================================
// Status Action Helpers
// ============================================

export interface StatusAction {
  action: 'upload_final' | 'mark_sent' | 'mark_paid' | 'reupload_final';
  label: string;
  icon: string;
  disabled: boolean;
  disabledReason?: string;
}

/**
 * Get available actions for a document based on its status
 */
export function getAvailableStatusActions(document: Document): StatusAction[] {
  const actions: StatusAction[] = [];

  // Upload Final action (when in generated status)
  if (document.status === 'generated') {
    actions.push({
      action: 'upload_final',
      label: 'Upload Final',
      icon: 'Upload',
      disabled: false,
    });
  }

  // Re-upload Final action (when in uploaded or sent status)
  if (document.status === 'excel-uploaded' || document.status === 'pdf-uploaded' || document.status === 'sent') {
    actions.push({
      action: 'reupload_final',
      label: 'Re-upload Final',
      icon: 'RefreshCw',
      disabled: false,
    });
  }

  // Mark as Sent action
  if (document.status === 'excel-uploaded' || document.status === 'pdf-uploaded') {
    actions.push({
      action: 'mark_sent',
      label: 'Mark as Sent',
      icon: 'Send',
      disabled: !hasFinalVersion(document),
      disabledReason: !hasFinalVersion(document)
        ? 'Upload a final version first'
        : undefined,
    });
  }

  // Mark as Paid action (invoices only)
  if (document.type === 'invoice' && document.status === 'sent') {
    actions.push({
      action: 'mark_paid',
      label: 'Mark as Paid',
      icon: 'CheckCircle',
      disabled: false,
    });
  }

  return actions;
}

// ============================================
// Status Formatting Helpers
// ============================================

/**
 * Format a status for display
 */
export function formatStatus(status: DocumentStatus): string {
  return STATUS_METADATA[status].label;
}

/**
 * Get status CSS classes for badges
 */
export function getStatusBadgeClasses(status: DocumentStatus): string {
  const meta = STATUS_METADATA[status];
  return `${meta.bgColor} ${meta.textColor} ${meta.borderColor}`;
}

/**
 * Format status date for display
 */
export function formatStatusDate(dateString: string | undefined): string {
  if (!dateString) return 'Not set';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format status date for compact display (e.g., in badges)
 * Shows: "Feb 28, 19:34" format
 */
export function formatStatusDateCompact(dateString: string | undefined): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const isSameYear = date.getFullYear() === now.getFullYear();
  
  if (isSameYear) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }) + ', ' + date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + ', ' + date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Get status description
 */
export function getStatusDescription(status: DocumentStatus): string {
  return STATUS_METADATA[status].description;
}
