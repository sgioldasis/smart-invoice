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
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import * as ExcelJS from 'exceljs';
import type { Client, WorkRecord, Document } from '../types';
import { getClients, getWorkRecords, deleteWorkRecord, getDocuments, saveDocument } from '../services/db';

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
  const [loading, setLoading] = useState(true);
  const [selectedClientId, setSelectedClientId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [generatingInvoiceId, setGeneratingInvoiceId] = useState<string | null>(null);

  // ============================================
  // Derived State
  // ============================================

  const filteredRecords = useMemo(() => {
    let filtered = workRecords;

    // Filter by client
    if (selectedClientId !== 'all') {
      filtered = filtered.filter((wr) => wr.clientId === selectedClientId);
    }

    // Filter by search term (month or client name)
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((wr) => {
        const client = clients.find((c) => c.id === wr.clientId);
        const monthDisplay = format(parseISO(`${wr.month}-01`), 'MMMM yyyy');
        return (
          monthDisplay.toLowerCase().includes(term) ||
          client?.name.toLowerCase().includes(term)
        );
      });
    }

    // Sort by month descending (most recent first)
    return filtered.sort((a, b) => b.month.localeCompare(a.month));
  }, [workRecords, selectedClientId, searchTerm, clients]);

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
    () => Object.keys(groupedByMonth).sort((a, b) => b.localeCompare(a)),
    [groupedByMonth]
  );

  const stats = useMemo(() => {
    const totalRecords = workRecords.length;
    const totalDays = workRecords.reduce((sum, wr) => sum + wr.totalWorkingDays, 0);
    const uniqueClients = new Set(workRecords.map((wr) => wr.clientId)).size;

    return { totalRecords, totalDays, uniqueClients };
  }, [workRecords]);

  // ============================================
  // Effects
  // ============================================

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [clientsData, recordsData, invoicesData] = await Promise.all([
          getClients(userId),
          getWorkRecords(userId),
          getDocuments(userId, { type: 'invoice' }),
        ]);
        setClients(clientsData);
        setWorkRecords(recordsData);
        setInvoices(invoicesData);
      } catch (err) {
        console.error('Error loading work records:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [userId]);

  // ============================================
  // Handlers
  // ============================================

  const handleDelete = async (record: WorkRecord) => {
    // Check if there are associated invoices
    const associatedInvoices = invoices.filter(
      inv => inv.workRecordId === record.id ||
             (inv.clientId === record.clientId && inv.month === record.month)
    );
    
    let confirmMessage = 'Are you sure you want to delete this work record?';
    if (associatedInvoices.length > 0) {
      confirmMessage = `This work record has ${associatedInvoices.length} generated invoice(s).\n\n` +
        `Deleting it will NOT delete the invoices, but they will no longer be linked to a work record.\n\n` +
        `Are you sure you want to proceed?`;
    }
    
    if (!confirm(confirmMessage)) return;

    setDeletingId(record.id);
    try {
      await deleteWorkRecord(record.id);
      setWorkRecords((prev) => prev.filter((wr) => wr.id !== record.id));
    } catch (err) {
      console.error('Error deleting work record:', err);
      alert('Failed to delete work record');
    } finally {
      setDeletingId(null);
    }
  };

  const handleEdit = (clientId: string, month: string) => {
    onEditWorkRecord?.(clientId, month);
  };

  const getNextInvoiceNumber = (clientId: string, month: string): string => {
    const prefix = `${month}`;
    const existingNumbers = invoices
      .filter((d) => d.clientId === clientId && d.documentNumber?.startsWith(prefix))
      .map((d) => {
        const match = d.documentNumber?.match(/-(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      });
    const maxNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
    return `${prefix}-${String(maxNum + 1).padStart(2, '0')}`;
  };

  const handleGenerateInvoice = async (record: WorkRecord) => {
    const client = clients.find((c) => c.id === record.clientId);
    if (!client) {
      alert('Client not found');
      return;
    }

    if (!client.templateBase64) {
      alert('No template uploaded for this client');
      return;
    }

    setGeneratingInvoiceId(record.id);

    try {
      // Get existing documents for this client
      const existingDocuments = invoices.filter((d) => d.clientId === client.id);
      
      // Get existing invoice for this work record
      const existingInvoice = invoices.find(
        inv => inv.workRecordId === record.id && inv.month === record.month
      );
      
      const invoiceNumber = existingInvoice?.documentNumber || getNextInvoiceNumber(client.id, record.month);
      const stats = {
        days: record.totalWorkingDays,
        amount: record.totalWorkingDays * client.dailyRate,
      };

      // 1. Generate Excel
      const workbook = new ExcelJS.Workbook();
      
      // Handle base64 data - remove data URL prefix if present
      let base64Data = client.templateBase64;
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
      const mapping = client.mapping;
      const setCell = (cellAddr: string, value: any) => {
        if (cellAddr && value !== undefined && value !== null) {
          const cell = worksheet.getCell(cellAddr);
          cell.value = value;
        }
      };

      const currentDate = parseISO(`${record.month}-01`);

      // Set invoice metadata
      setCell(mapping.date, format(new Date(), 'dd/MM/yyyy'));
      setCell(mapping.invoiceNumber, invoiceNumber);
      setCell(mapping.daysWorked, stats.days);
      setCell(mapping.dailyRate, client.dailyRate);
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
      const safeClientName = (client.name || 'Client').replace(/\s+/g, '_');
      const fileName = `${invoiceNumber}-${safeClientName}-Invoice-${monthName}-${year}.xlsx`;
      
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      // 4. Save document to database
      const safeClientNameForDb = (client.name || 'Client').replace(/\s+/g, '_');
      const documentData = {
        clientId: client.id,
        workRecordId: record.id,
        type: 'invoice' as const,
        documentNumber: invoiceNumber,
        month: record.month,
        workingDays: stats.days,
        workingDaysArray: record.workingDays,
        dailyRate: client.dailyRate,
        totalAmount: stats.amount,
        fileName: `${invoiceNumber}-${safeClientNameForDb}-Invoice-${monthName}-${year}.xlsx`,
        isPaid: false,
        isOutdated: false,
      };

      // Check for existing document to overwrite
      const docId = existingInvoice?.id;
      await saveDocument(userId, documentData, docId);

      // Refresh invoices list
      const updatedDocs = await getDocuments(userId, { type: 'invoice' });
      setInvoices(updatedDocs);

    } catch (err: any) {
      console.error('Error generating invoice:', err);
      alert(err?.message || 'Failed to generate invoice');
    } finally {
      setGeneratingInvoiceId(null);
    }
  };

  // ============================================
  // Render Helpers
  // ============================================

  const getClient = (clientId: string) => clients.find((c) => c.id === clientId);

  const formatMonth = (monthStr: string) => {
    return format(parseISO(`${monthStr}-01`), 'MMMM yyyy');
  };

  // ============================================
  // Render
  // ============================================

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Briefcase className="text-indigo-600" />
            Work Records
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Manage your working days by client and month
          </p>
        </div>
        <button
          onClick={onCreateWorkRecord}
          className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus size={18} />
          New Work Record
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-500 dark:text-slate-400">Total Records</div>
          <div className="text-2xl font-bold text-slate-800 dark:text-white">
            {stats.totalRecords}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-500 dark:text-slate-400">Total Days Worked</div>
          <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
            {stats.totalDays}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-500 dark:text-slate-400">Active Clients</div>
          <div className="text-2xl font-bold text-slate-800 dark:text-white">
            {stats.uniqueClients}
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
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by month or client..."
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        <select
          value={selectedClientId}
          onChange={(e) => setSelectedClientId(e.target.value)}
          className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
        >
          <option value="all">All Clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Work Records List */}
      {sortedMonths.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 dark:bg-slate-900 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
          <Briefcase size={48} className="mx-auto mb-4 text-slate-300 dark:text-slate-700" />
          <p className="text-slate-500 dark:text-slate-400 text-lg mb-2">
            {searchTerm || selectedClientId !== 'all'
              ? 'No work records match your filters'
              : 'No work records yet'}
          </p>
          <p className="text-slate-400 dark:text-slate-500 text-sm mb-4">
            {searchTerm || selectedClientId !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Create your first work record to start tracking working days'}
          </p>
          {!searchTerm && selectedClientId === 'all' && (
            <button
              onClick={onCreateWorkRecord}
              className="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-medium"
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
              <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <CalendarIcon size={18} className="text-indigo-600" />
                  <h3 className="font-semibold text-slate-800 dark:text-white">
                    {formatMonth(month)}
                  </h3>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    ({groupedByMonth[month].length} record
                    {groupedByMonth[month].length !== 1 ? 's' : ''})
                  </span>
                </div>
              </div>

              {/* Records for this month */}
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {groupedByMonth[month].map((record) => {
                  const client = getClient(record.clientId);
                  const isDeleting = deletingId === record.id;
                  const isGeneratingInvoice = generatingInvoiceId === record.id;
                  
                  // Check if invoice already exists for this work record
                  const existingInvoice = invoices.find(
                    inv => inv.workRecordId === record.id && inv.month === record.month
                  );
                  const hasExistingInvoice = !!existingInvoice;
                  const hasOutdatedInvoice = existingInvoice?.isOutdated === true;
                  const hasNoTemplate = !client?.templateBase64;

                  return (
                    <div
                      key={record.id}
                      className="px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                            <Building2 size={20} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-slate-800 dark:text-white">
                                {client?.name || 'Unknown Client'}
                              </h4>
                              {hasOutdatedInvoice && (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                  title="Work record changed after invoice was generated"
                                >
                                  <AlertTriangle size={12} />
                                  Outdated
                                </span>
                              )}
                              {hasNoTemplate && (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                  title="No template uploaded for this client"
                                >
                                  No Template
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                              <span className="flex items-center gap-1">
                                <Clock size={14} />
                                {record.totalWorkingDays} days
                              </span>
                              {record.notes && (
                                <>
                                  <span>•</span>
                                  <span className="italic truncate max-w-[200px]">
                                    {record.notes}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleGenerateInvoice(record)}
                            disabled={isGeneratingInvoice || hasNoTemplate}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              hasOutdatedInvoice
                                ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
                                : hasExistingInvoice
                                  ? 'bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:hover:bg-orange-900/50'
                                  : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50'
                            }`}
                            title={hasNoTemplate 
                              ? 'Upload a template for this client first'
                              : hasOutdatedInvoice
                                ? `Regenerate Invoice ${existingInvoice.documentNumber} - Work record changed!`
                                : hasExistingInvoice
                                  ? `Regenerate Invoice ${existingInvoice.documentNumber}`
                                  : 'Generate Invoice'}
                          >
                            {isGeneratingInvoice ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <FileSpreadsheet size={16} />
                            )}
                            {isGeneratingInvoice 
                              ? 'Generating...' 
                              : hasOutdatedInvoice 
                                ? 'Regenerate' 
                                : 'Invoice'}
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
    </div>
  );
};
