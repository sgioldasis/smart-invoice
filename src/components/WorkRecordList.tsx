/**
 * WorkRecordList Component
 *
 * Displays a list of all work records grouped by client and month.
 * Allows users to:
 * - View all saved work records
 * - Filter by client
 * - Navigate to edit a work record
 * - See summary statistics
 * - Generate and download invoices directly
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Briefcase,
  Calendar as CalendarIcon,
  ChevronRight,
  Edit3,
  Trash2,
  Building2,
  Loader2,
  Plus,
  Clock,
  Search,
  FileSpreadsheet,
  AlertTriangle,
  X,
  Calendar,
  Upload,
  Bot,
  Download,
  CheckCircle,
  MoreVertical,
  FileText,
  Eye,
  RefreshCw,
  Send,
  DollarSign,
} from 'lucide-react';
import { StatusBadge } from './DocumentStatus';
import type { DocumentStatus } from '../types';
import { format, parseISO, endOfMonth, getDaysInMonth, isValid } from 'date-fns';
import * as ExcelJS from 'exceljs';
import type { Client, WorkRecord, Document, DocumentInput, WorkRecordTimesheet, WorkRecordTimesheetInput, Template } from '../types';
import { getClients, getWorkRecords, deleteWorkRecord, getDocuments, saveDocument, getTimesheetByWorkRecord, saveTimesheet, getTemplateById, uploadFinalDocument, markDocumentSent, markInvoicePaid } from '../services/db';
import { getDocumentDownloadUrl } from '../services/storage';
import { processTimesheetPromptSmart } from '../services/ai';
import { hasFinalVersion, canMarkAsFinal, canMarkAsSent, canMarkAsPaid, getEffectiveDownloadUrl, STATUS_METADATA, getEffectiveStatus } from '../utils/documentStatus';
import { UploadProgressModal, useUploadProgressModal } from './UploadProgressModal';
import { DeleteConfirmationModal, DeleteDocument } from './DeleteConfirmationModal';

interface WorkRecordListProps {
  userEmail: string;
  onEditWorkRecord?: (clientId: string, month: string) => void;
  onCreateWorkRecord?: () => void;
}

export const WorkRecordList: React.FC<WorkRecordListProps> = ({
  userEmail,
  onEditWorkRecord,
  onCreateWorkRecord,
}) => {
  // ============================================
  // State
  // ============================================

  const [clients, setClients] = useState<Client[]>([]);
  const [workRecords, setWorkRecords] = useState<WorkRecord[]>([]);
  const [invoices, setInvoices] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Upload progress modal
  const uploadProgressModal = useUploadProgressModal();

  // Pending upload state for confirmation
  const [pendingUpload, setPendingUpload] = useState<{
    file: File;
    record: WorkRecord;
    client: Client;
    targetType: 'invoice' | 'timesheet';
    targetDocumentId: string;
    isPdf: boolean;
  } | null>(null);

  // Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkRecord | null>(null);
  const [deleteDocuments, setDeleteDocuments] = useState<DeleteDocument[]>([]);

  // Dropdown menu state for document actions
  const [openDropdown, setOpenDropdown] = useState<{ type: 'invoice' | 'timesheet'; recordId: string } | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const invoiceButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const timesheetButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setOpenDropdown(null);
      setDropdownPosition(null);
    };
    if (openDropdown) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openDropdown]);

  // Invoice dialog state
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [dialogRecord, setDialogRecord] = useState<WorkRecord | null>(null);
  const [dialogClient, setDialogClient] = useState<Client | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [generatedFileName, setGeneratedFileName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [invoiceTemplate, setInvoiceTemplate] = useState<Template | null>(null);
  const [loadingInvoiceTemplate, setLoadingInvoiceTemplate] = useState(false);
  const [existingInvoiceId, setExistingInvoiceId] = useState<string | null>(null);

  // Timesheet dialog state
  const [showTimesheetDialog, setShowTimesheetDialog] = useState(false);
  const [timesheetRecord, setTimesheetRecord] = useState<WorkRecord | null>(null);
  const [timesheetClient, setTimesheetClient] = useState<Client | null>(null);
  const [timesheetPrompt, setTimesheetPrompt] = useState('');
  const [timesheetMonthTemplate, setTimesheetMonthTemplate] = useState<string | null>(null);
  const [timesheetMonthTemplateName, setTimesheetMonthTemplateName] = useState<string>('');
  const [existingTimesheetId, setExistingTimesheetId] = useState<string | null>(null);
  const [isGeneratingTimesheet, setIsGeneratingTimesheet] = useState(false);
  const [timesheetError, setTimesheetError] = useState<string | null>(null);
  const [timesheetFileName, setTimesheetFileName] = useState('');
  const [timesheetTemplate, setTimesheetTemplate] = useState<Template | null>(null);
  const [loadingTimesheetTemplate, setLoadingTimesheetTemplate] = useState(false);

  // Status date picker dialog state
  const [showStatusDateDialog, setShowStatusDateDialog] = useState(false);
  const [statusDateTarget, setStatusDateTarget] = useState<{ type: 'sent' | 'paid'; document: Document } | null>(null);
  // Status date picker - separate day/month/year for custom display
  const [statusDay, setStatusDay] = useState(() => {
    return new Date().getDate();
  });
  const [statusMonth, setStatusMonth] = useState(() => {
    return new Date().getMonth(); // 0-11
  });
  const [statusYear, setStatusYear] = useState(() => {
    return new Date().getFullYear();
  });
  const [statusTimeValue, setStatusTimeValue] = useState(() => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  });

  const statusMonths = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Generate days based on selected month/year
  const getStatusDaysInMonth = (month: number, year: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  // Update default filename when record or template changes
  useEffect(() => {
    if (timesheetRecord && timesheetClient) {
      // Base name preference: Month-specific template name > Client default template name > Generic
      let baseName = timesheetMonthTemplateName ||
        timesheetClient.timesheetTemplateName ||
        timesheetClient.timesheetTemplateFileName ||
        `Timesheet_${timesheetClient.name.replace(/[^a-zA-Z0-9]/g, '_')}_${timesheetRecord.month}`;

      // Remove extension for editing
      baseName = baseName.replace(/\.xlsx$/i, '').replace(/\.xls$/i, '');

      // Smart Replacement: Update Year and Month to current record's
      try {
        const recordDate = parseISO(timesheetRecord.month + '-01');
        const currentYear = format(recordDate, 'yyyy');
        const currentMonthName = format(recordDate, 'MMMM');
        const currentMonthNum = format(recordDate, 'MM');

        // Replace literal placeholders
        baseName = baseName.replace(/YYYY/g, currentYear);
        baseName = baseName.replace(/MM/g, currentMonthNum);

        // Replace YYYY-MM, YYYY_MM, YYYY.MM patterns (e.g., 2024-02 -> 2026-04)
        baseName = baseName.replace(/\b20\d{2}([-_.])\d{2}\b/g, (match, sep) => {
          return `${currentYear}${sep}${currentMonthNum}`;
        });

        // Replace 4-digit years (e.g. 2024 -> 2026)
        baseName = baseName.replace(/\b20\d{2}\b/g, currentYear);

        // Replace 2-digit year after apostrophe or quote (e.g., '24 -> '26)
        const twoDigitYear = currentYear.substring(2);
        baseName = baseName.replace(/['"]\d{2}\b/g, `'${twoDigitYear}`);

        // Replace full month names (case insensitive)
        const monthsFull = [
          'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'
        ];
        monthsFull.forEach(m => {
          const re = new RegExp(m, 'gi');
          baseName = baseName.replace(re, currentMonthName);
        });

        // Also handle short month names if they are likely months (e.g., Jan, Feb)
        // Only if they are standalone words to avoid mangling names
        const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const currentMonthShort = format(recordDate, 'MMM');
        monthsShort.forEach(m => {
          const re = new RegExp(`\\b${m}\\b`, 'gi');
          baseName = baseName.replace(re, currentMonthShort);
        });
      } catch (e) {
        console.error('Error parsing date for filename:', e);
      }

      setTimesheetFileName(baseName);
    }
  }, [timesheetRecord, timesheetClient, timesheetMonthTemplateName]);

  // ============================================
  // Derived State
  // ============================================

  const filteredRecords = useMemo(() => {
    console.log('[WorkRecordList] Filtering records:', {
      totalWorkRecords: workRecords.length,
      selectedClientId,
      searchQuery,
      clientsCount: clients.length
    });
    let filtered = workRecords;

    if (selectedClientId) {
      filtered = filtered.filter((wr) => wr.clientId === selectedClientId);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const clientMap = new Map(clients.map((c) => [c.id, c]));
      filtered = filtered.filter((wr) => {
        const client = clientMap.get(wr.clientId) as Client | undefined;
        const clientName = client?.name.toLowerCase() || '';
        const month = wr.month.toLowerCase();
        return clientName.includes(query) || month.includes(query);
      });
    }

    console.log('[WorkRecordList] Filtered records:', filtered.length);
    return filtered;
  }, [workRecords, selectedClientId, searchQuery, clients]);

  const groupedByMonth = useMemo(() => {
    const groups: Record<string, WorkRecord[]> = {};
    console.log('[WorkRecordList] Grouping records:', filteredRecords.length);
    filteredRecords.forEach((wr, idx) => {
      console.log(`[WorkRecordList] Record ${idx}:`, { id: wr.id, month: wr.month, clientId: wr.clientId });
      if (!groups[wr.month]) {
        groups[wr.month] = [];
      }
      groups[wr.month].push(wr);
    });
    return groups;
  }, [filteredRecords]);

  const sortedMonths = useMemo(() => {
    const months = Object.keys(groupedByMonth).sort().reverse();
    console.log('[WorkRecordList] sortedMonths:', months);
    return months;
  }, [groupedByMonth]);

  const stats = useMemo(() => {
    const totalRecords = filteredRecords.length;
    const totalDays = filteredRecords.reduce(
      (sum, wr) => sum + wr.workingDays.length,
      0
    );
    return { totalRecords, totalDays };
  }, [filteredRecords]);

  // ============================================
  // Effects
  // ============================================

  // Load data function - can be called manually or automatically
  const loadData = useCallback(async () => {
    console.log('[WorkRecordList] Loading data for userEmail:', userEmail);
    setIsLoading(true);
    try {
      const [clientsData, recordsData, invoicesData] = await Promise.all([
        getClients(userEmail),
        getWorkRecords(userEmail),
        getDocuments(userEmail),
      ]);
      console.log('[WorkRecordList] Loaded:', {
        clients: clientsData.length,
        workRecords: recordsData.length,
        invoices: invoicesData.length
      });
      setClients(clientsData);
      setWorkRecords(recordsData);
      setInvoices(invoicesData);
    } catch (error) {
      console.error('Error loading work records:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userEmail]);

  // Initial load and refresh on userEmail or refreshKey change
  useEffect(() => {
    loadData();
  }, [loadData, refreshKey]);

  // Refresh data when window regains focus (user returns from Admin Tools)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[WorkRecordList] Window visible, refreshing data...');
        loadData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [loadData]);

  // ============================================
  // Handlers
  // ============================================

  const handleDelete = (record: WorkRecord) => {
    // Check for associated documents
    const invoice = getInvoiceForRecord(record.id);
    const timesheet = getTimesheetForRecord(record.id);

    const docs: DeleteDocument[] = [];
    
    // Add invoice section
    if (invoice) {
      const invoiceFiles: string[] = [];
      // Add the main generated file
      if (invoice.fileName) {
        invoiceFiles.push(invoice.fileName);
      }
      // Add any final uploaded documents (PDFs, Excel files)
      if (invoice.finalDocuments && invoice.finalDocuments.length > 0) {
        invoice.finalDocuments.forEach((fd) => {
          const fileName = fd.fileName || `final-version.${fd.fileExtension}`;
          // Only add if not already in the list
          if (!invoiceFiles.includes(fileName)) {
            invoiceFiles.push(fileName);
          }
        });
      }
      if (invoiceFiles.length > 0) {
        docs.push({ type: 'Invoice', files: invoiceFiles });
      }
    }
    
    // Add timesheet section
    if (timesheet) {
      const timesheetFiles: string[] = [];
      // Add the main generated file
      if (timesheet.fileName) {
        timesheetFiles.push(timesheet.fileName);
      }
      // Add any final uploaded documents (PDFs, Excel files)
      if (timesheet.finalDocuments && timesheet.finalDocuments.length > 0) {
        timesheet.finalDocuments.forEach((fd) => {
          const fileName = fd.fileName || `final-version.${fd.fileExtension}`;
          // Only add if not already in the list
          if (!timesheetFiles.includes(fileName)) {
            timesheetFiles.push(fileName);
          }
        });
      }
      if (timesheetFiles.length > 0) {
        docs.push({ type: 'Timesheet', files: timesheetFiles });
      }
    }

    setDeleteTarget(record);
    setDeleteDocuments(docs);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    setShowDeleteModal(false);
    setIsDeleting(deleteTarget.id);
    try {
      await deleteWorkRecord(deleteTarget.id);
      setWorkRecords((prev) => prev.filter((wr) => wr.id !== deleteTarget.id));
    } catch (error) {
      console.error('Error deleting work record:', error);
      alert('Failed to delete work record');
    } finally {
      setIsDeleting(null);
      setDeleteTarget(null);
      setDeleteDocuments([]);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
    setDeleteTarget(null);
    setDeleteDocuments([]);
  };

  const handleEdit = (clientId: string, month: string) => {
    onEditWorkRecord?.(clientId, month);
  };

  const getNextInvoiceNumber = (): string => {
    // Extract numeric values from all invoice document numbers (global across all clients)
    const existingNumbers = invoices
      .filter((inv) => inv.type === 'invoice')
      .map((d) => {
        // Try to extract any numeric sequence from the document number
        const match = d.documentNumber?.match(/\d+/);
        const num = match ? parseInt(match[0], 10) : 0;
        return isNaN(num) ? 0 : num;
      })
      .filter((n) => n > 0 && n < 10000); // Only consider reasonable invoice numbers (ignore timestamps/IDs)

    const maxNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
    const nextNum = maxNum + 1;

    // Format: 2 digits for numbers < 100, no leading zeros for >= 100
    return nextNum < 100 ? String(nextNum).padStart(2, '0') : String(nextNum);
  };

  const generateFileName = (invNum: string, clientName: string, month: string): string => {
    const safeClientName = clientName.replace(/\s+/g, '_');
    const [year, monthNum] = month.split('-');
    const monthName = format(new Date(parseInt(year), parseInt(monthNum) - 1), 'MMMM').toUpperCase();
    return `${invNum}-${safeClientName}-Invoice-${monthName}-${year}.xlsx`;
  };

  // Helper to get file extension from URL or filename
  const getFileExtensionFromUrl = (url: string | undefined): string => {
    if (!url) return '';
    // Try to extract from filename in URL
    const decodedUrl = decodeURIComponent(url);
    const match = decodedUrl.match(/[^/]+\.([^.?]+)(?:\?|$)/);
    return match ? match[1].toLowerCase() : '';
  };

  // Helper to check if URL points to Excel file
  const isExcelUrl = (url: string | undefined): boolean => {
    const ext = getFileExtensionFromUrl(url);
    return ['xlsx', 'xls'].includes(ext);
  };

  // Helper to check if URL points to PDF file
  const isPdfUrl = (url: string | undefined): boolean => {
    const ext = getFileExtensionFromUrl(url);
    return ext === 'pdf';
  };

  // Helper to check if document has a PDF version
  // Checks: finalDocuments array, legacy final fields, AND main storage fields (fileName, storagePath, downloadUrl)
  const hasPdfVersion = (doc: Document): boolean => {
    // Check new finalDocuments array (case-insensitive)
    const hasFinalDocPdf = doc.finalDocuments?.some(fd =>
      fd.fileExtension?.toLowerCase() === 'pdf'
    );
    
    // Check legacy final fields
    const hasFinalFileNamePdf = (doc.finalFileName || '').toLowerCase().endsWith('.pdf');
    const hasFinalStoragePdf = (doc.finalStoragePath || '').toLowerCase().endsWith('.pdf');
    const hasFinalDownloadPdf = isPdfUrl(doc.finalDownloadUrl);
    
    // Check MAIN storage fields (fileName, storagePath, downloadUrl)
    const hasMainFileNamePdf = (doc.fileName || '').toLowerCase().endsWith('.pdf');
    const hasMainStoragePdf = (doc.storagePath || '').toLowerCase().endsWith('.pdf');
    const hasMainDownloadPdf = isPdfUrl(doc.downloadUrl);
    
    return hasFinalDocPdf || hasFinalFileNamePdf || hasFinalStoragePdf || hasFinalDownloadPdf ||
           hasMainFileNamePdf || hasMainStoragePdf || hasMainDownloadPdf;
  };

  // Helper to check if document has an Excel version
  const hasExcelVersion = (doc: Document): boolean => {
    // Check new finalDocuments array (case-insensitive)
    const hasFinalDocExcel = doc.finalDocuments?.some(fd => {
      const ext = fd.fileExtension?.toLowerCase();
      return ['xlsx', 'xls'].includes(ext);
    });
    
    // Check legacy final fields
    const hasFinalFileNameExcel =
      (doc.finalFileName || '').toLowerCase().endsWith('.xlsx') ||
      (doc.finalFileName || '').toLowerCase().endsWith('.xls');
    const hasFinalStorageExcel =
      (doc.finalStoragePath || '').toLowerCase().endsWith('.xlsx') ||
      (doc.finalStoragePath || '').toLowerCase().endsWith('.xls');
    const hasFinalDownloadExcel = isExcelUrl(doc.finalDownloadUrl);
    
    // Check MAIN storage fields
    const hasMainFileNameExcel =
      (doc.fileName || '').toLowerCase().endsWith('.xlsx') ||
      (doc.fileName || '').toLowerCase().endsWith('.xls');
    const hasMainStorageExcel =
      (doc.storagePath || '').toLowerCase().endsWith('.xlsx') ||
      (doc.storagePath || '').toLowerCase().endsWith('.xls');
    const hasMainDownloadExcel = isExcelUrl(doc.downloadUrl);
    
    // Check if there's likely an Excel sibling file
    // This handles cases where both PDF and Excel exist in storage but only PDF is linked in Firestore
    // e.g., "05-Tesselate-Invoice-FEBRUARY-2026.pdf" likely has "05-Tesselate-Invoice-FEBRUARY-2026.xlsx" sibling
    let hasLikelyExcelSibling = false;
    if (doc.storagePath?.toLowerCase().endsWith('.pdf')) {
      // If we have a PDF in the invoice folder, assume there might be an Excel version too
      // This is based on the app's pattern of generating both formats
      hasLikelyExcelSibling = doc.storagePath.includes('/invoice/');
    }
    
    return hasFinalDocExcel || hasFinalFileNameExcel || hasFinalStorageExcel || hasFinalDownloadExcel ||
           hasMainFileNameExcel || hasMainStorageExcel || hasMainDownloadExcel || hasLikelyExcelSibling;
  };

  // Helper to get the correct Excel download URL for a document
  // Prioritizes finalDocuments array, falls back to legacy fields
  const getExcelDownloadUrl = (doc: Document): string | undefined => {
    // Check new finalDocuments array first
    const finalDocExcel = doc.finalDocuments?.find(fd => ['xlsx', 'xls'].includes(fd.fileExtension));
    if (finalDocExcel) {
      return finalDocExcel.downloadUrl;
    }
    // Fall back to legacy fields
    if (doc.finalDownloadUrl && isExcelUrl(doc.finalDownloadUrl)) {
      return doc.finalDownloadUrl;
    }
    if (isExcelUrl(doc.downloadUrl)) {
      return doc.downloadUrl;
    }
    
    // If we have a PDF downloadUrl but no Excel URL, construct the Excel URL
    // by replacing .pdf with .xlsx in the URL
    if (doc.downloadUrl && doc.downloadUrl.toLowerCase().endsWith('.pdf')) {
      const excelUrl = doc.downloadUrl.replace(/\.pdf$/i, '.xlsx');
      console.log('[getExcelDownloadUrl] Constructed Excel URL from PDF:', excelUrl.substring(0, 100));
      return excelUrl;
    }
    
    return undefined;
  };

  // Helper to regenerate Excel URL from storage path (for legacy documents)
  const regenerateExcelUrl = async (doc: Document): Promise<string | undefined> => {
    console.log('[regenerateExcelUrl] Attempting to regenerate URL for doc:', doc.id);
    console.log('[regenerateExcelUrl] storagePath:', doc.storagePath);
    console.log('[regenerateExcelUrl] fileName:', doc.fileName);
    
    if (!doc.storagePath) {
      console.warn('[regenerateExcelUrl] No storagePath available');
      return undefined;
    }
    
    // Check if path ends with Excel extension
    const isExcelPath = doc.storagePath.toLowerCase().endsWith('.xlsx') || doc.storagePath.toLowerCase().endsWith('.xls');
    console.log('[regenerateExcelUrl] Is Excel path:', isExcelPath);
    
    if (isExcelPath) {
      try {
        const { getDocumentDownloadUrl } = await import('../services/storage');
        const url = await getDocumentDownloadUrl(doc.storagePath);
        console.log('[regenerateExcelUrl] Successfully regenerated URL:', url);
        return url;
      } catch (err) {
        console.error('[regenerateExcelUrl] Failed to regenerate Excel download URL:', err);
      }
    }
    
    // If we have a PDF path, try to get the Excel sibling URL
    if (doc.storagePath.toLowerCase().endsWith('.pdf')) {
      const excelStoragePath = doc.storagePath.replace(/\.pdf$/i, '.xlsx');
      console.log('[regenerateExcelUrl] Trying Excel sibling path:', excelStoragePath);
      try {
        const { getDocumentDownloadUrl } = await import('../services/storage');
        const url = await getDocumentDownloadUrl(excelStoragePath);
        console.log('[regenerateExcelUrl] Successfully regenerated Excel sibling URL:', url);
        return url;
      } catch (err) {
        console.error('[regenerateExcelUrl] Failed to get Excel sibling URL:', err);
      }
    }
    
    return undefined;
  };

  // Helper to get the correct PDF download URL for a document
  // Prioritizes finalDocuments array, falls back to legacy fields
  const getPdfDownloadUrl = (doc: Document): string | undefined => {
    // Check new finalDocuments array first
    const finalDocPdf = doc.finalDocuments?.find(fd => fd.fileExtension === 'pdf');
    if (finalDocPdf) {
      return finalDocPdf.downloadUrl;
    }
    // Fall back to legacy fields
    if (doc.finalDownloadUrl && isPdfUrl(doc.finalDownloadUrl)) {
      return doc.finalDownloadUrl;
    }
    if (isPdfUrl(doc.downloadUrl)) {
      return doc.downloadUrl;
    }
    return doc.finalDownloadUrl || doc.downloadUrl;
  };

  // Helper to get fresh download URL from storage (fixes expired token issues)
  // Updated to support finalDocuments array
  const getFreshPdfUrl = async (doc: Document): Promise<string | undefined> => {
    let storagePath: string | undefined;
    
    // Check new finalDocuments array first
    const finalDocPdf = doc.finalDocuments?.find(fd => fd.fileExtension === 'pdf');
    if (finalDocPdf) {
      storagePath = finalDocPdf.storagePath;
    } else if (doc.finalDownloadUrl && isPdfUrl(doc.finalDownloadUrl) && doc.finalStoragePath) {
      // Fall back to legacy fields
      storagePath = doc.finalStoragePath;
    } else if (isPdfUrl(doc.downloadUrl) && doc.storagePath) {
      storagePath = doc.storagePath;
    }
    
    if (storagePath) {
      try {
        return await getDocumentDownloadUrl(storagePath);
      } catch (err) {
        console.error('Error getting fresh download URL:', err);
        return getPdfDownloadUrl(doc);
      }
    }
    
    return getPdfDownloadUrl(doc);
  };

  const openInvoiceDialog = async (record: WorkRecord) => {
    const client = clients.find((c) => c.id === record.clientId);
    if (!client) return;

    // Check for existing invoice to reuse its number and ID
    const existingInvoice = getInvoiceForRecord(record.id);
    const invoiceNum = existingInvoice?.documentNumber || getNextInvoiceNumber();
    const fileName = generateFileName(invoiceNum, client.name, record.month);

    setDialogRecord(record);
    setDialogClient(client);
    setInvoiceNumber(invoiceNum);
    setGeneratedFileName(fileName);
    setInvoiceTemplate(null);
    // Store existing invoice ID for updating instead of creating new
    setExistingInvoiceId(existingInvoice?.id || null);

    // Load invoice template (new structure or legacy)
    setLoadingInvoiceTemplate(true);
    try {
      if (client.invoiceTemplateId) {
        const template = await getTemplateById(client.invoiceTemplateId);
        setInvoiceTemplate(template);
      } else if (client.templateBase64) {
        // Create pseudo-template from legacy data
        setInvoiceTemplate({
          id: 'legacy',
          userId: client.userId,
          clientId: client.id,
          type: 'invoice',
          name: client.templateName || 'Legacy Invoice Template',
          fileName: client.templateName || 'template.xlsx',
          base64Data: client.templateBase64,
          mapping: client.mapping,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('Error loading invoice template:', err);
      setInvoiceTemplate(null);
    } finally {
      setLoadingInvoiceTemplate(false);
    }

    setShowInvoiceDialog(true);
  };

  const handleFinalUpload = async (e: React.ChangeEvent<HTMLInputElement>, record: WorkRecord, client: Client, targetDocumentId?: string) => {
    const file = e.target.files?.[0];
    console.log('[handleFinalUpload] File selected:', file?.name, 'Size:', file?.size);
    if (!file) {
      console.log('[handleFinalUpload] No file selected');
      return;
    }

    // Determine document type from file extension
    const fileExt = file.name.toLowerCase().split('.').pop() || '';
    const isExcel = ['xlsx', 'xls'].includes(fileExt);
    const isPdf = fileExt === 'pdf';
    console.log('[handleFinalUpload] File type:', fileExt, 'isExcel:', isExcel, 'isPdf:', isPdf);

    if (!isExcel && !isPdf) {
      alert('Please upload a PDF or Excel file (.pdf, .xlsx, .xls)');
      e.target.value = '';
      return;
    }

    // Open the blocking upload progress modal
    uploadProgressModal.openUpload(file.name);
    console.log('[handleFinalUpload] Starting upload for record:', record.id, 'client:', client.name, 'targetDoc:', targetDocumentId);

    try {
      // Progress callback
      const onProgress = (progress: number) => {
        uploadProgressModal.setProgress(progress);
      };

      // If a specific document ID is provided, only upload to that document
      if (targetDocumentId) {
        console.log('[handleFinalUpload] Uploading to specific document:', targetDocumentId);
        const result = await uploadFinalDocument(userEmail, targetDocumentId, file, client.name, `Final version uploaded: ${file.name}`, onProgress);
        console.log('[handleFinalUpload] Upload result:', result);
      } else {
        // Find existing documents for this work record
        const existingInvoice = invoices.find(d => d.workRecordId === record.id && d.type === 'invoice');
        const existingTimesheet = invoices.find(d => d.workRecordId === record.id && d.type === 'timesheet');
        console.log('[handleFinalUpload] Found invoice:', existingInvoice?.id, 'timesheet:', existingTimesheet?.id);

        // Upload as final version to the appropriate document(s)
        // If there's an invoice, upload as its final version
        if (existingInvoice) {
          console.log('[handleFinalUpload] Uploading final for invoice:', existingInvoice.id);
          const result = await uploadFinalDocument(userEmail, existingInvoice.id!, file, client.name, `Final version uploaded: ${file.name}`, onProgress);
          console.log('[handleFinalUpload] Upload result:', result);
        }

        // If there's a timesheet, upload as its final version
        if (existingTimesheet) {
          console.log('[handleFinalUpload] Uploading final for timesheet:', existingTimesheet.id);
          const result = await uploadFinalDocument(userEmail, existingTimesheet.id!, file, client.name, `Final version uploaded: ${file.name}`, onProgress);
          console.log('[handleFinalUpload] Upload result:', result);
        }

        // If no existing documents, show message
        if (!existingInvoice && !existingTimesheet) {
          console.log('[handleFinalUpload] No existing documents found');
          uploadProgressModal.closeUpload();
          alert('Please generate an invoice or timesheet first before uploading a final version.');
          e.target.value = '';
          return;
        }
      }

      // Set processing state while refreshing
      uploadProgressModal.setProcessing('Finalizing...');

      // Refresh documents list
      console.log('[handleFinalUpload] Refreshing documents...');
      const updatedDocs = await getDocuments(userEmail);
      console.log('[handleFinalUpload] Documents refreshed, count:', updatedDocs.length);
      setInvoices(updatedDocs);

      // Determine file format for success message
      const isExcel = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
      const isPdf = file.name.toLowerCase().endsWith('.pdf');

      // Show success state with details
      uploadProgressModal.setSuccess({
        documentType: targetDocumentId ? 'Document' : 'Invoice / Timesheet',
        fileFormat: isPdf ? 'PDF' : isExcel ? 'Excel' : 'File',
        fileName: file.name,
      });

      // Wait longer so user can see success state and details
      await new Promise(resolve => setTimeout(resolve, 2000));
      uploadProgressModal.closeUpload();
    } catch (err) {
      console.error('[handleFinalUpload] Failed to upload final version:', err);
      uploadProgressModal.setError('Failed to upload. Please try again.');
      // Keep modal open briefly so user can see error
      await new Promise(resolve => setTimeout(resolve, 2000));
      uploadProgressModal.closeUpload();
    } finally {
      e.target.value = '';
    }
  };

  /**
   * Execute the upload after confirmation
   */
  const executeUpload = async () => {
    if (!pendingUpload) return;

    const { file, record, client, targetDocumentId, isPdf } = pendingUpload;
    const fileName = file.name;

    // Close confirm dialog and open upload modal
    uploadProgressModal.openUpload(file.name);

    try {
      // Progress callback
      const onProgress = (progress: number) => {
        uploadProgressModal.setProgress(progress);
      };

      console.log('[executeUpload] Uploading to document:', targetDocumentId);
      const result = await uploadFinalDocument(
        userEmail,
        targetDocumentId,
        file,
        client.name,
        `Final version uploaded: ${file.name}`,
        onProgress
      );
      console.log('[executeUpload] Upload result:', result);

      // Set processing state while refreshing
      uploadProgressModal.setProcessing('Finalizing...');

      // Refresh documents list
      const updatedDocs = await getDocuments(userEmail);
      setInvoices(updatedDocs);

      // Show success state with details
      uploadProgressModal.setSuccess({
        documentType: pendingUpload.targetType.charAt(0).toUpperCase() + pendingUpload.targetType.slice(1),
        fileFormat: isPdf ? 'PDF' : 'Excel',
        fileName: fileName,
      });

      // Wait longer so user can see success state and details
      await new Promise(resolve => setTimeout(resolve, 2000));
      uploadProgressModal.closeUpload();
    } catch (err) {
      console.error('[executeUpload] Failed to upload:', err);
      uploadProgressModal.setError('Failed to upload. Please try again.');
      // Keep modal open briefly so user can see error
      await new Promise(resolve => setTimeout(resolve, 2000));
      uploadProgressModal.closeUpload();
    } finally {
      // Clear the file input
      const fileInput = document.getElementById(`smart-upload-${record.id}`) as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      setPendingUpload(null);
    }
  };

  /**
   * Smart upload handler - analyzes filename to determine document type and format
   * Shows confirmation modal before starting upload
   */
  const handleSmartUpload = async (e: React.ChangeEvent<HTMLInputElement>, record: WorkRecord, client: Client) => {
    const file = e.target.files?.[0];
    if (!file) {
      console.log('[handleSmartUpload] No file selected');
      return;
    }

    // Parse filename
    const fileName = file.name;
    const fileExt = fileName.toLowerCase().split('.').pop() || '';

    // Determine file format
    const isExcel = ['xlsx', 'xls'].includes(fileExt);
    const isPdf = fileExt === 'pdf';

    if (!isExcel && !isPdf) {
      alert('Please upload a PDF or Excel file (.pdf, .xlsx, .xls)');
      e.target.value = '';
      return;
    }

    // Determine document type from filename keywords
    const normalizedFileName = fileName.replace(/_/g, ' ');
    const hasInvoiceKeyword = /\binvoice\b/i.test(normalizedFileName);
    const hasTimesheetKeyword = /\btimesheet\b/i.test(normalizedFileName) || /\btime sheet\b/i.test(normalizedFileName);

    let targetType: 'invoice' | 'timesheet' | null = null;
    if (hasInvoiceKeyword && !hasTimesheetKeyword) {
      targetType = 'invoice';
    } else if (hasTimesheetKeyword && !hasInvoiceKeyword) {
      targetType = 'timesheet';
    } else if (hasInvoiceKeyword && hasTimesheetKeyword) {
      // Both keywords found - prefer invoice
      targetType = 'invoice';
    } else {
      // No clear keyword - check file format as hint
      targetType = isPdf ? 'invoice' : 'invoice'; // Default to invoice, user can change in modal
    }

    // Find available documents for this work record
    const existingInvoice = invoices.find(d => d.workRecordId === record.id && d.type === 'invoice');
    const existingTimesheet = invoices.find(d => d.workRecordId === record.id && d.type === 'timesheet');

    const availableDocuments: Array<{ id: string; type: 'invoice' | 'timesheet'; displayName: string }> = [];
    if (existingInvoice) {
      availableDocuments.push({
        id: existingInvoice.id!,
        type: 'invoice',
        displayName: existingInvoice.invoiceNumber || `Invoice - ${record.month}`
      });
    }
    if (existingTimesheet) {
      availableDocuments.push({
        id: existingTimesheet.id!,
        type: 'timesheet',
        displayName: existingTimesheet.fileName?.replace(/\.[^/.]+$/, '') || `Timesheet - ${record.month}`
      });
    }

    console.log('[handleSmartUpload] Available documents:', {
      invoiceId: existingInvoice?.id,
      timesheetId: existingTimesheet?.id,
      targetType
    });

    if (availableDocuments.length === 0) {
      alert(
        `No documents exist for this work record yet.\n\n` +
        `Please generate an invoice or timesheet first before uploading a file.`
      );
      e.target.value = '';
      return;
    }

    // Find the suggested target document
    let targetDocumentId = '';
    if (targetType === 'invoice' && existingInvoice) {
      targetDocumentId = existingInvoice.id!;
    } else if (targetType === 'timesheet' && existingTimesheet) {
      targetDocumentId = existingTimesheet.id!;
    } else {
      // Fallback to first available document
      targetDocumentId = availableDocuments[0].id;
      targetType = availableDocuments[0].type;
    }

    console.log('[handleSmartUpload] Detected:', { targetType, isPdf, fileName, targetDocumentId });

    // Store pending upload info
    setPendingUpload({
      file,
      record,
      client,
      targetType,
      targetDocumentId,
      isPdf,
    });

    // Open confirmation modal
    uploadProgressModal.openConfirm({
      fileName,
      documentType: targetType,
      fileFormat: isPdf ? 'PDF' : 'Excel',
      targetDocumentId,
      availableDocuments,
    });
  };

  /**
   * Handle confirmation from the modal
   */
  const handleUploadConfirm = (details: { documentType: 'invoice' | 'timesheet'; targetDocumentId: string }) => {
    if (pendingUpload) {
      // Update pending upload with confirmed details
      setPendingUpload({
        ...pendingUpload,
        targetType: details.documentType,
        targetDocumentId: details.targetDocumentId,
      });
      // Start upload after state update
      setTimeout(() => executeUpload(), 0);
    }
  };

  /**
   * Handle cancellation from the modal
   */
  const handleUploadCancel = () => {
    if (pendingUpload) {
      // Clear the file input
      const fileInput = document.getElementById(`smart-upload-${pendingUpload.record.id}`) as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    }
    setPendingUpload(null);
    uploadProgressModal.closeUpload();
  };

  const handleGenerateInvoice = async () => {
    if (!dialogRecord || !dialogClient || !invoiceNumber.trim()) return;

    setIsGenerating(true);
    try {
      const workbook = new ExcelJS.Workbook();

      // Use invoice template (new structure or legacy)
      const templateToUse = invoiceTemplate?.base64Data || dialogClient.templateBase64;
      if (!templateToUse) {
        alert('No invoice template uploaded for this client');
        setIsGenerating(false);
        return;
      }

      // Handle base64 data - remove data URL prefix if present
      let base64Data = templateToUse;
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }

      // Remove any whitespace that might have been added
      base64Data = base64Data.replace(/\s/g, '');

      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      await workbook.xlsx.load(bytes.buffer as ArrayBuffer);

      const worksheet = workbook.worksheets[0];

      // Force Excel to recalculate formulas when opened
      (workbook.calcProperties as any).fullCalcOnLoad = true;

      // Mark all formula cells for recalculation by clearing cached results
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.type === ExcelJS.ValueType.Formula) {
            const formulaValue = cell.value as { formula: string; result?: unknown };
            if (formulaValue && typeof formulaValue === 'object' && 'formula' in formulaValue) {
              cell.value = { formula: formulaValue.formula };
            }
          }
        });
      });

      // Use template mapping if available, otherwise fall back to client mapping
      const mapping = invoiceTemplate?.mapping || dialogClient.mapping;
      const setCell = (cellAddr: string, value: any) => {
        if (cellAddr && value !== undefined && value !== null) {
          const cell = worksheet.getCell(cellAddr);
          cell.value = value;
        }
      };

      // Calculate stats - amount is days * dailyRate (not hours * hourlyRate)
      const daysWorked = dialogRecord.workingDays.length;
      const dailyRate = dialogClient.dailyRate || 0;
      const totalAmount = daysWorked * dailyRate;

      // Set invoice metadata - date is always end of the month
      const monthDate = parseISO(dialogRecord.month + '-01');
      const endOfMonthDate = endOfMonth(monthDate);
      setCell(mapping.date, format(endOfMonthDate, 'dd/MM/yyyy'));
      setCell(mapping.invoiceNumber, invoiceNumber);
      setCell(mapping.daysWorked, daysWorked);
      setCell(mapping.dailyRate, dailyRate);
      setCell(mapping.totalAmount, totalAmount);

      // Handle description cell - preserve template content and update days count
      if (mapping.description) {
        try {
          const descCell = worksheet.getCell(mapping.description);
          // Check if formula - if so, leave it alone
          const isFormula = descCell.value && typeof descCell.value === 'object' && 'formula' in descCell.value;

          if (!isFormula) {
            const currentDescVal = descCell.value ? descCell.value.toString() : '';

            if (!currentDescVal.trim()) {
              // Case 1: Empty Description -> Generate standard string
              const monthName = format(monthDate, 'MMMM');
              const year = format(monthDate, 'yyyy');

              let newDesc = `Consulting Services for ${monthName} ${year}`;
              // If there is no specific 'daysWorked' column mapped, we usually want the days count in description
              if (!mapping.daysWorked) {
                newDesc += ` (${daysWorked} days)`;
              }
              descCell.value = newDesc;
            } else {
              // Case 2: Existing Description -> Preserve text, replace day count number if pattern exists
              // Look for "X days", "X units/working days", etc.
              const daysPattern = /(\d+)(\D{0,50}days?)/i;
              if (daysPattern.test(currentDescVal)) {
                descCell.value = currentDescVal.replace(daysPattern, `${daysWorked}$2`);
              }
              // If no pattern is found, we assume the user's template text is static or doesn't include days count.
            }
          }
        } catch (e) { console.warn("Invalid description cell address", e); }
      }

      // Replace placeholders throughout the worksheet
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === 'string') {
            cell.value = cell.value
              .replace(/\{\{CLIENT_NAME\}\}/g, dialogClient.name)
              .replace(/\{\{CLIENT_ADDRESS\}\}/g, dialogClient.address || '')
              .replace(/\{\{CLIENT_VAT\}\}/g, dialogClient.vatNumber || '')
              .replace(/\{\{INVOICE_NUMBER\}\}/g, invoiceNumber)
              .replace(/\{\{INVOICE_DATE\}\}/g, format(endOfMonthDate, 'dd/MM/yyyy'))
              .replace(/\{\{MONTH\}\}/g, dialogRecord.month)
              .replace(/\{\{TOTAL_HOURS\}\}/g, (daysWorked * 8).toString())
              .replace(/\{\{TOTAL_DAYS\}\}/g, daysWorked.toString());
          }
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();

      // Convert to base64 for storage (browser-compatible)
      const bufferBytes = new Uint8Array(buffer);
      let bufferBinary = '';
      for (let i = 0; i < bufferBytes.byteLength; i++) {
        bufferBinary += String.fromCharCode(bufferBytes[i]);
      }
      const bufferBase64 = btoa(bufferBinary);
      const fileData = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${bufferBase64}`;

      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = generatedFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const invoiceData: DocumentInput = {
        clientId: dialogClient.id!,
        clientName: dialogClient.name,
        workRecordId: dialogRecord.id,
        type: 'invoice',
        documentNumber: invoiceNumber,
        month: dialogRecord.month,
        workingDays: dialogRecord.workingDays.length,
        workingDaysArray: dialogRecord.workingDays,
        weekendDatesArray: dialogRecord.weekendDates,
        dailyRate: dialogClient.dailyRate || 0,
        totalAmount: daysWorked * (dialogClient.dailyRate || 0),
        fileName: generatedFileName,
        storagePath: '', // Will be set by saveDocument after upload
        downloadUrl: '', // Will be set by saveDocument after upload
        isOutdated: false,
        outdatedAt: null,
        isPaid: false, // Added missing property
      };

      await saveDocument(userEmail, invoiceData, existingInvoiceId || undefined, blob);

      const updatedInvoices = await getDocuments(userEmail);
      setInvoices(updatedInvoices);

      setShowInvoiceDialog(false);
      setDialogRecord(null);
      setDialogClient(null);
      setInvoiceNumber('');
      setExistingInvoiceId(null);
    } catch (error) {
      console.error('Error generating invoice:', error);
      alert('Failed to generate invoice');
    } finally {
      setIsGenerating(false);
    }
  };

  const openTimesheetDialog = async (record: WorkRecord) => {
    const client = clients.find((c) => c.id === record.clientId);
    if (!client) return;

    setTimesheetRecord(record);
    setTimesheetClient(client);
    setTimesheetPrompt(client.timesheetPrompt || '');
    setTimesheetError(null);
    setExistingTimesheetId(null);
    setTimesheetTemplate(null);

    // Load client's timesheet template from new structure
    if (client.timesheetTemplateId) {
      setLoadingTimesheetTemplate(true);
      try {
        const template = await getTemplateById(client.timesheetTemplateId);
        setTimesheetTemplate(template);
      } catch (err) {
        console.error('Error loading timesheet template:', err);
      } finally {
        setLoadingTimesheetTemplate(false);
      }
    }

    // Check for existing timesheet config for this month
    try {
      const existingTimesheet = await getTimesheetByWorkRecord(record.id);
      if (existingTimesheet) {
        setTimesheetPrompt(existingTimesheet.prompt || client.timesheetPrompt || '');
        setTimesheetMonthTemplate(existingTimesheet.templateStoragePath || null);
        setTimesheetMonthTemplateName(existingTimesheet.templateName || '');
        setExistingTimesheetId(existingTimesheet.id);
      } else {
        setTimesheetMonthTemplate(null);
        setTimesheetMonthTemplateName('');
      }
    } catch (error) {
      console.error('Error loading timesheet config:', error);
      setTimesheetMonthTemplate(null);
      setTimesheetMonthTemplateName('');
    }

    setShowTimesheetDialog(true);
  };

  const handleMonthTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const base64 = evt.target?.result as string;
      setTimesheetMonthTemplate(base64.split(',')[1]);
      setTimesheetMonthTemplateName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handleClearMonthTemplate = () => {
    setTimesheetMonthTemplate(null);
    setTimesheetMonthTemplateName('');
  };

  const handleGenerateTimesheet = async () => {
    if (!timesheetRecord || !timesheetClient) return;

    setIsGeneratingTimesheet(true);
    setTimesheetError(null);

    try {
      const workbook = new ExcelJS.Workbook();

      // Determine which template to use (priority: month-specific > new template structure > legacy)
      const templateToUse = timesheetMonthTemplate ||
        timesheetTemplate?.base64Data ||
        timesheetClient.timesheetTemplateBase64;
      const templateFileName = timesheetMonthTemplate
        ? timesheetMonthTemplateName
        : (timesheetTemplate?.fileName || timesheetClient.timesheetTemplateFileName);

      if (!templateToUse) {
        setTimesheetError('No timesheet template available. Please upload a template in the client settings or for this specific month.');
        setIsGeneratingTimesheet(false);
        return;
      }

      const binaryString = atob(templateToUse);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      await workbook.xlsx.load(bytes.buffer as ArrayBuffer);

      // Force Excel to recalculate formulas when opened
      (workbook.calcProperties as any).fullCalcOnLoad = true;

      // NEW: Best-Match Worksheet Selection
      let worksheet = workbook.worksheets.find(ws => ws.state === 'visible' || !ws.state) || workbook.worksheets[0];
      let maxScore = -1;

      for (const ws of workbook.worksheets) {
        if (ws.state === 'hidden') continue;

        // Base score: boost if name contains current month or "Timesheet"
        let dateScore = 0;
        const wsNameLower = ws.name.toLowerCase();
        const monthName = format(parseISO(timesheetRecord.month + '-01'), 'MMMM').toLowerCase();
        if (wsNameLower.includes(monthName)) dateScore += 10;
        if (wsNameLower.includes('timesheet')) dateScore += 5;

        for (let r = 1; r <= 30; r++) {
          const v = ws.getRow(r).getCell(1).value;
          // Check for Date objects, numbers (1-31), or month/date strings in Column A
          if (v instanceof Date || (typeof v === 'number' && v >= 1 && v <= 31)) dateScore += 1;
          if (typeof v === 'string' && (v.toLowerCase().includes('date') || v.toLowerCase().includes(monthName) || v.toLowerCase().match(/^\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}$/))) dateScore += 5;
        }

        if (dateScore > maxScore) {
          maxScore = dateScore;
          worksheet = ws;
        }
      }

      // Mark all formula cells for recalculation by clearing cached results
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.type === ExcelJS.ValueType.Formula) {
            const formulaValue = cell.value as { formula: string; result?: unknown };
            if (formulaValue && typeof formulaValue === 'object' && 'formula' in formulaValue) {
              cell.value = { formula: formulaValue.formula };
            }
          }
        });
      });

      // REMOVED: Clear ALL fills. User requested to preserve template formatting.
      // worksheet.eachRow((row) => { ... });

      // Process template with AI prompt guidance
      const workingDaysList = timesheetRecord.workingDays.map(dateStr => {
        const date = parseISO(dateStr);
        return {
          date: format(date, 'dd/MM/yyyy'),
          dayOfWeek: format(date, 'EEEE'),
          dayOfMonth: date.getDate(),
          month: format(date, 'MMMM'),
          year: date.getFullYear(),
        };
      });

      // Simple template processing - fill in dates
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === 'string') {
            let value = cell.value;

            // Replace placeholders
            value = value
              .replace(/\{\{CLIENT_NAME\}\}/g, timesheetClient.name)
              .replace(/\{\{CLIENT_ADDRESS\}\}/g, timesheetClient.address || '')
              .replace(/\{\{CLIENT_VAT\}\}/g, timesheetClient.vatNumber || '')
              .replace(/\{\{MONTH\}\}/g, timesheetRecord.month)
              .replace(/\{\{TOTAL_DAYS\}\}/g, timesheetRecord.workingDays.length.toString())
              .replace(/\{\{TOTAL_HOURS\}\}/g, (timesheetRecord.workingDays.length * 8).toString());

            cell.value = value;
          }
        });
      });

      // Simple approach: Only replace placeholders, don't add/remove rows or columns
      // The template structure is preserved exactly as uploaded

      // Replace placeholders throughout the worksheet
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === 'string') {
            let value = cell.value;

            // Replace placeholders
            value = value
              .replace(/\{\{CLIENT_NAME\}\}/g, timesheetClient.name)
              .replace(/\{\{CLIENT_ADDRESS\}\}/g, timesheetClient.address || '')
              .replace(/\{\{CLIENT_VAT\}\}/g, timesheetClient.vatNumber || '')
              .replace(/\{\{MONTH\}\}/g, timesheetRecord.month)
              .replace(/\{\{TOTAL_DAYS\}\}/g, timesheetRecord.workingDays.length.toString())
              .replace(/\{\{TOTAL_HOURS\}\}/g, (timesheetRecord.workingDays.length * 8).toString());

            cell.value = value;
          }
        });
      });

      // DISABLED: Legacy mapping code that overwrites template headers
      // The prompt-based approach (C11, C13-AG13, etc.) should be used instead
      // This prevents dates from being written to column A when using the Tesselate template
      /*
      const timesheetMapping = timesheetTemplate?.timesheetMapping || timesheetClient.timesheetMapping;
      if (timesheetMapping) {
        const { dateColumn, hoursColumn, descriptionColumn, startRow } = timesheetMapping;
        const firstDataRow = (startRow === 3 || !startRow) ? 2 : startRow;

        for (let i = 0; i < workingDaysList.length; i++) {
          const day = workingDaysList[i];
          const rowNum = firstDataRow + i;

          const row = worksheet.getRow(rowNum);
          if (row && !row.hidden) {
            if (dateColumn) {
              const dateCell = worksheet.getCell(`${dateColumn}${rowNum}`);
              if (!dateCell.value || typeof dateCell.value === 'string' && dateCell.value.includes('{{')) {
                dateCell.value = day.date;
              }
            }

            if (hoursColumn) {
              const hoursCell = worksheet.getCell(`${hoursColumn}${rowNum}`);
              if (!hoursCell.value || typeof hoursCell.value === 'string' && hoursCell.value.includes('{{')) {
                hoursCell.value = 8;
              }
            }

            if (descriptionColumn) {
              const descCell = worksheet.getCell(`${descriptionColumn}${rowNum}`);
              if (!descCell.value || typeof descCell.value === 'string' && descCell.value.includes('{{')) {
                descCell.value = `Working day - ${day.dayOfWeek}`;
              }
            }
          }
        }
      }
      */

      // Parse prompt using Gemini AI (with fallback to local parsing)
      let aiResult = null;
      try {
        aiResult = await processTimesheetPromptSmart({
          prompt: timesheetPrompt || '',
          workingDays: timesheetRecord.workingDays,
          clientName: timesheetClient.name,
          month: timesheetRecord.month,
        });
      } catch (aiError) {
        console.error('AI processing failed, will use fallback:', aiError);
      }

      // Fallback: Extract cell references and instructions from the prompt locally
      const promptLower = (timesheetPrompt || '').toLowerCase();

      // Look for cell references like "cell C11", ranges like "C13 to AG13", etc.
      const periodCellMatch = promptLower.match(/(?:period|date).*?cell\s+([a-z]+\d+)/i);

      // Match cell ranges like "cells c13 to ag13" or "c13 up to ag13" or "c14 to ag14"
      const dayNumbersRangeMatch = promptLower.match(/(?:day numbers|cells)\s+([a-z]+\d+).*?(?:to|up to)\s+([a-z]+\d+)/i);
      // Enhanced data row match to catch "data row... cells c14 up to ag14"
      const dataRangeMatch = promptLower.match(/(?:data row|work hours).*?\(?cells?\s+([a-z]+\d+).*?(?:to|up to)\s+([a-z]+\d+)\)?/i);
      const hoursValueMatch = promptLower.match(/(?:place|put|fill).*?(\d+(?:\.\d+)?).*?(?:hours?|work)/i);

      // Extract values from AI result or use local parsing
      const aiAnalysis = aiResult?.geminiAnalysis;

      // Period cell (e.g., C11)
      const periodCellValue = aiAnalysis?.periodCell || (periodCellMatch ? periodCellMatch[1] : null);

      // Day numbers range (e.g., C13 to AG13)
      const dayNumbersStart = aiAnalysis?.dayNumbersRange?.start || (dayNumbersRangeMatch ? dayNumbersRangeMatch[1] : null);
      const dayNumbersEnd = aiAnalysis?.dayNumbersRange?.end || (dayNumbersRangeMatch ? dayNumbersRangeMatch[2] : null);

      // Data range / hours range (e.g., C14 to AG14)
      const dataRangeStart = aiAnalysis?.hoursRange?.start || (dataRangeMatch ? dataRangeMatch[1] : null);
      const dataRangeEnd = aiAnalysis?.hoursRange?.end || (dataRangeMatch ? dataRangeMatch[2] : null);



      // Parse the work record month for period cell
      const [year, month] = timesheetRecord.month.split('-').map(Number);
      const daysInMonth = getDaysInMonth(new Date(year, month - 1));
      const firstDayOfMonth = new Date(year, month - 1, 1);
      const lastDayOfMonth = new Date(year, month - 1, daysInMonth);

      // Format period as "01-January-2025 -> 31-January-2025"
      const formatDateForPeriod = (date: Date) => {
        const day = date.getDate().toString().padStart(2, '0');
        const monthName = format(date, 'MMMM-yyyy');
        return `${day}-${monthName}`;
      };

      const periodText = `${formatDateForPeriod(firstDayOfMonth)} -> ${formatDateForPeriod(lastDayOfMonth)}`;

      // Update period cell if specified (e.g., C11)
      if (periodCellValue) {
        const periodCell = worksheet.getCell(periodCellValue.toUpperCase());
        periodCell.value = periodText;
      }

      // NEW: Vertical Fill Support (e.g. "In column B, fill a 1 for working days... If it's a day off put a 0 in column B and 'Other' in column C")
      const verticalFillMatch = promptLower.match(/in\s+col(?:umn)?\s+([a-z]+),?\s+fill\s+(?:a\s+)?(?!the\b|all\b)([^, ]+).*?date\s+in.*?col(?:umn)?\s+([a-z]+)/i);

      // ONLY sync dates when explicitly requested in the prompt
      // Do NOT auto-trigger - this prevents overwriting template data
      const baseDateFillMatch = promptLower.match(/in\s+col(?:umn)?\s+([a-z]+)\s+fill\s+(?:the\s+)?dates/i);
      // Use vertical fill's date column only if vertical fill is also requested
      const dateFillMatch = baseDateFillMatch || (verticalFillMatch ? [null, verticalFillMatch[3]] : null);

      // Only rename worksheet if explicitly requested
      const renameSheetMatch = promptLower.match(/rename\s+(?:the\s+)?(?:excel\s+)?worksheet|replace\s+(?:the\s+)?(?:excel\s+)?worksheet'?s\s+name/i);

      if (verticalFillMatch || dateFillMatch) {
        // Target columns for status fill (if present)
        const targetCol = verticalFillMatch ? verticalFillMatch[1].toUpperCase() : null;
        const fillValueStr = verticalFillMatch ? verticalFillMatch[2] : null;
        const refCol = (verticalFillMatch ? verticalFillMatch[3] : dateFillMatch?.[1])?.toUpperCase() as string;
        const fillValue = fillValueStr ? (isNaN(Number(fillValueStr)) ? fillValueStr : Number(fillValueStr)) : null;

        // Safety: If targetCol is the same as refCol, it's likely a mis-match
        const finalTargetCol = (targetCol && targetCol !== refCol) ? targetCol : null;

        // Day off settings
        let dayOffValue: any = null;
        let dayOffCol: string | null = null;
        let dayOffLabel: string | null = null;
        let dayOffLabelCol: string | null = null;

        const dayOffMatch = (timesheetPrompt || '').match(/day\s+off.*?put\s+(?:a\s+)?([^ ]+)\s+in\s+col(?:umn)?\s+([a-z]+)(?:\s+and\s+['"]([^'"]+)['"]\s+in\s+col(?:umn)?\s+([a-z]+))?/i);

        if (dayOffMatch) {
          const val = dayOffMatch[1];
          dayOffValue = isNaN(Number(val)) ? val : Number(val);
          dayOffCol = dayOffMatch[2].toUpperCase();
          dayOffLabel = dayOffMatch[3];
          dayOffLabelCol = dayOffMatch[4]?.toUpperCase();
        }

        if (dayOffMatch) {
          // Day off logic configured
        }

        const workingDaySet = new Set(timesheetRecord.workingDays);
        const excludedDatesSet = new Set(timesheetRecord.config.excludedDates);
        const recordMonth = timesheetRecord.month; // "YYYY-MM"
        const [yearNum, monthNum] = recordMonth.split('-').map(Number);
        const daysInMonth = getDaysInMonth(parseISO(recordMonth + '-01'));

        // PASS 1: DATE SYNC (if requested)
        if (dateFillMatch) {

          let startRow = -1;
          const getDayVal = (cell: any) => {
            let v = cell.value;
            if (v && typeof v === 'object' && 'result' in v) v = v.result;
            if (!v) return -1;

            // 1. Try native Date object
            if (v instanceof Date) return v.getDate();

            // 2. Try parsing string as a date
            if (typeof v === 'string') {
              const d = new Date(v);
              if (!isNaN(d.getTime())) return d.getDate();

              // 3. Last resort: look for any standalone 1..31 in the string
              // This catches "Thursday, Jan 1, 2026" or "1-Jan"
              const standaloneMatch = v.match(/\b([0123]?\d)\b/);
              if (standaloneMatch) {
                const num = parseInt(standaloneMatch[1]);
                if (num >= 1 && num <= 31) return num;
              }
            }

            if (typeof v === 'number') {
              if (v >= 1 && v <= 31) return v;
              if (v > 40000) return new Date(Math.round((v - 25569) * 86400 * 1000)).getDate();
            }
            return -1;
          };

          // FINAL DECISION: User has repeatedly confirmed start row is 2.
          // We force 2 to ensure no leftover March/January dates.
          startRow = 2;

          if (startRow !== -1) {
            // Fill days only in rows that are meant for dates
            // Only write to cells that are empty, contain placeholders, or look like existing dates
            for (let i = 0; i < daysInMonth; i++) {
              const currentRow = startRow + i;
              const cell = worksheet.getRow(currentRow).getCell(refCol);

              // Check if cell is safe to overwrite (empty, placeholder, or existing date)
              const currentValue = cell.value;
              const isEmpty = currentValue === null || currentValue === undefined;
              const isPlaceholder = typeof currentValue === 'string' && currentValue.includes('{{');
              const isExistingDate = getDayVal(cell) !== -1;

              // Only write if the cell looks like it's meant for dates
              if (isEmpty || isPlaceholder || isExistingDate) {
                // Create a UTC date at midnight to avoid local timezone shifts
                const dUTC = new Date(Date.UTC(yearNum, monthNum - 1, i + 1));
                // Convert to Excel serial date (25569 is Jan 1, 1970)
                // Using an integer ensures NO time portion in Excel
                const serialDate = (dUTC.getTime() / (24 * 60 * 60 * 1000)) + 25569;
                cell.value = serialDate;
                cell.numFmt = 'dddd, mmmm d, yyyy'; // descriptive: "Wednesday, April 1, 2026"
              }
            }

            // Clear leftover days (e.g. days 31 in a 30-day month)
            // BUT ONLY if they look like dates! This preserves "Total" or "Signature" lines.
            for (let i = daysInMonth; i < 31; i++) {
              const currentRow = startRow + i;
              const cell = worksheet.getRow(currentRow).getCell(refCol);
              if (getDayVal(cell) !== -1) {
                cell.value = null;
                if (targetCol) worksheet.getRow(currentRow).getCell(targetCol).value = null;
                if (dayOffCol) worksheet.getRow(currentRow).getCell(dayOffCol).value = null;
                if (dayOffLabelCol) worksheet.getRow(currentRow).getCell(dayOffLabelCol).value = null;
              }
            }
          }
        }

        // PASS 2: STATUS FILL

        worksheet.eachRow((row) => {
          const dateCell = row.getCell(refCol);
          const targetCell = finalTargetCol ? row.getCell(finalTargetCol) : null;

          // Extract value, handling formula results
          let actualValue = dateCell.value;
          if (actualValue && typeof actualValue === 'object' && 'result' in actualValue) {
            actualValue = (actualValue as any).result;
          }

          if (actualValue === null || actualValue === undefined) return;

          let foundDate: string | null = null;
          let dateObj: Date | null = null;

          // 1. Try to get a Date object
          if (actualValue instanceof Date && !isNaN(actualValue.getTime())) {
            dateObj = actualValue;
          } else if (typeof actualValue === 'number') {
            if (actualValue > 40000) {
              // Serial date (Excel format)
              dateObj = new Date(Math.round((actualValue - 25569) * 86400 * 1000));
            } else if (actualValue >= 1 && actualValue <= 31) {
              // Simple day number (e.g. 1, 2, 3 in a list)
              const [y, m] = recordMonth.split('-').map(Number);
              dateObj = new Date(y, m - 1, actualValue);
            }
          } else if (typeof actualValue === 'string') {
            const parsed = parseISO(actualValue);
            if (isValid(parsed)) {
              dateObj = parsed;
            } else {
              // Try parsing simple day number from string
              const num = parseInt(actualValue);
              if (!isNaN(num) && num >= 1 && num <= 31) {
                const [y, m] = recordMonth.split('-').map(Number);
                dateObj = new Date(y, m - 1, num);
              }
            }
          }

          if (dateObj && isValid(dateObj)) {
            // 2. Extract YYYY-MM-DD strings for both Local and UTC
            const toStr = (d: Date, useUTC: boolean) => {
              const yy = useUTC ? d.getUTCFullYear() : d.getFullYear();
              const mm = (useUTC ? d.getUTCMonth() : d.getMonth()) + 1;
              const dd = useUTC ? d.getUTCDate() : d.getDate();
              return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
            };

            const localStr = toStr(dateObj, false);
            const utcStr = toStr(dateObj, true);

            // 3. HYPER-ROBUST MATCHING: Use the representation that matches the record's data
            // This bypasses any timezone shift issues (e.g. UTC midnight parsed as previous day local)
            if (workingDaySet.has(localStr) || excludedDatesSet.has(localStr)) {
              foundDate = localStr;
            } else if (workingDaySet.has(utcStr) || excludedDatesSet.has(utcStr)) {
              foundDate = utcStr;
            } else if (localStr.startsWith(recordMonth)) {
              foundDate = localStr;
            } else if (utcStr.startsWith(recordMonth)) {
              foundDate = utcStr;
            }
          }

          if (foundDate) {
            const isWorkingValue = workingDaySet.has(foundDate);
            const isManualExclusion = excludedDatesSet.has(foundDate);

            if (isWorkingValue) {
              // Tier 1: Working Day
              if (targetCell) targetCell.value = fillValue;
            } else if (isManualExclusion) {
              // Tier 2: Explicitly excluded weekday (Day Off)
              if (dayOffCol) {
                const doCell = row.getCell(dayOffCol);
                doCell.value = dayOffValue;
              }
              if (dayOffLabelCol && dayOffLabel) {
                const dolCell = row.getCell(dayOffLabelCol);
                dolCell.value = dayOffLabel;
              }
            } else {
              // Tier 3: Standard Non-Working Day (Weekend/Holiday)
              if (targetCell) targetCell.value = null;
              if (dayOffLabelCol) {
                const dolCell = row.getCell(dayOffLabelCol);
                dolCell.value = null;
              }
            }
          }
        });
      }

      // Helper function to convert column letter to number (A=1, B=2, etc.)
      const colLetterToNumber = (col: string): number => {
        let result = 0;
        for (let i = 0; i < col.length; i++) {
          result = result * 26 + (col.charCodeAt(i) - 64);
        }
        return result;
      };

      // Helper function to convert column number to letter (1=A, 2=B, etc.)
      const colNumberToLetter = (num: number): string => {
        let result = '';
        while (num > 0) {
          num--;
          result = String.fromCharCode(65 + (num % 26)) + result;
          num = Math.floor(num / 26);
        }
        return result;
      };

      // Update day numbers in the specified range (e.g., C13 to AG13)
      if (dayNumbersStart && dayNumbersEnd) {
        const startCell = dayNumbersStart.toUpperCase();
        const endCell = dayNumbersEnd.toUpperCase();

        // Extract row and columns
        const startRow = parseInt(startCell.match(/\d+/)![0]);
        const startCol = startCell.match(/[A-Z]+/)![0];
        const endCol = endCell.match(/[A-Z]+/)![0];

        const startColNum = colLetterToNumber(startCol);
        const endColNum = colLetterToNumber(endCol);

        console.log(`Processing day numbers in row ${startRow}, columns ${startCol}(${startColNum}) to ${endCol}(${endColNum})`);

        // STEP 1: Clear ALL day number cells in the range first (handles months with < 31 days)
        for (let colNum = startColNum; colNum <= endColNum; colNum++) {
          const cell = worksheet.getRow(startRow).getCell(colNum);
          if (cell) {
            cell.value = null;
          }
        }

        // STEP 2: Fill day numbers starting from 1, only up to daysInMonth
        for (let colNum = startColNum, dayNum = 1; colNum <= endColNum && dayNum <= daysInMonth; colNum++, dayNum++) {
          const cell = worksheet.getRow(startRow).getCell(colNum);
          if (cell) {
            cell.value = dayNum;
          }
        }

      }

      // Fill hours in data row range for working days only (e.g., C14 to AG14)
      const hoursPerDay = aiResult?.mapping?.hoursPerDay || (hoursValueMatch ? parseFloat(hoursValueMatch[1]) : 8);

      if (dataRangeStart && dataRangeEnd) {
        const startCell = dataRangeStart.toUpperCase();
        const endCell = dataRangeEnd.toUpperCase();

        // Extract row and columns
        const dataRow = parseInt(startCell.match(/\d+/)![0]);
        let startCol = startCell.match(/[A-Z]+/)![0];
        let endCol = endCell.match(/[A-Z]+/)![0];

        const startColNumInitial = colLetterToNumber(startCol);

        // FIX: Ensure data/styling loop aligns with day numbers loop if available
        // This prevents "shifting" of gray cells if the AI/Regex detects slightly different start columns
        if (dayNumbersStart && typeof dayNumbersStart === 'string') {
          try {
            const dayStartCellUpper = dayNumbersStart.toUpperCase();
            const dayStartColMatch = dayStartCellUpper.match(/[A-Z]+/);

            if (dayStartColMatch) {
              const dayStartCol = dayStartColMatch[0];
              if (dayStartCol !== startCol) {
                // Calculate shift to adjust endCol as well
                const oldStartNum = colLetterToNumber(startCol);
                const newStartNum = colLetterToNumber(dayStartCol);
                const shift = newStartNum - oldStartNum;

                const oldEndNum = colLetterToNumber(endCol);
                endCol = colNumberToLetter(oldEndNum + shift);
                startCol = dayStartCol;
              }
            }
          } catch (e) {
            console.error('Error in column alignment logic:', e);
            // Fallback: proceed with original startCol
          }
        }

        const startColNum = colLetterToNumber(startCol);
        const endColNum = colLetterToNumber(endCol);

        // Convert working days to a Set for quick lookup (using day of month as number)
        const workingDayNumbers = new Set(
          timesheetRecord.workingDays.map(dateStr => parseInt(dateStr.split('-')[2]))
        );

        // STEP 1: Clear hours cells values only (not backgrounds)
        for (let colNum = startColNum; colNum <= endColNum; colNum++) {
          const cell = worksheet.getRow(dataRow).getCell(colNum);
          if (cell) {
            cell.value = null;
          }
        }

        // Extract day numbers row index if available
        let dayNumbersRowIndex: number | null = null;
        if (dayNumbersStart && typeof dayNumbersStart === 'string') {
          const match = dayNumbersStart.match(/(\d+)/);
          if (match) {
            dayNumbersRowIndex = parseInt(match[1]);
          }
        }

        // STEP 3: Fill hours
        // We iterate based on the range, but we ONLY act if we find a valid day number
        // We do typically 31 columns max
        for (let colNum = startColNum; colNum <= endColNum; colNum++) {
          const cell = worksheet.getRow(dataRow).getCell(colNum);
          if (!cell) continue;

          let isValidDay = false;
          let currentDayNum = 0;

          // PREFERRED: Read the actual day number from the sheet if we know the row
          if (dayNumbersRowIndex) {
            const dayNumCell = worksheet.getRow(dayNumbersRowIndex).getCell(colNum);
            const cellValue = dayNumCell.value;

            // Try to parse number from cell value
            let parsedDayNum = -1;
            if (typeof cellValue === 'number') {
              parsedDayNum = cellValue;
            } else if (typeof cellValue === 'string') {
              parsedDayNum = parseInt(cellValue);
            }

            if (parsedDayNum > 0 && parsedDayNum <= 31) {
              currentDayNum = parsedDayNum;
              isValidDay = true;
            }
          }

          if (isValidDay && workingDayNumbers.has(currentDayNum)) {
            cell.value = hoursPerDay;
          }
        }
      }

      // NEW: Worksheet Renaming
      if (renameSheetMatch) {
        try {
          const oldName = worksheet.name || '';
          const date = parseISO(timesheetRecord.month + '-01');
          let newName = format(date, 'MMMM yyyy'); // Default: April 2026

          // Attempt to preserve style
          if (oldName.match(/^[a-z]{3}\s+'?\d{2}$/i)) {
            // Style: Jan '26 or Jan 26
            const quote = oldName.includes("'") ? "'" : "";
            newName = format(date, `MMM ${quote}yy`);
          } else if (oldName.match(/^[a-z]+\s+\d{4}$/i)) {
            // Style: January 2026
            newName = format(date, 'MMMM yyyy');
          } else if (oldName.match(/^\d{2}[-.]\d{4}$/) || oldName.match(/^\d{4}[-.]\d{2}$/)) {
            // Style: 04.2026 or 2026-04
            const sep = oldName.includes('.') ? '.' : '-';
            if (oldName.startsWith('20')) {
              newName = format(date, `yyyy${sep}MM`);
            } else {
              newName = format(date, `MM${sep}yyyy`);
            }
          }

          worksheet.name = newName;
        } catch (e) {
          console.error('Error renaming worksheet:', e);
        }
      }

      const buffer = await workbook.xlsx.writeBuffer();

      // Convert to base64 for storage (browser-compatible)
      const bufferBytes = new Uint8Array(buffer);
      let bufferBinary = '';
      for (let i = 0; i < bufferBytes.byteLength; i++) {
        bufferBinary += String.fromCharCode(bufferBytes[i]);
      }
      const bufferBase64 = btoa(bufferBinary);
      const fileData = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${bufferBase64}`;

      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);

      const finalFileName = (timesheetFileName || `Timesheet_${timesheetClient.name.replace(/[^a-zA-Z0-9]/g, '_')}_${timesheetRecord.month.replace('-', '_')}`).trim();
      const fileName = finalFileName.endsWith('.xlsx') ? finalFileName : `${finalFileName}.xlsx`;

      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Save document to database with fileData (so it appears in DocumentManager and can be downloaded)
      const documentData: DocumentInput = {
        clientId: timesheetClient.id!,
        clientName: timesheetClient.name,
        workRecordId: timesheetRecord.id,
        type: 'timesheet',
        documentNumber: `TS-${timesheetRecord.month}`,
        month: timesheetRecord.month,
        workingDays: timesheetRecord.workingDays.length,
        workingDaysArray: timesheetRecord.workingDays,
        weekendDatesArray: timesheetRecord.weekendDates,
        dailyRate: timesheetClient.dailyRate || 0,
        totalAmount: (timesheetRecord.workingDays.length * (timesheetClient.dailyRate || 0)),
        fileName: fileName,
        storagePath: '', // Will be set by saveDocument after upload
        downloadUrl: '', // Will be set by saveDocument after upload
        isPaid: false,
        isOutdated: false,
        outdatedAt: null,
      };

      // Check for existing document to overwrite
      const existingDoc = invoices.find(
        (d) => d.workRecordId === timesheetRecord.id && d.type === 'timesheet'
      );
      await saveDocument(userEmail, documentData, existingDoc?.id, blob);

      // Refresh invoices list
      const updatedDocs = await getDocuments(userEmail);
      setInvoices(updatedDocs);

      // Save timesheet configuration
      const timesheetData: WorkRecordTimesheetInput = {
        clientId: timesheetClient.id!,
        workRecordId: timesheetRecord.id,
        month: timesheetRecord.month,
        prompt: timesheetPrompt || null,
        templateStoragePath: timesheetMonthTemplate || null,
        templateName: timesheetMonthTemplateName || null,
      };

      await saveTimesheet(userEmail, timesheetData, existingTimesheetId || undefined);

      setShowTimesheetDialog(false);
      setTimesheetRecord(null);
      setTimesheetClient(null);
      setTimesheetPrompt('');
      setTimesheetMonthTemplate(null);
      setTimesheetMonthTemplateName('');
      setExistingTimesheetId(null);
    } catch (error: any) {
      console.error('Error generating timesheet:', error);
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      setTimesheetError(`Failed to generate timesheet: ${errorMessage}`);
    } finally {
      setIsGeneratingTimesheet(false);
    }
  };

  const formatMonthYear = (monthStr: string): string => {
    try {
      const [year, month] = monthStr.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, 1);
      return format(date, 'MMMM yyyy');
    } catch {
      return monthStr;
    }
  };

  const getClientName = (clientId: string): string => {
    return clients.find((c) => c.id === clientId)?.name || 'Unknown Client';
  };

  const getInvoiceForRecord = (recordId: string): Document | undefined => {
    const invoice = invoices.find(
      (inv) => inv.workRecordId === recordId && inv.type === 'invoice'
    );
    if (recordId.includes('7ec3438d')) { // February Tesselate record
      console.log('[getInvoiceForRecord] Looking for record:', recordId.slice(0, 8));
      console.log('[getInvoiceForRecord] Found invoice:', invoice?.id?.slice(0, 8));
      console.log('[getInvoiceForRecord] Invoice type:', invoice?.type);
      console.log('[getInvoiceForRecord] All invoices for this workRecordId:',
        invoices.filter(inv => inv.workRecordId === recordId).map(i => ({
          id: i.id.slice(0, 8),
          type: i.type,
          status: i.status
        }))
      );
    }
    return invoice;
  };

  const getTimesheetForRecord = (recordId: string): Document | undefined => {
    return invoices.find(
      (inv) => inv.workRecordId === recordId && inv.type === 'timesheet'
    );
  };

  // ============================================
  // Render
  // ============================================

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Briefcase size={28} className="text-indigo-600" />
            Work Records
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Manage your working days and generate invoices
          </p>
        </div>
        <button
          onClick={onCreateWorkRecord}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus size={20} />
          New Work Record
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-sm mb-1">
            <Briefcase size={16} />
            Total Records
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {stats.totalRecords}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-sm mb-1">
            <Clock size={16} />
            Total Days
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {stats.totalDays}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-sm mb-1">
            <FileSpreadsheet size={16} />
            Invoices
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {new Set(invoices.filter((inv) => inv.type === 'invoice').map((inv) => inv.workRecordId)).size}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-sm mb-1">
            <Calendar size={16} />
            Timesheets
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {new Set(invoices.filter((inv) => inv.type === 'timesheet').map((inv) => inv.workRecordId)).size}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search by client or month..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
        <select
          value={selectedClientId}
          onChange={(e) => setSelectedClientId(e.target.value)}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none min-w-[200px]"
        >
          <option value="">All Clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        
        {/* Refresh Button */}
        <button
          onClick={() => {
            console.log('[WorkRecordList] Manual refresh triggered');
            setRefreshKey(prev => prev + 1);
          }}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg border border-slate-300 dark:border-slate-600 transition disabled:opacity-50"
          title="Refresh data"
        >
          <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Records List */}
      {sortedMonths.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
          <Briefcase size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
            No work records found
          </h3>
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            {searchQuery || selectedClientId
              ? 'Try adjusting your filters'
              : 'Create your first work record to get started'}
          </p>
          {!searchQuery && !selectedClientId && (
            <button
              onClick={onCreateWorkRecord}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Plus size={18} />
              Create Work Record
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {sortedMonths.map((month) => (
            <div
              key={month}
              className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700"
            >
              {/* Month Header */}
              <div className="px-4 sm:px-6 py-4 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <CalendarIcon size={18} className="text-indigo-600" />
                  <h3 className="font-semibold text-slate-900 dark:text-white">
                    {formatMonthYear(month)}
                  </h3>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    ({groupedByMonth[month].length} records)
                  </span>
                </div>
              </div>

              {/* Records for this month */}
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {groupedByMonth[month].map((record) => {
                  const client = clients.find((c) => c.id === record.clientId);
                  const invoice = getInvoiceForRecord(record.id);
                  const timesheet = getTimesheetForRecord(record.id);
                  
                  // Debug logging
                  if (invoice || timesheet) {
                    console.log('[Render] Record:', record.id.slice(0, 8),
                      'Invoice:', invoice?.id?.slice(0, 8),
                      'Timesheet:', timesheet?.id?.slice(0, 8),
                      'Invoice finalUrl:', invoice?.finalDownloadUrl?.slice(0, 30));
                  }
                  
                  // Status-based logic
                  const invoiceStatus = invoice ? getEffectiveStatus(invoice) : null;
                  const timesheetStatus = timesheet ? getEffectiveStatus(timesheet) : null;
                  const hasFinalInvoice = invoice ? hasFinalVersion(invoice) : false;
                  const hasFinalTimesheet = timesheet ? hasFinalVersion(timesheet) : false;
                  // Check for format-specific versions (NEW: Replace by Format)
                  const hasInvoicePdf = invoice ? hasPdfVersion(invoice) : false;
                  const hasInvoiceExcel = invoice ? hasExcelVersion(invoice) : false;
                  const hasTimesheetPdf = timesheet ? hasPdfVersion(timesheet) : false;
                  const hasTimesheetExcel = timesheet ? hasExcelVersion(timesheet) : false;
                  const isInvoicePaid = invoice?.isPaid;

                  const isInvoiceDropdownOpen = openDropdown?.type === 'invoice' && openDropdown?.recordId === record.id;
                  const isTimesheetDropdownOpen = openDropdown?.type === 'timesheet' && openDropdown?.recordId === record.id;

                  return (
                    <div
                      key={record.id}
                      className="px-4 sm:px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group relative"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        {/* Left: Client Info */}
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                            <Building2 size={20} className="text-indigo-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-slate-900 dark:text-white">
                              {client?.name || 'Unknown Client'}
                            </h4>
                            <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400 mt-1">
                              <span className="flex items-center gap-1">
                                <Clock size={14} />
                                {record.workingDays.length} days
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Right: Status Badges & Actions */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Excel Invoice Badge & Dropdown */}
                          {invoice && (
                            <div className="relative">
                              <button
                                ref={(el) => {
                                  if (el) invoiceButtonRefs.current.set(record.id, el);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = invoiceButtonRefs.current.get(record.id)?.getBoundingClientRect();
                                  if (rect) {
                                    setDropdownPosition({ top: rect.bottom + 4, left: rect.left });
                                  }
                                  setOpenDropdown(
                                    openDropdown?.type === 'invoice' && openDropdown?.recordId === record.id
                                      ? null
                                      : { type: 'invoice', recordId: record.id }
                                  );
                                }}
                                className="flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                title={`Invoice - ${hasInvoicePdf && hasInvoiceExcel ? 'PDF + Excel' : hasInvoiceExcel ? 'Excel only' : 'Generated'}`}
                              >
                                <FileSpreadsheet size={14} className="text-indigo-500" />
                                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Invoice</span>
                                {/* Format badges - show both if both exist */}
                                <div className="flex items-center gap-1">
                                  {hasInvoiceExcel && (
                                    <span className="text-[10px] px-1 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded">
                                      Excel
                                    </span>
                                  )}
                                  {hasInvoicePdf && (
                                    <span className="text-[10px] px-1 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded">
                                      PDF
                                    </span>
                                  )}
                                </div>
                                <StatusBadge status={getEffectiveStatus(invoice)} size="sm" timestamp={invoice.paidAt || invoice.sentAt || invoice.finalizedAt || invoice.generatedAt} />
                              </button>

                              {/* Invoice Dropdown Menu */}
                              {isInvoiceDropdownOpen && dropdownPosition && (
                                <div
                                  className="fixed w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-[9999] py-1"
                                  style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openInvoiceDialog(record);
                                      setOpenDropdown(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                  >
                                    <RefreshCw size={14} />
                                    Regenerate Excel
                                  </button>
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      let excelUrl = getExcelDownloadUrl(invoice);
                                      // If no Excel URL found, try to regenerate from storage path
                                      if (!excelUrl && invoice.storagePath) {
                                        excelUrl = await regenerateExcelUrl(invoice);
                                      }
                                      if (excelUrl) {
                                        try {
                                          const response = await fetch(excelUrl);
                                          const blob = await response.blob();
                                          const url = window.URL.createObjectURL(blob);
                                          const link = document.createElement('a');
                                          link.href = url;
                                          link.download = invoice.fileName || 'invoice.xlsx';
                                          document.body.appendChild(link);
                                          link.click();
                                          document.body.removeChild(link);
                                          window.URL.revokeObjectURL(url);
                                        } catch (err) {
                                          console.error('Download failed:', err);
                                          window.open(excelUrl, '_blank');
                                        }
                                      } else {
                                        alert('Excel file not found. The file may have been deleted or the URL is no longer valid. Please regenerate the invoice.');
                                      }
                                      setOpenDropdown(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                  >
                                    <Download size={14} />
                                    Download Excel
                                  </button>
                                  {hasInvoicePdf && (
                                    <>
                                      <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
                                      <button
                                        onClick={async (e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          const pdfUrl = await getFreshPdfUrl(invoice);
                                          if (pdfUrl) {
                                            try {
                                              // Fetch the PDF content
                                              const response = await fetch(pdfUrl);
                                              const blob = await response.blob();
                                              
                                              // Get clean filename - use the stored filename but remove Firebase timestamp suffixes only
                                              // Firebase adds timestamps like "-1234567890" before the extension
                                              const rawFileName = invoice.finalFileName || invoice.fileName || 'invoice.pdf';
                                              // Only remove long numeric suffixes (Firebase timestamps are 10+ digits), not years (4 digits)
                                              const cleanFileName = rawFileName.replace(/(-\d{10,})\.pdf$/i, '.pdf');
                                              
                                              // Try File System Access API first (forces save dialog, no preview)
                                              let downloaded = false;
                                              if ('showSaveFilePicker' in window) {
                                                try {
                                                  const handle = await (window as any).showSaveFilePicker({
                                                    suggestedName: cleanFileName,
                                                    types: [{
                                                      description: 'PDF files',
                                                      accept: { 'application/pdf': ['.pdf'] }
                                                    }]
                                                  });
                                                  const writable = await handle.createWritable();
                                                  await writable.write(blob);
                                                  await writable.close();
                                                  downloaded = true;
                                                } catch (err: any) {
                                                  // If user cancels, stop silently (don't preview)
                                                  if (err?.name === 'AbortError') {
                                                    downloaded = true;
                                                  } else {
                                                    console.log('File System Access API failed, using anchor fallback:', err);
                                                  }
                                                }
                                              }

                                              // Fallback: Use blob + anchor download (never preview by default)
                                              if (!downloaded) {
                                                const blobUrl = window.URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = blobUrl;
                                                a.download = cleanFileName;
                                                a.rel = 'noopener noreferrer';
                                                a.style.display = 'none';
                                                document.body.appendChild(a);
                                                a.click();
                                                a.remove();
                                                setTimeout(() => window.URL.revokeObjectURL(blobUrl), 250);
                                              }
                                            } catch (err) {
                                              console.error('Download failed:', err);
                                              // Final fallback: open in new tab with download query param
                                              const downloadUrl = new URL(pdfUrl);
                                              downloadUrl.searchParams.set('download', '1');
                                              const newWindow = window.open(downloadUrl.toString(), '_blank');
                                              if (!newWindow) {
                                                // If popup blocked, try direct navigation
                                                window.location.href = pdfUrl;
                                              }
                                            }
                                          }
                                          setOpenDropdown(null);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                      >
                                        <Download size={14} />
                                        Download PDF
                                      </button>
                                      <button
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          const pdfUrl = await getFreshPdfUrl(invoice);
                                          if (pdfUrl) window.open(pdfUrl, '_blank');
                                          setOpenDropdown(null);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                      >
                                        <Eye size={14} />
                                        Preview PDF
                                      </button>
                                    </>
                                  )}
                                  {/* Status Actions for Invoice */}
                                  <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
                                  {invoice.status !== 'sent' && invoice.status !== 'paid' && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setStatusDateTarget({ type: 'sent', document: invoice });
                                        // Set default date to now
                                        const now = new Date();
                                        setStatusDay(now.getDate());
                                        setStatusMonth(now.getMonth());
                                        setStatusYear(now.getFullYear());
                                        const hours1 = String(now.getHours()).padStart(2, '0');
                                        const minutes1 = String(now.getMinutes()).padStart(2, '0');
                                        setStatusTimeValue(`${hours1}:${minutes1}`);
                                        setShowStatusDateDialog(true);
                                        setOpenDropdown(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                    >
                                      <Send size={14} />
                                      Mark as Sent
                                    </button>
                                  )}
                                  {invoice.status !== 'paid' && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setStatusDateTarget({ type: 'paid', document: invoice });
                                        // Set default date to now
                                        const now = new Date();
                                        setStatusDay(now.getDate());
                                        setStatusMonth(now.getMonth());
                                        setStatusYear(now.getFullYear());
                                        const hours2 = String(now.getHours()).padStart(2, '0');
                                        const minutes2 = String(now.getMinutes()).padStart(2, '0');
                                        setStatusTimeValue(`${hours2}:${minutes2}`);
                                        setShowStatusDateDialog(true);
                                        setOpenDropdown(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                    >
                                      <CheckCircle size={14} />
                                      Mark as Paid
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Generate Invoice Button - Only show if no invoice exists */}
                          {!invoice && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openInvoiceDialog(record);
                              }}
                              className="flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                            >
                              <FileSpreadsheet size={14} className="text-indigo-500" />
                              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Invoice</span>
                              <span className="text-xs text-slate-400 dark:text-slate-500 italic">Not generated</span>
                            </button>
                          )}

                          {/* Excel Timesheet Badge & Dropdown */}
                          {timesheet && (
                            <div className="relative">
                              <button
                                ref={(el) => {
                                  if (el) timesheetButtonRefs.current.set(record.id, el);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = timesheetButtonRefs.current.get(record.id)?.getBoundingClientRect();
                                  if (rect) {
                                    setDropdownPosition({ top: rect.bottom + 4, left: rect.left });
                                  }
                                  setOpenDropdown(
                                    openDropdown?.type === 'timesheet' && openDropdown?.recordId === record.id
                                      ? null
                                      : { type: 'timesheet', recordId: record.id }
                                  );
                                }}
                                className="flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                title={`Timesheet - ${hasTimesheetPdf && hasTimesheetExcel ? 'PDF + Excel' : hasTimesheetExcel ? 'Excel only' : 'Generated'}`}
                              >
                                <FileSpreadsheet size={14} className="text-blue-500" />
                                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Timesheet</span>
                                {/* Format badges - show both if both exist */}
                                <div className="flex items-center gap-1">
                                  {hasTimesheetExcel && (
                                    <span className="text-[10px] px-1 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">
                                      Excel
                                    </span>
                                  )}
                                  {hasTimesheetPdf && (
                                    <span className="text-[10px] px-1 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded">
                                      PDF
                                    </span>
                                  )}
                                </div>
                                <StatusBadge status={getEffectiveStatus(timesheet)} size="sm" timestamp={timesheet.sentAt || timesheet.finalizedAt || timesheet.generatedAt} />
                              </button>

                              {/* Excel Timesheet Dropdown Menu */}
                              {isTimesheetDropdownOpen && dropdownPosition && (
                                <div
                                  className="fixed w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-[9999] py-1"
                                  style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openTimesheetDialog(record);
                                      setOpenDropdown(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                  >
                                    <RefreshCw size={14} />
                                    Regenerate Excel
                                  </button>
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      let excelUrl = getExcelDownloadUrl(timesheet);
                                      // If no Excel URL found, try to regenerate from storage path
                                      if (!excelUrl && timesheet.storagePath) {
                                        excelUrl = await regenerateExcelUrl(timesheet);
                                      }
                                      if (excelUrl) {
                                        try {
                                          const response = await fetch(excelUrl);
                                          const blob = await response.blob();
                                          const url = window.URL.createObjectURL(blob);
                                          const link = document.createElement('a');
                                          link.href = url;
                                          link.download = timesheet.fileName || 'timesheet.xlsx';
                                          document.body.appendChild(link);
                                          link.click();
                                          document.body.removeChild(link);
                                          window.URL.revokeObjectURL(url);
                                        } catch (err) {
                                          console.error('Download failed:', err);
                                          window.open(excelUrl, '_blank');
                                        }
                                      } else {
                                        alert('Excel file not found. The file may have been deleted or the URL is no longer valid. Please regenerate the timesheet.');
                                      }
                                      setOpenDropdown(null);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                  >
                                    <Download size={14} />
                                      Download Excel
                                    </button>
                                    {/* Status Actions for Timesheet */}
                                    <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
                                    {timesheet.status !== 'sent' && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setStatusDateTarget({ type: 'sent', document: timesheet });
                                          // Set default date to now
                                          const now = new Date();
                                          setStatusDay(now.getDate());
                                          setStatusMonth(now.getMonth());
                                          setStatusYear(now.getFullYear());
                                          const hours3 = String(now.getHours()).padStart(2, '0');
                                          const minutes3 = String(now.getMinutes()).padStart(2, '0');
                                          setStatusTimeValue(`${hours3}:${minutes3}`);
                                          setShowStatusDateDialog(true);
                                          setOpenDropdown(null);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                                      >
                                        <Send size={14} />
                                        Mark as Sent
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
  
                            {/* Generate Timesheet Button - Only show if no timesheet exists */}
                          {!timesheet && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openTimesheetDialog(record);
                              }}
                              className="flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                            >
                              <Calendar size={14} className="text-blue-500" />
                              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Timesheet</span>
                              <span className="text-xs text-slate-400 dark:text-slate-500 italic">Not generated</span>
                            </button>
                          )}

                          {/* Smart Upload Button - Available when invoice or timesheet exists */}
                          {(invoice || timesheet) && (
                            <label
                              className="flex items-center gap-2 px-2 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors cursor-pointer ml-2"
                              title="Upload file (auto-detects invoice/timesheet from filename)"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Upload size={14} className="text-emerald-600 dark:text-emerald-400" />
                              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Upload</span>
                              <input
                                type="file"
                                accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                                className="hidden"
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleSmartUpload(e, record, client || { id: '', name: 'Unknown' } as Client);
                                }}
                              />
                            </label>
                          )}

                          {/* Edit/Delete Buttons */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(record.clientId, record.month);
                              }}
                              className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                              title="Edit work record"
                            >
                              <Edit3 size={18} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(record);
                              }}
                              disabled={isDeleting}
                              className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                              title="Delete work record"
                            >
                              {isDeleting ? (
                                <Loader2 size={18} className="animate-spin" />
                              ) : (
                                <Trash2 size={18} />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invoice Generation Dialog */}
      {showInvoiceDialog && dialogRecord && dialogClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-white">
                Generate Invoice
              </h3>
              <button
                onClick={() => setShowInvoiceDialog(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Invoice Number
              </label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setInvoiceNumber(newValue);
                  setGeneratedFileName(generateFileName(newValue, dialogClient.name, dialogRecord.month));
                }}
                className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="e.g., 2026-01-01"
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Generated Filename
              </label>
              <div className="px-3 py-2 bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-600 dark:text-slate-400 font-mono break-all">
                {generatedFileName}
              </div>
            </div>

            {/* Template Source Info */}
            <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 mb-2">
                <FileSpreadsheet size={16} />
                <span className="font-medium">Template Source:</span>
                <span className={invoiceTemplate ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}>
                  {invoiceTemplate ? (invoiceTemplate.id === 'legacy' ? 'Legacy template' : invoiceTemplate.name) : 'No template'}
                </span>
              </div>
              {loadingInvoiceTemplate && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 size={14} className="animate-spin" />
                  Loading template...
                </div>
              )}
              {!invoiceTemplate && !loadingInvoiceTemplate && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No invoice template configured. A blank spreadsheet will be generated.
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowInvoiceDialog(false);
                  setExistingInvoiceId(null);
                }}
                className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateInvoice}
                disabled={isGenerating || !invoiceNumber.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet size={16} />
                    Generate & Download
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timesheet Generation Dialog */}
      {showTimesheetDialog && timesheetRecord && timesheetClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                  <Calendar size={20} className="text-blue-600" />
                  Generate Timesheet
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 font-medium ml-7">
                  {timesheetClient.name} • {formatMonthYear(timesheetRecord.month)}
                </p>
              </div>
              <button
                onClick={() => setShowTimesheetDialog(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X size={20} />
              </button>
            </div>

            {/* Template Source Info */}
            <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
              <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 mb-2">
                <FileSpreadsheet size={16} />
                <span className="font-medium">Template Source:</span>
                <span className={timesheetMonthTemplate ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}>
                  {timesheetMonthTemplate ? 'Month-specific template' : 'Client default template'}
                </span>
              </div>
              {(timesheetClient.timesheetTemplateName || timesheetClient.timesheetTemplateFileName) && !timesheetMonthTemplate && (
                <p className="text-xs text-slate-500 dark:text-slate-500 ml-6">
                  Using: {timesheetClient.timesheetTemplateName || timesheetClient.timesheetTemplateFileName}
                </p>
              )}
            </div>

            {/* Month-specific Template Upload */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Month-specific Template (Optional)
              </label>
              {timesheetMonthTemplate ? (
                <div className="flex items-center gap-4">
                  <div className="flex-1 px-3 py-2 bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-600 dark:text-slate-400 flex items-center gap-2">
                    <FileSpreadsheet size={16} />
                    {timesheetMonthTemplateName}
                  </div>
                  <button
                    onClick={handleClearMonthTemplate}
                    className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                    title="Clear month template"
                  >
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <label className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg border border-slate-300 dark:border-slate-600 transition w-fit">
                  <Upload size={18} />
                  <span>Upload template for {formatMonthYear(timesheetRecord.month)}</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleMonthTemplateUpload}
                    className="hidden"
                  />
                </label>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                Upload a different template for this specific month, or leave empty to use the client's default template
              </p>
            </div>

            {/* Filename Customization */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                <FileSpreadsheet size={16} className="text-indigo-600" />
                Filename
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={timesheetFileName}
                  onChange={(e) => setTimesheetFileName(e.target.value)}
                  className="flex-1 px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="Enter filename"
                />
                <span className="text-slate-500 dark:text-slate-400 font-mono text-sm">.xlsx</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                Customize the download filename.
              </p>
            </div>

            {/* Error Display */}
            {timesheetError && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                {timesheetError}
              </div>
            )}

            {/* Working Days Summary */}
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
              <h4 className="text-sm font-medium text-blue-900 dark:text-blue-300 mb-2">
                Working Days Summary
              </h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-slate-600 dark:text-slate-400">Total Working Days:</span>
                  <span className="ml-2 font-semibold text-slate-900 dark:text-white">
                    {timesheetRecord.workingDays.length}
                  </span>
                </div>
                <div>
                  <span className="text-slate-600 dark:text-slate-400">Month:</span>
                  <span className="ml-2 font-semibold text-slate-900 dark:text-white">
                    {formatMonthYear(timesheetRecord.month)}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowTimesheetDialog(false)}
                className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateTimesheet}
                disabled={isGeneratingTimesheet || (!timesheetMonthTemplate && !timesheetClient.timesheetTemplateBase64)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isGeneratingTimesheet ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Download size={16} />
                    Generate & Download
                  </>
                )}
              </button>
            </div>

            {!timesheetClient.timesheetTemplateBase64 && (
              <p className="text-center text-sm text-amber-600 dark:text-amber-400 mt-4">
                No timesheet template configured. Please upload a template in the client settings.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Status Date Picker Dialog */}
      {showStatusDateDialog && statusDateTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-white">
                Mark as {statusDateTarget.type === 'sent' ? 'Sent' : 'Paid'}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Select the date and time when this document was {statusDateTarget.type === 'sent' ? 'sent' : 'paid'}.
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Date
                </label>
                <div className="flex gap-2">
                  {/* Day dropdown */}
                  <select
                    value={statusDay}
                    onChange={(e) => setStatusDay(parseInt(e.target.value))}
                    className="w-20 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    {Array.from({ length: getStatusDaysInMonth(statusMonth, statusYear) }, (_, i) => i + 1).map((day) => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                  {/* Month dropdown with names */}
                  <select
                    value={statusMonth}
                    onChange={(e) => {
                      const newMonth = parseInt(e.target.value);
                      setStatusMonth(newMonth);
                      // Adjust day if new month has fewer days
                      const daysInNewMonth = getStatusDaysInMonth(newMonth, statusYear);
                      if (statusDay > daysInNewMonth) {
                        setStatusDay(daysInNewMonth);
                      }
                    }}
                    className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    {statusMonths.map((monthName, index) => (
                      <option key={index} value={index}>{monthName}</option>
                    ))}
                  </select>
                  {/* Year dropdown */}
                  <select
                    value={statusYear}
                    onChange={(e) => {
                      const newYear = parseInt(e.target.value);
                      setStatusYear(newYear);
                      // Adjust day for February in leap years
                      const daysInMonth = getStatusDaysInMonth(statusMonth, newYear);
                      if (statusDay > daysInMonth) {
                        setStatusDay(daysInMonth);
                      }
                    }}
                    className="w-24 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Time
                </label>
                <input
                  type="time"
                  value={statusTimeValue}
                  onChange={(e) => setStatusTimeValue(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>
            <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowStatusDateDialog(false);
                  setStatusDateTarget(null);
                }}
                className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    const { markDocumentSent, markInvoicePaid } = await import('../services/db');
                    const [hours, minutes] = statusTimeValue.split(':').map(Number);
                    const localDate = new Date(statusYear, statusMonth, statusDay, hours, minutes);
                    const isoDate = localDate.toISOString();
                    
                    if (statusDateTarget.type === 'sent') {
                      await markDocumentSent(userEmail!, statusDateTarget.document.id, `Marked as sent from WorkRecordList`, isoDate);
                    } else {
                      await markInvoicePaid(userEmail!, statusDateTarget.document.id, `Marked as paid from WorkRecordList`, isoDate);
                    }
                    
                    // Refresh documents to show updated status
                    const { getDocuments } = await import('../services/db');
                    const updatedDocs = await getDocuments(userEmail!);
                    setInvoices(updatedDocs);
                    
                    setShowStatusDateDialog(false);
                    setStatusDateTarget(null);
                  } catch (err) {
                    console.error(`Error marking as ${statusDateTarget.type}:`, err);
                    alert(`Failed to mark as ${statusDateTarget.type}. Please try again.`);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                <CheckCircle size={16} />
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Progress Modal */}
      <UploadProgressModal
        isOpen={uploadProgressModal.isOpen}
        progress={uploadProgressModal.progress}
        fileName={uploadProgressModal.fileName}
        state={uploadProgressModal.state}
        statusMessage={uploadProgressModal.statusMessage}
        errorMessage={uploadProgressModal.errorMessage}
        successDetails={uploadProgressModal.successDetails}
        confirmDetails={uploadProgressModal.confirmDetails}
        availableDocuments={uploadProgressModal.confirmDetails?.availableDocuments || []}
        onConfirm={handleUploadConfirm}
        onCancel={handleUploadCancel}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        title="Confirm Deletion"
        message="This work record has associated documents that will also be deleted:"
        documents={deleteDocuments}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  );
};
