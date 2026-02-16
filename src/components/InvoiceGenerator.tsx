/**
 * InvoiceGenerator.tsx
 *
 * Generates invoices from work records using client Excel templates.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { format, getDaysInMonth, startOfMonth, addDays, isWeekend, parseISO, endOfMonth } from 'date-fns';
import * as ExcelJS from 'exceljs';
import { FileSpreadsheet, Loader2, Calendar, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle } from 'lucide-react';
import { Client, WorkRecord, Document } from '../types';
import { getWorkRecordByMonth, saveDocument, getDocuments, getClients } from '../services/db';
import { fetchGreekHolidays, WorkDayStatus } from '../utils/workRecordCalculator';

interface InvoiceGeneratorProps {
  userId: string;
  initialClientId?: string;
  initialMonth?: string;
  existingInvoiceNumber?: string;
}

export const InvoiceGenerator: React.FC<InvoiceGeneratorProps> = ({
  userId,
  initialClientId,
  initialMonth,
  existingInvoiceNumber,
}) => {
  // ============================================
  // State
  // ============================================
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>(initialClientId || '');
  const [currentDate, setCurrentDate] = useState(() => {
    if (initialMonth) {
      return parseISO(`${initialMonth}-01`);
    }
    return new Date();
  });
  const [workRecord, setWorkRecord] = useState<WorkRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(existingInvoiceNumber || '');
  const [existingDocuments, setExistingDocuments] = useState<Document[]>([]);
  const [allInvoices, setAllInvoices] = useState<Document[]>([]);
  const [holidayNames, setHolidayNames] = useState<Record<string, string>>({});
  const [dayStatuses, setDayStatuses] = useState<WorkDayStatus[]>([]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId),
    [clients, selectedClientId]
  );

  const monthStr = format(currentDate, 'yyyy-MM');

  const daysInMonth = useMemo(() => {
    const days = getDaysInMonth(currentDate);
    return Array.from({ length: days }, (_, i) => addDays(startOfMonth(currentDate), i));
  }, [currentDate]);

  const stats = useMemo(() => {
    if (!workRecord) return { days: 0, amount: 0 };
    return {
      days: workRecord.workingDays.length,
      amount: workRecord.workingDays.length * (selectedClient?.dailyRate || 0),
    };
  }, [workRecord, selectedClient]);

  // ============================================
  // Effects
  // ============================================
  useEffect(() => {
    const loadClients = async () => {
      try {
        const data = await getClients(userId);
        setClients(data);
      } catch (err) {
        console.error('Error loading clients:', err);
      }
    };
    loadClients();
  }, [userId]);

  // Update selected client when initialClientId prop changes
  useEffect(() => {
    if (initialClientId) {
      setSelectedClientId(initialClientId);
    }
  }, [initialClientId]);

  // Update current date when initialMonth prop changes
  useEffect(() => {
    if (initialMonth) {
      setCurrentDate(parseISO(`${initialMonth}-01`));
    }
  }, [initialMonth]);

  // Update invoice number when existingInvoiceNumber prop changes
  useEffect(() => {
    if (existingInvoiceNumber) {
      setInvoiceNumber(existingInvoiceNumber);
    }
  }, [existingInvoiceNumber]);

  // Fetch holidays when year changes
  useEffect(() => {
    const year = currentDate.getFullYear();
    fetchGreekHolidays(year);
  }, [currentDate.getFullYear()]);

  // Calculate day statuses when work record changes
  useEffect(() => {
    if (!workRecord) {
      setDayStatuses([]);
      setHolidayNames({});
      return;
    }

    // Calculate day statuses based on work record data
    const statuses: WorkDayStatus[] = [];
    const holidays: Record<string, string> = workRecord.holidayNames || {};

    daysInMonth.forEach((day) => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const isWeekendDay = isWeekend(day);
      const holidayName = holidays[dateStr];
      const isHolidayDay = !!holidayName;
      const isWorking = workRecord.workingDays.includes(dateStr);

      // Determine if manually overridden
      const isManuallyExcluded = workRecord.config?.excludedDates?.includes(dateStr) || false;
      const isManuallyIncluded = workRecord.config?.includedDates?.includes(dateStr) || false;

      statuses.push({
        date: day,
        dateStr,
        isWeekend: isWeekendDay,
        isHoliday: isHolidayDay,
        holidayName,
        isWorking,
        isManuallyExcluded,
        isManuallyIncluded,
      });
    });

    setDayStatuses(statuses);
    setHolidayNames(holidays);
  }, [workRecord, daysInMonth]);

  useEffect(() => {
    const loadWorkRecord = async () => {
      if (!selectedClientId) return;
      setLoading(true);
      try {
        const record = await getWorkRecordByMonth(userId, selectedClientId, monthStr);
        setWorkRecord(record);
        if (!record) {
          setError(`No work record found for ${format(currentDate, 'MMMM yyyy')}. Please create one first.`);
        } else {
          setError(null);
        }
      } catch (err) {
        console.error('Error loading work record:', err);
        setError('Failed to load work record');
      } finally {
        setLoading(false);
      }
    };
    loadWorkRecord();
  }, [userId, selectedClientId, monthStr, currentDate]);

  // Load existing documents for this client
  useEffect(() => {
    const loadDocuments = async () => {
      if (!selectedClientId) return;
      try {
        const docs = await getDocuments(userId, { clientId: selectedClientId, type: 'invoice' });
        setExistingDocuments(docs.filter((d) => d.type === 'invoice'));
      } catch (err) {
        console.error('Error loading documents:', err);
      }
    };
    loadDocuments();
  }, [userId, selectedClientId]);

  // Load ALL invoices for global numbering
  useEffect(() => {
    const loadAllInvoices = async () => {
      try {
        const docs = await getDocuments(userId, { type: 'invoice' });
        setAllInvoices(docs.filter((d) => d.type === 'invoice'));
      } catch (err) {
        console.error('Error loading all invoices:', err);
      }
    };
    loadAllInvoices();
  }, [userId]);

  // ============================================
  // Handlers
  // ============================================
  const getNextInvoiceNumber = (): string => {
    // Extract numeric values from all invoice document numbers
    const existingNumbers = allInvoices
      .map((d) => {
        // Try to parse the document number as a number
        const num = parseInt(d.documentNumber, 10);
        return isNaN(num) ? 0 : num;
      })
      .filter(n => n > 0);
    
    const maxNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
    // Pad with at least 2 digits
    return String(maxNum + 1).padStart(2, '0');
  };

  const isWorkingDay = (date: Date): boolean => {
    if (!workRecord) return false;
    const dateStr = format(date, 'yyyy-MM-dd');
    return workRecord.workingDays.includes(dateStr);
  };

  const getDayStatus = (day: Date): WorkDayStatus | undefined => {
    return dayStatuses.find((s) => s.dateStr === format(day, 'yyyy-MM-dd'));
  };

  const handleGenerateInvoice = async () => {
    if (!selectedClient || !workRecord) {
      setError('Please select a client with a work record');
      return;
    }

    if (!selectedClient.templateBase64) {
      setError('No template uploaded for this client');
      return;
    }

    if (!invoiceNumber.trim()) {
      setError('Please enter an invoice number');
      return;
    }

    setGenerating(true);
    setError(null);
    setSaveSuccess(false);

    try {
      // 1. Generate Excel
      const workbook = new ExcelJS.Workbook();
      
      // Handle base64 data - remove data URL prefix if present
      let base64Data = selectedClient.templateBase64;
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }
      
      // Remove any whitespace that might have been added
      base64Data = base64Data.replace(/\s/g, '');
      
      // Validate base64 characters only
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)) {
        throw new Error('Invalid template data format');
      }
      
      // Browser-compatible base64 to ArrayBuffer conversion
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      await workbook.xlsx.load(bytes.buffer);
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

      // 2. Map data to cells based on client mapping
      const mapping = selectedClient.mapping;
      const setCell = (cellAddr: string, value: any) => {
        if (cellAddr && value !== undefined && value !== null) {
          const cell = worksheet.getCell(cellAddr);
          cell.value = value;
        }
      };

      // Set invoice metadata - date is always end of the month
      const endOfMonthDate = endOfMonth(currentDate);
      setCell(mapping.date, format(endOfMonthDate, 'dd/MM/yyyy'));
      setCell(mapping.invoiceNumber, invoiceNumber);
      setCell(mapping.daysWorked, stats.days);
      setCell(mapping.dailyRate, selectedClient.dailyRate);
      setCell(mapping.totalAmount, stats.amount);

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
              const monthName = format(currentDate, 'MMMM');
              const year = format(currentDate, 'yyyy');
              
              let newDesc = `Consulting Services for ${monthName} ${year}`;
              // If there is no specific 'daysWorked' column mapped, we usually want the days count in description
              if (!mapping.daysWorked) {
                 newDesc += ` (${stats.days} days)`;
              }
              descCell.value = newDesc;
            } else {
              // Case 2: Existing Description -> Preserve text, replace day count number if pattern exists
              // Look for "X days", "X units/working days", etc.
              const daysPattern = /(\d+)(\D{0,50}days?)/i;
              if (daysPattern.test(currentDescVal)) {
                 descCell.value = currentDescVal.replace(daysPattern, `${stats.days}$2`);
              }
              // If no pattern is found, we assume the user's template text is static or doesn't include days count.
            }
          }
        } catch(e) { console.warn("Invalid description cell address", e); }
      }

      // 3. Generate buffer and download
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Construct filename: <invoice-number>-<client_name_with_underscores>-Invoice-<MONTH>-<YEAR>
      const monthName = format(currentDate, 'MMMM').toUpperCase();
      const year = format(currentDate, 'yyyy');
      const safeClientName = (selectedClient.name || 'Client').replace(/\s+/g, '_');
      const fileName = `${invoiceNumber}-${safeClientName}-Invoice-${monthName}-${year}.xlsx`;
      
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      // 4. Save document to database
      const safeClientNameForDb = (selectedClient.name || 'Client').replace(/\s+/g, '_');
      const documentData = {
        clientId: selectedClient.id,
        workRecordId: workRecord.id,
        type: 'invoice' as const,
        documentNumber: invoiceNumber,
        month: monthStr,
        workingDays: stats.days,
        workingDaysArray: workRecord.workingDays, // Save the actual dates used
        dailyRate: selectedClient.dailyRate,
        totalAmount: stats.amount,
        fileName: `${invoiceNumber}-${safeClientNameForDb}-Invoice-${monthName}-${year}.xlsx`,
        isPaid: false,
        isOutdated: false, // Clear outdated flag on regenerate
      };

      // Check for existing document to overwrite
      const existingDoc = existingDocuments.find((d) => d.documentNumber === invoiceNumber);
      const docId = existingDoc?.id;

      await saveDocument(userId, documentData, docId);

      // Refresh existing documents
      const updatedDocs = await getDocuments(userId, { clientId: selectedClient.id, type: 'invoice' });
      setExistingDocuments(updatedDocs.filter((d) => d.type === 'invoice'));

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error generating invoice:', err);
      setError(err?.message || 'Failed to generate invoice');
    } finally {
      setGenerating(false);
    }
  };

  // ============================================
  // Render
  // ============================================
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-8 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Generate Invoice</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentDate((d) => addDays(startOfMonth(d), -1))}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ChevronLeft size={20} className="text-slate-600 dark:text-slate-400" />
            </button>
            <span className="text-lg font-medium text-slate-700 dark:text-slate-300 min-w-[140px] text-center">
              {format(currentDate, 'MMMM yyyy')}
            </span>
            <button
              onClick={() => setCurrentDate((d) => addDays(startOfMonth(addDays(d, 32)), 0))}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ChevronRight size={20} className="text-slate-600 dark:text-slate-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Client Selection & Invoice Generation */}
        <div className="w-96 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-6 overflow-y-auto">
          {/* Client Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Select Client
            </label>
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">Choose a client...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Work Record Info */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-indigo-600" />
            </div>
          ) : error && !workRecord ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-red-600 dark:text-red-400 mt-0.5" />
                <div>
                  <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
                </div>
              </div>
            </div>
          ) : workRecord ? (
            <div className="mb-6">
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={18} className="text-green-600 dark:text-green-400" />
                  <span className="font-medium text-green-800 dark:text-green-200">
                    Work Record Found
                  </span>
                </div>
                <p className="text-sm text-green-700 dark:text-green-300">
                  {workRecord.workingDays.length} working days configured for {format(currentDate, 'MMMM yyyy')}
                </p>
              </div>

              {/* Invoice Number Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Invoice Number
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder={getNextInvoiceNumber()}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Suggested: {getNextInvoiceNumber()}
                </p>
              </div>

              {/* Generated Filename Preview */}
              {invoiceNumber.trim() && selectedClient && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Generated Filename
                  </label>
                  <div className="px-3 py-2 bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-600 dark:text-slate-400 font-mono break-all">
                    {(() => {
                      const monthName = format(currentDate, 'MMMM').toUpperCase();
                      const year = format(currentDate, 'yyyy');
                      const safeClientName = (selectedClient.name || 'Client').replace(/\s+/g, '_');
                      return `${invoiceNumber}-${safeClientName}-Invoice-${monthName}-${year}.xlsx`;
                    })()}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                <div className="flex justify-between">
                  <span>Working Days</span>
                  <span className="font-medium text-slate-900 dark:text-white">{stats.days}</span>
                </div>
                <div className="flex justify-between">
                  <span>Daily Rate</span>
                  <span className="font-medium text-slate-900 dark:text-white">
                    {selectedClient?.dailyRate} {selectedClient?.currency}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between text-lg font-bold text-indigo-600 dark:text-indigo-400">
                  <span>Total</span>
                  <span>
                    {stats.amount.toLocaleString()} {selectedClient?.currency}
                  </span>
                </div>
              </div>

              {/* Outdated Warning */}
              {existingDocuments.find((d) => d.documentNumber === invoiceNumber)?.isOutdated && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 mt-0.5" />
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      This invoice is outdated. The work record has been modified since it was generated.
                    </p>
                  </div>
                </div>
              )}

              <button
                onClick={handleGenerateInvoice}
                disabled={generating || !workRecord}
                className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white rounded-lg font-medium transition-colors"
              >
                {generating ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet size={18} />
                    {existingDocuments.find((d) => d.documentNumber === invoiceNumber)
                      ? 'Regenerate Invoice'
                      : 'Generate Invoice'}
                  </>
                )}
              </button>

              {saveSuccess && (
                <div className="mt-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                  <p className="text-sm text-green-800 dark:text-green-200 text-center">
                    Invoice saved successfully!
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {/* Existing Documents */}
          {existingDocuments.length > 0 && (
            <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
              <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                Existing Invoices for This Client
              </h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {existingDocuments.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => setInvoiceNumber(doc.documentNumber)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      invoiceNumber === doc.documentNumber
                        ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-slate-800 dark:text-white">
                          {doc.documentNumber}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {format(parseISO(doc.month + '-01'), 'MMMM yyyy')}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                          {doc.workingDays} days × {doc.dailyRate} {selectedClient?.currency} ={' '}
                          <span className="font-medium text-slate-800 dark:text-white">
                            {doc.totalAmount.toLocaleString()} {selectedClient?.currency}
                          </span>
                        </span>
                        {doc.isOutdated && (
                          <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                            Outdated
                          </span>
                        )}
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            doc.isPaid
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          }`}
                        >
                          {doc.isPaid ? 'Paid' : 'Unpaid'}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel: Calendar View */}
        <div className="flex-1 p-8 overflow-y-auto bg-slate-50/50 dark:bg-slate-950">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-white">
                Working Days Calendar
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {workRecord
                  ? `${workRecord.workingDays.length} working days in ${format(currentDate, 'MMMM yyyy')}`
                  : 'No work record found for this month'}
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded" />
                <span className="text-slate-600 dark:text-slate-400">Working</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded" />
                <span className="text-slate-600 dark:text-slate-400">Non-working</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded" />
                <span className="text-slate-600 dark:text-slate-400">Manual Override</span>
              </div>
            </div>
          </div>

          {workRecord ? (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-4">
                {/* Day Headers */}
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                  <div
                    key={day}
                    className="text-center text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2"
                  >
                    {day}
                  </div>
                ))}

                {/* Empty cells for padding start of month */}
                {Array.from({
                  length: (startOfMonth(currentDate).getDay() + 6) % 7,
                }).map((_, i) => (
                  <div key={`pad-${i}`} />
                ))}

                {/* Days */}
                {daysInMonth.map((day) => {
                  const status = getDayStatus(day);
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const isWorking = workRecord.workingDays.includes(dateStr);
                  const isWeekendDay = isWeekend(day);
                  const holidayName = holidayNames[dateStr];
                  const isHolidayDay = !!holidayName;
                  const isManuallyOverridden =
                    status?.isManuallyExcluded || status?.isManuallyIncluded;

                  return (
                    <div
                      key={dateStr}
                      className={`
                        h-24 rounded-xl border flex flex-col items-start p-3 transition-all
                        ${
                          isWorking
                            ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm'
                            : 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800'
                        }
                        ${
                          isManuallyOverridden
                            ? 'ring-2 ring-green-200 dark:ring-green-900/50 bg-green-50 dark:bg-green-900/10'
                            : ''
                        }
                      `}
                    >
                      <span
                        className={`font-medium text-lg ${
                          isWorking
                            ? 'text-slate-700 dark:text-slate-200'
                            : 'text-slate-400 dark:text-slate-600'
                        }`}
                      >
                        {format(day, 'd')}
                      </span>

                      <div className="mt-auto flex flex-col items-start gap-1 w-full">
                        {isWeekendDay && !isWorking && (
                          <span className="text-xs px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-slate-500 dark:text-slate-400">
                            Weekend
                          </span>
                        )}
                        {isHolidayDay && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded leading-tight text-left w-full break-words"
                            title={holidayName}
                          >
                            {holidayName}
                          </span>
                        )}
                        {status?.isManuallyExcluded && (
                          <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded">
                            Off
                          </span>
                        )}
                        {status?.isManuallyIncluded && (
                          <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded">
                            Extra
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 dark:bg-slate-900/50 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center">
              <Calendar size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
              <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
                No Work Record
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                Please create a work record for {format(currentDate, 'MMMM yyyy')} first before
                generating an invoice.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
