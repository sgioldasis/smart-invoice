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

import React, { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { format, parseISO, endOfMonth, getDaysInMonth, isValid } from 'date-fns';
import * as ExcelJS from 'exceljs';
import type { Client, WorkRecord, Document, DocumentInput, WorkRecordTimesheet, WorkRecordTimesheetInput } from '../types';
import { getClients, getWorkRecords, deleteWorkRecord, getDocuments, saveDocument, getTimesheetByWorkRecord, saveTimesheet } from '../services/db';
import { processTimesheetPromptSmart } from '../services/ai';

interface WorkRecordListProps {
  userId: string;
  onEditWorkRecord?: (clientId: string, month: string) => void;
  onCreateWorkRecord?: () => void;
}

export const WorkRecordList: React.FC<WorkRecordListProps> = ({
  userId,
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
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Invoice dialog state
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [dialogRecord, setDialogRecord] = useState<WorkRecord | null>(null);
  const [dialogClient, setDialogClient] = useState<Client | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [generatedFileName, setGeneratedFileName] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

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

    return filtered;
  }, [workRecords, selectedClientId, searchQuery, clients]);

  const groupedByMonth = useMemo(() => {
    const groups: Record<string, WorkRecord[]> = {};
    filteredRecords.forEach((wr) => {
      if (!groups[wr.month]) {
        groups[wr.month] = [];
      }
      groups[wr.month].push(wr);
    });
    return groups;
  }, [filteredRecords]);

  const sortedMonths = useMemo(
    () => Object.keys(groupedByMonth).sort().reverse(),
    [groupedByMonth]
  );

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

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [clientsData, recordsData, invoicesData] = await Promise.all([
          getClients(userId),
          getWorkRecords(userId),
          getDocuments(userId),
        ]);
        setClients(clientsData);
        setWorkRecords(recordsData);
        setInvoices(invoicesData);
      } catch (error) {
        console.error('Error loading work records:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [userId]);

  // ============================================
  // Handlers
  // ============================================

  const handleDelete = async (record: WorkRecord) => {
    if (!confirm('Are you sure you want to delete this work record?')) {
      return;
    }

    setIsDeleting(record.id);
    try {
      await deleteWorkRecord(record.id);
      setWorkRecords((prev) => prev.filter((wr) => wr.id !== record.id));
    } catch (error) {
      console.error('Error deleting work record:', error);
      alert('Failed to delete work record');
    } finally {
      setIsDeleting(null);
    }
  };

  const handleEdit = (clientId: string, month: string) => {
    onEditWorkRecord?.(clientId, month);
  };

  const getNextInvoiceNumber = (): string => {
    const currentYear = new Date().getFullYear();
    const yearPrefix = `${currentYear}-`;

    const existingNumbers = invoices
      .filter((inv) => inv.documentNumber?.startsWith(yearPrefix))
      .map((d) => {
        const num = parseInt(d.documentNumber?.split('-')[2] || '0');
        return num;
      });

    const maxNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
    const nextNum = (maxNum + 1).toString().padStart(2, '0');
    return `${currentYear}-01-${nextNum}`;
  };

  const generateFileName = (invNum: string, clientName: string, month: string): string => {
    const safeClientName = clientName.replace(/[^a-zA-Z0-9]/g, '_');
    return `${invNum}_${safeClientName}_${month.replace('-', '_')}.xlsx`;
  };

  const openInvoiceDialog = (record: WorkRecord) => {
    const client = clients.find((c) => c.id === record.clientId);
    if (!client) return;

    const nextNum = getNextInvoiceNumber();
    const fileName = generateFileName(nextNum, client.name, record.month);

    setDialogRecord(record);
    setDialogClient(client);
    setInvoiceNumber(nextNum);
    setGeneratedFileName(fileName);
    setShowInvoiceDialog(true);
  };

  const handleGenerateInvoice = async () => {
    if (!dialogRecord || !dialogClient || !invoiceNumber.trim()) return;

    setIsGenerating(true);
    try {
      const workbook = new ExcelJS.Workbook();

      if (dialogClient.template) {
        const binaryString = atob(dialogClient.template);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        await workbook.xlsx.load(bytes.buffer as ArrayBuffer);
      } else {
        workbook.addWorksheet('Invoice');
      }

      const worksheet = workbook.worksheets[0];

      const dateColumn = dialogClient.mapping?.dateColumn || 'A';
      const hoursColumn = dialogClient.mapping?.hoursColumn || 'B';

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (typeof cell.value === 'string') {
            cell.value = cell.value
              .replace(/\{\{CLIENT_NAME\}\}/g, dialogClient.name)
              .replace(/\{\{CLIENT_ADDRESS\}\}/g, dialogClient.address || '')
              .replace(/\{\{CLIENT_VAT\}\}/g, dialogClient.vatNumber || '')
              .replace(/\{\{INVOICE_NUMBER\}\}/g, invoiceNumber)
              .replace(/\{\{INVOICE_DATE\}\}/g, format(new Date(), 'dd/MM/yyyy'))
              .replace(/\{\{MONTH\}\}/g, dialogRecord.month)
              .replace(
                /\{\{TOTAL_HOURS\}\}/g,
                (dialogRecord.workingDays.length * 8).toString()
              );
          }
        });
      });

      const setCell = (cellAddr: string, value: any) => {
        const cell = worksheet.getCell(cellAddr);
        cell.value = value;
      };

      const workingDays = dialogRecord.workingDays
        .map((d) => parseISO(d))
        .sort((a, b) => a.getTime() - b.getTime());

      for (let i = 0; i < workingDays.length; i++) {
        const day = workingDays[i];
        const rowNum = i + 1;
        setCell(`${dateColumn}${rowNum}`, format(day, 'dd/MM/yyyy'));
        setCell(`${hoursColumn}${rowNum}`, 8);
      }

      const buffer = await workbook.xlsx.writeBuffer();
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
        workRecordId: dialogRecord.id,
        type: 'invoice',
        documentNumber: invoiceNumber,
        month: dialogRecord.month,
        workingDays: dialogRecord.workingDays.length,
        workingDaysArray: dialogRecord.workingDays,
        dailyRate: dialogClient.dailyRate || 0,
        totalAmount: (dialogRecord.workingDays.length * 8) * (dialogClient.hourlyRate || dialogClient.dailyRate || 0),
        fileName: generatedFileName,
      };

      await saveDocument(userId, invoiceData);

      const updatedInvoices = await getDocuments(userId);
      setInvoices(updatedInvoices);

      setShowInvoiceDialog(false);
      setDialogRecord(null);
      setDialogClient(null);
      setInvoiceNumber('');
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

    // Check for existing timesheet config for this month
    try {
      const existingTimesheet = await getTimesheetByWorkRecord(record.id);
      if (existingTimesheet) {
        setTimesheetPrompt(existingTimesheet.prompt || client.timesheetPrompt || '');
        setTimesheetMonthTemplate(existingTimesheet.templateBase64 || null);
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

      // Determine which template to use
      const templateToUse = timesheetMonthTemplate || timesheetClient.timesheetTemplateBase64;
      const templateFileName = timesheetMonthTemplate
        ? timesheetMonthTemplateName
        : timesheetClient.timesheetTemplateFileName;

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
          console.log(`HEURISTIC: Candidate worksheet "${ws.name}" has score ${dateScore}`);
        }
      }
      console.log(`HEURISTIC: Final target worksheet "${worksheet.name}" (Score: ${maxScore})`);

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

      // Fill working days only if mapping is configured
      // This fills existing cells without creating new rows
      if (timesheetClient.timesheetMapping) {
        const { dateColumn, hoursColumn, descriptionColumn, startRow } = timesheetClient.timesheetMapping;
        // HEURISTIC: If startRow is 3 or missing, and we're seeing an offset issue, Row 2 is likely the real start.
        const firstDataRow = (startRow === 3 || !startRow) ? 2 : startRow;

        for (let i = 0; i < workingDaysList.length; i++) {
          const day = workingDaysList[i];
          const rowNum = firstDataRow + i;

          // Only fill if the row already exists in the template
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

      // Parse prompt using Gemini AI (with fallback to local parsing)
      console.log('Timesheet prompt value:', timesheetPrompt);
      console.log('Processing prompt with Gemini AI...');

      let aiResult = null;
      try {
        aiResult = await processTimesheetPromptSmart({
          prompt: timesheetPrompt || '',
          workingDays: timesheetRecord.workingDays,
          clientName: timesheetClient.name,
          month: timesheetRecord.month,
        });
        console.log('AI Config received:', JSON.stringify(aiResult, null, 2));
      } catch (aiError) {
        console.error('AI processing failed, will use fallback:', aiError);
      }

      // Fallback: Extract cell references and instructions from the prompt locally
      const promptLower = (timesheetPrompt || '').toLowerCase();

      // NEW: Check for explicit "Do NOT change any styles" instruction
      const disableStyling = promptLower.includes('do not change') && (promptLower.includes('styles') || promptLower.includes('formatting'));

      // Look for cell references like "cell C11", ranges like "C13 to AG13", etc.
      const periodCellMatch = promptLower.match(/(?:period|date).*?cell\s+([a-z]+\d+)/i);

      // Match cell ranges like "cells c13 to ag13" or "c13 up to ag13" or "c14 to ag14"
      const dayNumbersRangeMatch = promptLower.match(/(?:day numbers|cells)\s+([a-z]+\d+).*?(?:to|up to)\s+([a-z]+\d+)/i);
      // Enhanced data row match to catch "data row... cells c14 up to ag14"
      const dataRangeMatch = promptLower.match(/(?:data row|work hours).*?\(?cells?\s+([a-z]+\d+).*?(?:to|up to)\s+([a-z]+\d+)\)?/i);
      const hoursValueMatch = promptLower.match(/(?:place|put|fill).*?(\d+(?:\.\d+)?).*?(?:hours?|work)/i);

      // Parse style row range if specified (e.g., "rows 14-20")
      const styleRowRangeMatch = promptLower.match(/rows?\s+(\d+)(?:\s*-\s*|\s+to\s+)(\d+)/i);

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

      // Style rows range (e.g., 14-20)
      const styleStartRow = aiAnalysis?.styleRows?.start || (styleRowRangeMatch ? parseInt(styleRowRangeMatch[1]) : null);
      const styleEndRow = aiAnalysis?.styleRows?.end || (styleRowRangeMatch ? parseInt(styleRowRangeMatch[2]) : null);

      console.log('=== PROMPT PARSING RESULTS ===');
      console.log('AI used:', aiResult !== null);
      console.log('AI full analysis:', aiAnalysis);
      console.log('periodCell:', periodCellValue || 'NOT FOUND');
      console.log('dayNumbersRange:', dayNumbersStart && dayNumbersEnd ? `${dayNumbersStart} to ${dayNumbersEnd}` : 'NOT FOUND');
      console.log('dataRange:', dataRangeStart && dataRangeEnd ? `${dataRangeStart} to ${dataRangeEnd}` : 'NOT FOUND');
      console.log('hoursPerDay:', aiResult?.mapping?.hoursPerDay || (hoursValueMatch ? hoursValueMatch[1] : 'NOT FOUND'));
      console.log('styleRows:', styleStartRow && styleEndRow ? `${styleStartRow}-${styleEndRow}` : 'NOT FOUND');

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
        console.log(`Updated period cell ${periodCellValue.toUpperCase()} to: ${periodText}`);
      }

      // NEW: Vertical Fill Support (e.g. "In column B, fill a 1 for working days... If it's a day off put a 0 in column B and 'Other' in column C")
      const verticalFillMatch = promptLower.match(/in\s+col(?:umn)?\s+([a-z]+),?\s+fill\s+(?:a\s+)?(?!the\b|all\b)([^, ]+).*?date\s+in.*?col(?:umn)?\s+([a-z]+)/i);

      // AUTO-TRIGGER: Always attempt to sync dates in Col A and rename sheet if not explicitly disabled
      // This ensures Column A is ALWAYS correct for the target month.
      const syncDisabled = promptLower.includes('do not sync') || promptLower.includes('keep dates');
      const baseDateFillMatch = promptLower.match(/in\s+col(?:umn)?\s+([a-z]+)\s+fill\s+(?:the\s+)?dates/i);
      const dateFillMatch = !syncDisabled ? (baseDateFillMatch || [null, verticalFillMatch?.[3] || 'A']) : null;

      const renameSheetMatch = !syncDisabled ? (promptLower.match(/rename\s+(?:the\s+)?(?:excel\s+)?worksheet|replace\s+(?:the\s+)?(?:excel\s+)?worksheet'?s\s+name/i) || [true]) : null;

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
          console.log(`DAY OFF LOGIC: col ${dayOffCol}=${dayOffValue}${dayOffLabel ? `, col ${dayOffLabelCol}="${dayOffLabel}"` : ''}`);
        }

        const workingDaySet = new Set(timesheetRecord.workingDays);
        const excludedDatesSet = new Set(timesheetRecord.config.excludedDates);
        const recordMonth = timesheetRecord.month; // "YYYY-MM"
        const [yearNum, monthNum] = recordMonth.split('-').map(Number);
        const daysInMonth = getDaysInMonth(parseISO(recordMonth + '-01'));

        // PASS 1: DATE SYNC (if requested)
        if (dateFillMatch) {
          console.log(`DATE SYNC DETECTED: Overwriting col ${refCol} with dates for ${recordMonth}`);

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
          console.log(`DEEP SYNC: Forced startRow to 2 for definitive alignment.`);

          if (startRow !== -1) {
            // Fill 31 slots (max days in a month)
            for (let i = 0; i < 31; i++) {
              const currentRow = startRow + i;
              const cell = worksheet.getRow(currentRow).getCell(refCol);
              if (i < daysInMonth) {
                // Create a UTC date at midnight to avoid local timezone shifts
                const dUTC = new Date(Date.UTC(yearNum, monthNum - 1, i + 1));
                // Convert to Excel serial date (25569 is Jan 1, 1970)
                // Using an integer ensures NO time portion in Excel
                const serialDate = (dUTC.getTime() / (24 * 60 * 60 * 1000)) + 25569;
                cell.value = serialDate;
                cell.numFmt = 'dddd, mmmm d, yyyy'; // descriptive: "Wednesday, April 1, 2026"
              } else {
                // Clear leftover days (e.g. days 31 in a 30-day month)
                // BUT ONLY if they look like dates! This preserves "Total" or "Signature" lines.
                if (getDayVal(cell) !== -1) {
                  cell.value = null;
                  if (targetCol) worksheet.getRow(currentRow).getCell(targetCol).value = null;
                  if (dayOffCol) worksheet.getRow(currentRow).getCell(dayOffCol).value = null;
                  if (dayOffLabelCol) worksheet.getRow(currentRow).getCell(dayOffLabelCol).value = null;
                }
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
        console.log(`Updated day numbers in row ${startRow}, columns ${startCol} to ${endCol}`);
      }

      // Fill hours in data row range for working days only (e.g., C14 to AG14)
      const hoursPerDay = aiResult?.mapping?.hoursPerDay || (hoursValueMatch ? parseFloat(hoursValueMatch[1]) : 8);

      // Extract style cell references from AI analysis or prompt
      // AI returns styling info directly - we don't need to parse from text anymore
      console.log('DEBUG: AI styling analysis:', aiAnalysis?.styling);
      console.log('DEBUG: styleRows from AI:', aiAnalysis?.styleRows);

      // Use AI-extracted style information if available, otherwise fall back to pattern detection
      let workingDayCell: string | null = null;
      let weekendCell: string | null = null;

      // If AI has analysis with style information, use it
      if (aiAnalysis?.styling) {
        // AI identified working day and weekend colors/cells
        console.log('AI detected styling configuration');
      }

      // Fallback: Parse style cells from prompt text
      // Find all occurrences of "cell XX for" pattern
      const allCellRefs = [...promptLower.matchAll(/cell\s+([a-z]+\d+)\s+for/gi)];
      console.log('DEBUG: All cell references found:', allCellRefs.map(m => m[1]));

      for (const match of allCellRefs) {
        const cellRef = match[1].toUpperCase();
        const matchIndex = match.index || 0;
        // Look at what comes after this match (within next 50 chars) to determine type
        const followingText = promptLower.substring(matchIndex, matchIndex + 50);
        console.log(`Cell ${cellRef} followed by:`, followingText);

        if (followingText.includes('working')) {
          workingDayCell = cellRef;
        } else if (followingText.includes('weekend')) {
          weekendCell = cellRef;
        }
      }

      // Create match-like objects for compatibility with existing code
      const workingDayStyleMatch = workingDayCell ? [null, workingDayCell] : null;
      const weekendStyleMatch = weekendCell ? [null, weekendCell] : null;

      console.log('Style matches:', {
        workingDayCell: workingDayStyleMatch ? workingDayStyleMatch[1] : null,
        weekendCell: weekendStyleMatch ? weekendStyleMatch[1] : null,
      });

      if (dataRangeStart && dataRangeEnd) {
        const startCell = dataRangeStart.toUpperCase();
        const endCell = dataRangeEnd.toUpperCase();

        // Extract row and columns
        const dataRow = parseInt(startCell.match(/\d+/)![0]);
        let startCol = startCell.match(/[A-Z]+/)![0];
        let endCol = endCell.match(/[A-Z]+/)![0];

        const startColNumInitial = colLetterToNumber(startCol);

        console.log(`Processing hours in row ${dataRow}, columns ${startCol}(${startColNumInitial}) to ${endCol}(${colLetterToNumber(endCol)})`);
        console.log('>>> ENTERING STYLING CODE BLOCK - dataRangeMatch was found');

        // FIX: Ensure data/styling loop aligns with day numbers loop if available
        // This prevents "shifting" of gray cells if the AI/Regex detects slightly different start columns
        if (dayNumbersStart && typeof dayNumbersStart === 'string') {
          try {
            const dayStartCellUpper = dayNumbersStart.toUpperCase();
            const dayStartColMatch = dayStartCellUpper.match(/[A-Z]+/);

            if (dayStartColMatch) {
              const dayStartCol = dayStartColMatch[0];
              if (dayStartCol !== startCol) {
                console.log(`Aligning data loop start column from ${startCol} to ${dayStartCol} to match day numbers.`);

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

        // Capture styles from template cells if specified
        let workingDayStyle: any = null;
        let weekendStyle: any = null;

        // Helper to capture full cell style including fill
        const captureCellStyle = (cellAddr: string): any => {
          const cell = worksheet.getCell(cellAddr);
          const fill = cell.fill as any;
          console.log(`Raw cell ${cellAddr} properties:`, {
            fill: fill,
            type: fill?.type,
            pattern: fill?.pattern,
            fgColor: fill?.fgColor,
            bgColor: fill?.bgColor,
          });
          const style: any = {};

          // Capture fill (background color) - this is the most important for gray/white
          if (cell.fill) {
            // Deep copy the fill object
            style.fill = JSON.parse(JSON.stringify(cell.fill));
            console.log(`  Captured fill for ${cellAddr}:`, style.fill);
          }

          // Capture font
          if (cell.font) {
            style.font = JSON.parse(JSON.stringify(cell.font));
          }

          // Capture border
          if (cell.border) {
            style.border = JSON.parse(JSON.stringify(cell.border));
          }

          // Capture alignment
          if (cell.alignment) {
            style.alignment = JSON.parse(JSON.stringify(cell.alignment));
          }

          // Capture number format
          if (cell.numFmt) {
            style.numFmt = cell.numFmt;
          }

          return style;
        };

        console.log('DEBUG: workingDayCell value:', workingDayCell);
        console.log('DEBUG: workingDayStyleMatch:', workingDayStyleMatch);

        if (workingDayStyleMatch && workingDayStyleMatch[1]) {
          const workingDayCellRef = workingDayStyleMatch[1].toUpperCase();
          console.log('DEBUG: About to capture from:', workingDayCellRef);
          workingDayStyle = captureCellStyle(workingDayCellRef);
          console.log(`CAPTURED working day style from ${workingDayCellRef}:`,
            workingDayStyle && workingDayStyle.fill ? 'HAS FILL: ' + JSON.stringify(workingDayStyle.fill) : 'NO FILL');
        } else {
          console.log('DEBUG: workingDayStyleMatch is null or has no cell ref');
        }

        if (weekendStyleMatch && weekendStyleMatch[1]) {
          const weekendCellRef = weekendStyleMatch[1].toUpperCase();
          weekendStyle = captureCellStyle(weekendCellRef);
          console.log(`CAPTURED weekend style from ${weekendCellRef}:`,
            weekendStyle && weekendStyle.fill ? 'HAS FILL: ' + JSON.stringify(weekendStyle.fill) : 'NO FILL');
        }

        // Determine style row range (use AI-extracted or parsed values, default to data row)
        const finalStyleStartRow = styleStartRow || dataRow;
        const finalStyleEndRow = styleEndRow || dataRow;

        // Convert working days to a Set for quick lookup (using day of month as number)
        const workingDayNumbers = new Set(
          timesheetRecord.workingDays.map(dateStr => parseInt(dateStr.split('-')[2]))
        );

        // Build a map of which day numbers are weekends
        const weekendDayNumbers = new Set<number>();
        for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
          const date = new Date(year, month - 1, dayNum);
          const dayOfWeek = date.getDay();
          if (dayOfWeek === 0 || dayOfWeek === 6) {
            weekendDayNumbers.add(dayNum);
          }
        }

        console.log('Weekend day numbers:', Array.from(weekendDayNumbers));
        console.log('Working day numbers:', Array.from(workingDayNumbers));

        // STEP 1: Clear hours cells values only (not backgrounds)
        for (let colNum = startColNum; colNum <= endColNum; colNum++) {
          const cell = worksheet.getRow(dataRow).getCell(colNum);
          if (cell) {
            cell.value = null;
          }
        }

        // REMOVED: Apply WHITE to ALL cells. User requested to preserve template formatting.
        /*
        for (let colNum = startColNum; colNum <= endColNum; colNum++) {
          const colLetter = colNumberToLetter(colNum);
          for (let styleRow = finalStyleStartRow; styleRow <= finalStyleEndRow; styleRow++) {
             // ...
          }
        }
        */

        // Extract day numbers row index if available
        let dayNumbersRowIndex: number | null = null;
        if (dayNumbersStart && typeof dayNumbersStart === 'string') {
          const match = dayNumbersStart.match(/(\d+)/);
          if (match) {
            dayNumbersRowIndex = parseInt(match[1]);
          }
        }

        // STEP 3: Fill hours and apply gray ONLY to weekends
        const grayCols: string[] = [];
        // We iterate based on the range, but we ONLY act if we find a valid day number
        // We do typically 31 columns max
        for (let colNum = startColNum; colNum <= endColNum; colNum++) {
          const cell = worksheet.getRow(dataRow).getCell(colNum);
          if (!cell) continue;

          let isWeekend = false;
          let isValidDay = false;
          let currentDayNum = 0;

          // PREFERRED: Read the actual day number from the sheet if we know the row
          // This satisfies the user request to "check the number in line 13"
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

              // Check if THIS specific day number is a weekend
              isWeekend = weekendDayNumbers.has(currentDayNum);
            }
          }

          // AGGRESSIVE GRID CLEANING or JUST FILL DATA
          // If styling is disabled, we ONLY touch the value.

          if (isValidDay && workingDayNumbers.has(currentDayNum)) {
            cell.value = hoursPerDay;
          }

          // Apply styling ONLY if not disabled
          if (!disableStyling) {
            const colLetter = colNumberToLetter(colNum);

            for (let styleRow = finalStyleStartRow; styleRow <= finalStyleEndRow; styleRow++) {
              const styleCell = worksheet.getCell(`${colLetter}${styleRow}`);

              if (isValidDay && isWeekend) {
                // Verified Weekend -> Paint Gray
                grayCols.push(colLetter);
                styleCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFD3D3D3' }
                };
              } else {
                // Not a Weekend (Weekday OR Empty Column) -> Force Clear Fill
                // This is necessary because the template seems to be pre-filled with gray
                styleCell.fill = {
                  type: 'pattern',
                  pattern: 'none'
                };
              }
            }
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
          console.log(`Renamed worksheet from "${oldName}" to: "${newName}"`);
        } catch (e) {
          console.error('Error renaming worksheet:', e);
        }
      }

      const buffer = await workbook.xlsx.writeBuffer();
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

      // Save timesheet configuration
      const timesheetData: WorkRecordTimesheetInput = {
        clientId: timesheetClient.id!,
        workRecordId: timesheetRecord.id,
        month: timesheetRecord.month,
        prompt: timesheetPrompt || null,
        templateBase64: timesheetMonthTemplate || null,
        templateName: timesheetMonthTemplateName || null,
      };

      await saveTimesheet(userId, timesheetData, existingTimesheetId || undefined);

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
    return invoices.find(
      (inv) => inv.workRecordId === recordId && inv.type === 'invoice'
    );
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
            {invoices.filter((inv) => inv.type === 'invoice').length}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-sm mb-1">
            <Calendar size={16} />
            Timesheets
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">
            {invoices.filter((inv) => inv.type === 'timesheet').length}
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
              className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
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
                  const hasOutdatedInvoice = invoice?.isOutdated;

                  return (
                    <div
                      key={record.id}
                      className="px-4 sm:px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors group"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        {/* Left: Client Info */}
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                            <Building2 size={20} className="text-indigo-600" />
                          </div>
                          <div>
                            <h4 className="font-medium text-slate-900 dark:text-white">
                              {client?.name || 'Unknown Client'}
                            </h4>
                            <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                              <span className="flex items-center gap-1">
                                <Clock size={14} />
                                {record.workingDays.length} days
                              </span>
                              {invoice && (
                                <span
                                  className={`flex items-center gap-1 ${hasOutdatedInvoice
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-green-600 dark:text-green-400'
                                    }`}
                                >
                                  <FileSpreadsheet size={14} />
                                  {invoice.documentNumber}
                                  {hasOutdatedInvoice && (
                                    <AlertTriangle size={12} />
                                  )}
                                </span>
                              )}
                              {timesheet && (
                                <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                                  <Calendar size={14} />
                                  {timesheet.documentNumber}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Right: Actions */}
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openInvoiceDialog(record)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${hasOutdatedInvoice
                              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400'
                              : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400'
                              }`}
                            title={hasOutdatedInvoice ? 'Regenerate Invoice' : 'Generate Invoice'}
                          >
                            <FileSpreadsheet size={16} />
                            {invoice ? 'Regenerate' : 'Invoice'}
                          </button>
                          <button
                            onClick={() => openTimesheetDialog(record)}
                            disabled={isGeneratingTimesheet}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Generate Timesheet"
                          >
                            {isGeneratingTimesheet && timesheetRecord?.id === record.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Calendar size={16} />
                            )}
                            Timesheet
                          </button>
                          <button
                            onClick={() => handleEdit(record.clientId, record.month)}
                            className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                            title="Edit work record"
                          >
                            <Edit3 size={18} />
                          </button>
                          <button
                            onClick={() => handleDelete(record)}
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
                          <ChevronRight
                            size={18}
                            className="text-slate-300 dark:text-slate-600"
                          />
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

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowInvoiceDialog(false)}
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
    </div>
  );
};
