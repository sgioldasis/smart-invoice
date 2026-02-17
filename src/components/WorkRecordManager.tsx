/**
 * WorkRecordManager Component
 *
 * Main UI for recording and managing working days for a specific client/month.
 * Allows users to:
 * - Select client and month
 * - Toggle working/non-working days via calendar
 * - Configure holiday settings
 * - Save work records to Firestore
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calendar as CalendarIcon,
  Save,
  ChevronLeft,
  ChevronRight,
  Check,
  Briefcase,
  Building2,
  Loader2,
  Info,
  FileSpreadsheet,
  Upload,
  X,
  Bot,
  Download,
} from 'lucide-react';
import * as ExcelJS from 'exceljs';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isWeekend,
  isSameDay,
  addMonths,
  subMonths,
  parseISO,
} from 'date-fns';
import type { Client, WorkRecord, WorkRecordInput, WorkRecordTimesheet, Template } from '../types';
import {
  calculateWorkingDaysAsync,
  fetchGreekHolidays,
  getDefaultConfig,
  getWeekendDatesInMonth,
  WorkDayStatus,
  WorkRecordConfig,
} from '../utils/workRecordCalculator';
import {
  getClients,
  getWorkRecordByMonth,
  saveWorkRecord,
  markDocumentsAsOutdated,
  getTimesheetByWorkRecord,
  saveTimesheet,
  saveDocument,
  getTemplateById,
} from '../services/db';

interface WorkRecordManagerProps {
  userId: string;
  initialClientId?: string;
  initialMonth?: string;
  onSave?: () => void;
}

export const WorkRecordManager: React.FC<WorkRecordManagerProps> = ({
  userId,
  initialClientId,
  initialMonth,
  onSave,
}) => {
  // ============================================
  // State
  // ============================================

  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [currentDate, setCurrentDate] = useState(() => {
    if (initialMonth) {
      const [year, month] = initialMonth.split('-').map(Number);
      return new Date(year, month - 1);
    }
    return new Date();
  });

  const [config, setConfig] = useState<WorkRecordConfig>(getDefaultConfig());
  const [workingDays, setWorkingDays] = useState<string[]>([]);
  const [holidayNames, setHolidayNames] = useState<Record<string, string>>({});
  const [dayStatuses, setDayStatuses] = useState<WorkDayStatus[]>([]);

  const [existingRecord, setExistingRecord] = useState<WorkRecord | null>(null);
  const [originalWorkingDays, setOriginalWorkingDays] = useState<string[]>([]);
  const [originalNotes, setOriginalNotes] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Timesheet state
  const [showTimesheetDialog, setShowTimesheetDialog] = useState(false);
  const [timesheetTemplate, setTimesheetTemplate] = useState<WorkRecordTimesheet | null>(null);
  const [timesheetPrompt, setTimesheetPrompt] = useState('');
  const [monthTemplateFile, setMonthTemplateFile] = useState<File | null>(null);
  const [monthTemplateBase64, setMonthTemplateBase64] = useState<string | null>(null);
  const [generatingTimesheet, setGeneratingTimesheet] = useState(false);
  const [timesheetError, setTimesheetError] = useState<string | null>(null);
  const [clientTimesheetTemplate, setClientTimesheetTemplate] = useState<Template | null>(null);

  // ============================================
  // Derived State
  // ============================================

  const monthStr = useMemo(
    () => format(currentDate, 'yyyy-MM'),
    [currentDate]
  );

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId),
    [clients, selectedClientId]
  );

  const daysInMonth = useMemo(() => {
    return eachDayOfInterval({
      start: startOfMonth(currentDate),
      end: endOfMonth(currentDate),
    });
  }, [currentDate]);

  // Check if any changes were made to the work record
  const hasChanges = useMemo(() => {
    if (!existingRecord) return true; // New record always has changes (can save)
    const workingDaysChanged = JSON.stringify(workingDays.sort()) !== JSON.stringify(originalWorkingDays.sort());
    const notesChanged = notes !== originalNotes;
    return workingDaysChanged || notesChanged;
  }, [existingRecord, workingDays, originalWorkingDays, notes, originalNotes]);

  // ============================================
  // Effects
  // ============================================

  // Load clients on mount
  useEffect(() => {
    const loadClients = async () => {
      const data = await getClients(userId);
      setClients(data);
      if (initialClientId) {
        setSelectedClientId(initialClientId);
      } else if (data.length > 0) {
        setSelectedClientId(data[0].id);
      }
      setLoading(false);
    };
    loadClients();
  }, [userId, initialClientId]);

  // Fetch holidays when year changes
  useEffect(() => {
    const year = currentDate.getFullYear();
    fetchGreekHolidays(year);
  }, [currentDate.getFullYear()]);

  // Load or create work record when client/month changes
  useEffect(() => {
    if (!selectedClientId) return;

    const loadWorkRecord = async () => {
      setLoading(true);
      setSaveError(null);
      setSaveSuccess(false);

      try {
        // Check for existing work record
        const existing = await getWorkRecordByMonth(
          userId,
          selectedClientId,
          monthStr
        );

        if (existing) {
          // Load existing record
          setExistingRecord(existing);
          setConfig(existing.config);
          setWorkingDays(existing.workingDays);
          setOriginalWorkingDays(existing.workingDays);
          setHolidayNames(existing.holidayNames || {});
          setNotes(existing.notes || '');
          setOriginalNotes(existing.notes || '');
        } else {
          // Create new with default config based on client preferences
          const defaultUseGreekHolidays =
            selectedClient?.defaultUseGreekHolidays || false;
          const newConfig = getDefaultConfig(defaultUseGreekHolidays);
          setConfig(newConfig);
          setExistingRecord(null);
          setNotes('');
          setOriginalNotes('');

          // Calculate initial working days
          const result = await calculateWorkingDaysAsync(monthStr, newConfig);
          setWorkingDays(result.workingDays);
          setOriginalWorkingDays(result.workingDays);
          setHolidayNames(result.holidayNames);
          setDayStatuses(result.dayStatuses);
        }
      } catch (err) {
        console.error('Error loading work record:', err);
        setSaveError('Failed to load work record');
      } finally {
        setLoading(false);
      }
    };

    loadWorkRecord();
  }, [userId, selectedClientId, monthStr, selectedClient]);

  // Load timesheet template for this work record
  useEffect(() => {
    const loadTimesheet = async () => {
      if (!existingRecord?.id) {
        setTimesheetTemplate(null);
        setTimesheetPrompt(selectedClient?.timesheetPrompt || '');
        return;
      }

      try {
        const ts = await getTimesheetByWorkRecord(existingRecord.id);
        setTimesheetTemplate(ts);
        // Use month-specific prompt if available, otherwise fall back to client's default
        setTimesheetPrompt(ts?.prompt || selectedClient?.timesheetPrompt || '');
      } catch (err) {
        console.error('Error loading timesheet template:', err);
        setTimesheetPrompt(selectedClient?.timesheetPrompt || '');
      }
    };

    loadTimesheet();
  }, [existingRecord?.id, selectedClient]);

  // Recalculate when config changes
  useEffect(() => {
    const recalculate = async () => {
      const result = await calculateWorkingDaysAsync(monthStr, config);
      setWorkingDays(result.workingDays);
      setHolidayNames(result.holidayNames);
      setDayStatuses(result.dayStatuses);
    };

    recalculate();
  }, [config, monthStr]);

  // ============================================
  // Handlers
  // ============================================

  const handleToggleDay = useCallback(
    (date: Date) => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const isWeekendDay = isWeekend(date);
      const holidayName = holidayNames[dateStr];
      const isHolidayDay = !!holidayName;
      const isManuallyExcluded = config.excludedDates.includes(dateStr);
      const isManuallyIncluded = config.includedDates.includes(dateStr);

      // Determine default status
      let defaultIsWorking = true;
      if (isHolidayDay) defaultIsWorking = false;
      else if (isWeekendDay) defaultIsWorking = false;

      // Apply manual overrides to get current status
      let isWorking = defaultIsWorking;
      if (isManuallyIncluded) isWorking = true;
      if (isManuallyExcluded) isWorking = false;

      // Toggle
      const newConfig = { ...config };

      if (isWorking) {
        // Currently working, make it non-working
        if (isManuallyIncluded) {
          // Remove manual inclusion
          newConfig.includedDates = newConfig.includedDates.filter(
            (d) => d !== dateStr
          );
        } else {
          // Add manual exclusion
          newConfig.excludedDates = [...newConfig.excludedDates, dateStr];
        }
      } else {
        // Currently non-working, make it working
        if (isManuallyExcluded) {
          // Remove manual exclusion
          newConfig.excludedDates = newConfig.excludedDates.filter(
            (d) => d !== dateStr
          );
        } else {
          // Add manual inclusion
          newConfig.includedDates = [...newConfig.includedDates, dateStr];
        }
      }

      setConfig(newConfig);
    },
    [config, holidayNames]
  );

  const handleToggleGreekHolidays = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      useGreekHolidays: !prev.useGreekHolidays,
    }));
  }, []);

  const handleSave = async () => {
    if (!selectedClient) {
      setSaveError('Please select a client before saving.');
      return;
    }

    if (!userId) {
      setSaveError('You must be logged in to save work records.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const workRecordInput: WorkRecordInput = {
        clientId: selectedClientId,
        month: monthStr,
        workingDays,
        weekendDates: getWeekendDatesInMonth(monthStr),
        holidayNames,
        config,
        notes: notes.trim() || undefined,
        totalWorkingDays: workingDays.length,
      };

      console.log('Saving work record:', { userId, workRecordInput, existingId: existingRecord?.id });

      const saved = await saveWorkRecord(
        userId,
        workRecordInput,
        existingRecord?.id
      );

      // If updating an existing work record, check and mark outdated documents
      if (existingRecord?.id) {
        try {
          // Pass both working days and weekend dates for comparison
          const weekendDates = getWeekendDatesInMonth(monthStr);
          await markDocumentsAsOutdated(existingRecord.id, workingDays, weekendDates);
          console.log('Checked and marked outdated documents');
        } catch (outdatedErr) {
          console.error('Failed to mark documents as outdated:', outdatedErr);
          // Don't fail the save if marking as outdated fails
        }
      }

      console.log('Work record saved successfully:', saved);
      setExistingRecord(saved);
      // Update original values after successful save
      setOriginalWorkingDays(saved.workingDays);
      setOriginalNotes(saved.notes || '');
      setSaveSuccess(true);

      // Notify parent component that save was successful
      onSave?.();

      // Clear success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error saving work record:', err);
      console.error('Error code:', err?.code);
      console.error('Error message:', err?.message);
      console.error('Full error object:', JSON.stringify(err, null, 2));

      // Provide user-friendly error messages
      let errorMessage = 'Failed to save work record.';

      if (err?.code === 'permission-denied') {
        errorMessage = `Permission denied. This usually means:
1. You're not logged in (try refreshing the page)
2. The Firestore security rules haven't been deployed yet

To deploy the rules, run: firebase deploy --only firestore:rules`;
      } else if (err?.code === 'unauthenticated') {
        errorMessage = 'You are not logged in. Please sign in and try again.';
      } else if (err?.code === 'not-found') {
        errorMessage = 'The database collection does not exist yet. Please deploy the Firestore rules first:\nfirebase deploy --only firestore:rules';
      } else if (err?.message) {
        errorMessage += ` Error: ${err.message}`;
      }

      setSaveError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  // ============================================
  // Render Helpers
  // ============================================

  const getDayStatus = (day: Date): WorkDayStatus | undefined => {
    return dayStatuses.find((s) => isSameDay(s.date, day));
  };

  // ============================================
  // Timesheet Handlers
  // ============================================

  const handleOpenTimesheetDialog = () => {
    if (!existingRecord) {
      setSaveError('Please save the work record first before generating a timesheet.');
      return;
    }
    setShowTimesheetDialog(true);
    setTimesheetError(null);
  };

  const handleMonthTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result as string;
      const base64 = btoa(bstr);
      setMonthTemplateFile(file);
      setMonthTemplateBase64(base64);
    };
    reader.readAsBinaryString(file);
  };

  const handleClearMonthTemplate = () => {
    setMonthTemplateFile(null);
    setMonthTemplateBase64(null);
  };

  const handleSaveTimesheetConfig = async () => {
    if (!existingRecord || !selectedClient) return;

    try {
      await saveTimesheet(userId, {
        clientId: selectedClientId,
        workRecordId: existingRecord.id,
        month: monthStr,
        templateName: monthTemplateFile?.name || timesheetTemplate?.templateName || null,
        templateBase64: monthTemplateBase64 || timesheetTemplate?.templateBase64 || null,
        prompt: timesheetPrompt || null,
      }, timesheetTemplate?.id);

      // Refresh timesheet data
      const updated = await getTimesheetByWorkRecord(existingRecord.id);
      setTimesheetTemplate(updated);
      setMonthTemplateFile(null);
      setMonthTemplateBase64(null);
    } catch (err) {
      console.error('Error saving timesheet config:', err);
      setTimesheetError('Failed to save timesheet configuration');
    }
  };

  const handleGenerateTimesheet = async () => {
    if (!selectedClient || !existingRecord) {
      setTimesheetError('Please save the work record first');
      return;
    }

    // Determine which template to use: month-specific > new template structure > legacy
    const templateBase64 = monthTemplateBase64 ||
      timesheetTemplate?.templateBase64 ||
      clientTimesheetTemplate?.base64Data ||
      selectedClient.timesheetTemplateBase64;
    const templateName = monthTemplateFile?.name ||
      timesheetTemplate?.templateName ||
      clientTimesheetTemplate?.fileName ||
      selectedClient.timesheetTemplateName;
    const prompt = timesheetPrompt || clientTimesheetTemplate?.timesheetPrompt || selectedClient.timesheetPrompt;

    if (!templateBase64) {
      setTimesheetError('No timesheet template available. Please upload a template in the client settings or for this month.');
      return;
    }

    setGeneratingTimesheet(true);
    setTimesheetError(null);

    try {
      // Save the configuration first
      await handleSaveTimesheetConfig();

      // Generate the timesheet
      const workbook = new ExcelJS.Workbook();

      // Handle base64 data
      let base64Data = templateBase64;
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1];
      }
      base64Data = base64Data.replace(/\s/g, '');

      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)) {
        throw new Error('Invalid template data format');
      }

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

      // Simple approach: Only replace placeholders, don't add/remove rows or columns
      // The template structure is preserved exactly as uploaded

      // Basic: Fill in working days information
      const workingDaysList = existingRecord.workingDays.map(dateStr => {
        const date = parseISO(dateStr);
        return {
          date: format(date, 'dd/MM/yyyy'),
          dayOfWeek: format(date, 'EEEE'),
          dayNumber: format(date, 'd'),
        };
      });

      // Replace placeholders throughout the worksheet
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          const cellValue = cell.value;
          if (typeof cellValue === 'string') {
            if (cellValue.includes('{{MONTH}}')) {
              cell.value = cellValue.replace('{{MONTH}}', format(currentDate, 'MMMM yyyy'));
            }
            if (cellValue.includes('{{CLIENT}}')) {
              cell.value = cellValue.replace('{{CLIENT}}', selectedClient.name);
            }
            if (cellValue.includes('{{TOTAL_DAYS}}')) {
              cell.value = cellValue.replace('{{TOTAL_DAYS}}', String(existingRecord.workingDays.length));
            }
          }
        });
      });

      // Fill working days only if mapping is configured
      // This fills existing cells without creating new rows
      // Use template's mapping if available, otherwise fall back to client's mapping
      const timesheetMapping = clientTimesheetTemplate?.timesheetMapping || selectedClient.timesheetMapping;
      if (timesheetMapping) {
        const { dateColumn, hoursColumn, descriptionColumn, startRow } = timesheetMapping;
        const firstDataRow = startRow || 2;

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

      // Apply AI prompt instructions if provided
      if (prompt) {
        console.log('Applying AI prompt:', prompt);

        // Parse prompt for column assignments
        const promptLower = prompt.toLowerCase();

        // Extract column letters from patterns like "column A", "col B", "column C"
        const dateColumnMatch = promptLower.match(/date(?:\s+s)?(?:\s+in)?\s+(?:col(?:umn)?\s+)?([a-z])\b/);
        const hoursColumnMatch = promptLower.match(/hours?(?:\s+in)?\s+(?:col(?:umn)?\s+)?([a-z])\b/);
        const descColumnMatch = promptLower.match(/(?:desc|description)(?:\s+in)?\s+(?:col(?:umn)?\s+)?([a-z])\b/);

        // Extract start row
        const startRowMatch = promptLower.match(/(?:start|begin)(?:\s+from)?\s+row\s+(\d+)/);

        // Extract hours per day
        const hoursPerDayMatch = promptLower.match(/(\d+)\s+hours?\s+(?:per|each)\s+day/);

        const parsedMapping = {
          dateColumn: dateColumnMatch ? dateColumnMatch[1].toUpperCase() : selectedClient.timesheetMapping?.dateColumn,
          hoursColumn: hoursColumnMatch ? hoursColumnMatch[1].toUpperCase() : selectedClient.timesheetMapping?.hoursColumn,
          descriptionColumn: descColumnMatch ? descColumnMatch[1].toUpperCase() : selectedClient.timesheetMapping?.descriptionColumn,
          startRow: startRowMatch ? parseInt(startRowMatch[1]) : (selectedClient.timesheetMapping?.startRow || 2),
          hoursPerDay: hoursPerDayMatch ? parseInt(hoursPerDayMatch[1]) : 8,
        };

        console.log('Parsed mapping from prompt:', parsedMapping);

        // Apply the parsed mapping if columns were found in prompt
        if (dateColumnMatch || hoursColumnMatch || descColumnMatch) {
          const firstDataRow = parsedMapping.startRow;

          for (let i = 0; i < workingDaysList.length; i++) {
            const day = workingDaysList[i];
            const rowNum = firstDataRow + i;

            // Only fill if the row exists in the template
            const row = worksheet.getRow(rowNum);
            if (row) {
              if (parsedMapping.dateColumn) {
                const dateCell = worksheet.getCell(`${parsedMapping.dateColumn}${rowNum}`);
                dateCell.value = day.date;
              }

              if (parsedMapping.hoursColumn) {
                const hoursCell = worksheet.getCell(`${parsedMapping.hoursColumn}${rowNum}`);
                hoursCell.value = parsedMapping.hoursPerDay;
              }

              if (parsedMapping.descriptionColumn) {
                const descCell = worksheet.getCell(`${parsedMapping.descriptionColumn}${rowNum}`);
                descCell.value = `Working day - ${day.dayOfWeek}`;
              }
            }
          }
        }
      }

      // Generate filename
      const monthName = format(currentDate, 'MMMM').toUpperCase();
      const year = format(currentDate, 'yyyy');
      const safeClientName = (selectedClient.name || 'Client').replace(/\s+/g, '_');
      const fileName = `Timesheet-${safeClientName}-${monthName}-${year}.xlsx`;

      // Download the file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      // Save document record with all relevant data from work record
      await saveDocument(userId, {
        clientId: selectedClient.id,
        workRecordId: existingRecord.id,
        type: 'timesheet',
        documentNumber: `TS-${monthStr}`,
        month: monthStr,
        workingDays: existingRecord.workingDays.length,
        workingDaysArray: existingRecord.workingDays,
        weekendDatesArray: existingRecord.weekendDates, // Store for outdated detection
        dailyRate: selectedClient.dailyRate,
        totalAmount: existingRecord.workingDays.length * selectedClient.dailyRate,
        fileName,
      });

      setShowTimesheetDialog(false);
    } catch (err: any) {
      console.error('Error generating timesheet:', err);
      setTimesheetError(err?.message || 'Failed to generate timesheet');
    } finally {
      setGeneratingTimesheet(false);
    }
  };

  // ============================================
  // Render
  // ============================================

  if (loading && clients.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500 dark:text-slate-400">
        <Briefcase size={48} className="mx-auto mb-4 text-slate-300 dark:text-slate-700" />
        <p className="text-lg mb-2">No clients found</p>
        <p className="text-sm">
          Please create a client first to start recording work days.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left Panel: Configuration */}
      <div className="w-80 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 p-6 overflow-y-auto flex flex-col h-full">
        {/* Month Navigation */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            <CalendarIcon size={16} className="inline mr-1" />
            Month
          </label>
          <div className="flex items-center justify-between bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setCurrentDate(subMonths(currentDate, 1))}
              className="p-2 hover:bg-white dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300 transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            <span className="font-semibold text-slate-800 dark:text-white">
              {format(currentDate, 'MMMM yyyy')}
            </span>
            <button
              onClick={() => setCurrentDate(addMonths(currentDate, 1))}
              className="p-2 hover:bg-white dark:hover:bg-slate-700 rounded text-slate-600 dark:text-slate-300 transition-colors"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Client Selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            <Building2 size={16} className="inline mr-1" />
            Client
          </label>
          <select
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Configuration Options */}
        <div className="space-y-4 mb-6">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600 dark:text-slate-400">
              Exclude Greek Holidays
            </span>
            <button
              onClick={handleToggleGreekHolidays}
              className={`w-10 h-6 rounded-full transition-colors relative ${config.useGreekHolidays
                  ? 'bg-indigo-600'
                  : 'bg-slate-300 dark:bg-slate-600'
                }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${config.useGreekHolidays ? 'left-5' : 'left-1'
                  }`}
              />
            </button>
          </div>

        </div>

        {/* Notes */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes about this work period..."
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm h-24 resize-none focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>

        {/* Status Messages */}
        {saveError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-start gap-2">
              <Info size={16} className="text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div className="text-red-700 dark:text-red-300 text-sm break-words">
                {saveError}
              </div>
            </div>
          </div>
        )}

        {saveSuccess && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300 text-sm">
              <Check size={16} />
              <span>Work record saved successfully!</span>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="mt-auto bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-3">
            Summary
          </h3>
          <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
            <div className="flex justify-between text-lg font-bold text-indigo-600 dark:text-indigo-400">
              <span>Working Days</span>
              <span>{workingDays.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel: Calendar */}
      <div className="flex-1 p-8 overflow-y-auto bg-slate-50/50 dark:bg-slate-950">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">
              Working Days Calendar
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Click on any day to toggle it as working or non-working
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Cancel/Save Buttons */}
            <button
              onClick={onSave}
              className="flex items-center gap-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition"
            >
              <X size={18} />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || (!!existingRecord && !hasChanges)}
              className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 transition"
              title={existingRecord && !hasChanges ? 'No changes to save' : ''}
            >
              {saving ? (
                <Loader2 size={18} className="animate-spin" />
              ) : existingRecord ? (
                <Save size={18} />
              ) : (
                <Check size={18} />
              )}
              {existingRecord ? 'Update' : 'Save'}
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-sm mb-6">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-white dark:bg-slate-800 border-2 border-green-300 dark:border-green-600 rounded" />
            <span className="text-slate-600 dark:text-slate-400">Working</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded" />
            <span className="text-slate-600 dark:text-slate-400">Non-working</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-white dark:bg-slate-800 border-2 border-blue-300 dark:border-blue-600 rounded" />
            <span className="text-slate-600 dark:text-slate-400">Holiday</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-white dark:bg-slate-800 border-2 border-amber-300 dark:border-amber-500 rounded" />
            <span className="text-slate-600 dark:text-slate-400">Manual Override</span>
          </div>
        </div>

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
            const isWorking = workingDays.includes(dateStr);
            const isWeekendDay = isWeekend(day);
            const holidayName = holidayNames[dateStr];
            const isHolidayDay = !!holidayName;
            const isManuallyOverridden =
              status?.isManuallyExcluded || status?.isManuallyIncluded;

            return (
              <button
                key={dateStr}
                onClick={() => handleToggleDay(day)}
                disabled={loading}
                className={`
                  h-24 rounded-xl border-2 flex flex-col items-start p-3 transition-all relative
                  ${isManuallyOverridden
                    ? 'bg-white dark:bg-slate-800 border-amber-300 dark:border-amber-500 shadow-sm hover:border-amber-400 dark:hover:border-amber-400'
                    : isHolidayDay
                      ? 'bg-white dark:bg-slate-800 border-blue-300 dark:border-blue-600 shadow-sm hover:border-blue-400 dark:hover:border-blue-500'
                      : isWorking
                        ? 'bg-white dark:bg-slate-800 border-green-300 dark:border-green-600 shadow-sm hover:border-green-400 dark:hover:border-green-500 hover:shadow-md'
                        : 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800'
                  }
                `}
              >
                <span
                  className={`font-medium text-lg ${isWorking
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
              </button>
            );
          })}
        </div>
      </div>

      {/* Timesheet Dialog */}
      {showTimesheetDialog && existingRecord && selectedClient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <FileSpreadsheet className="text-blue-600 dark:text-blue-400" />
                Generate Timesheet
              </h2>
              <button
                onClick={() => setShowTimesheetDialog(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-500 dark:text-slate-400"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Template Source Info */}
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <h3 className="font-medium text-blue-800 dark:text-blue-300 mb-2 flex items-center gap-2">
                  <Info size={16} />
                  Template Source
                </h3>
                <p className="text-sm text-blue-700 dark:text-blue-400">
                  {monthTemplateFile ? (
                    <>Using newly uploaded template: <strong>{monthTemplateFile.name}</strong></>
                  ) : timesheetTemplate?.templateName ? (
                    <>Using saved month-specific template: <strong>{timesheetTemplate.templateName}</strong></>
                  ) : selectedClient.timesheetTemplateName ? (
                    <>Using client default template: <strong>{selectedClient.timesheetTemplateName}</strong></>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">No template available. Please upload one below or in client settings.</span>
                  )}
                </p>
              </div>

              {/* Month-Specific Template Upload */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Month-Specific Template (Optional)
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Upload a different template for {format(currentDate, 'MMMM yyyy')} only.
                  If not provided, the client's default template will be used.
                </p>
                <div className="flex items-center gap-4">
                  <label className="cursor-pointer bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 transition flex items-center gap-2">
                    <Upload size={16} /> Upload Template
                    <input
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      onChange={handleMonthTemplateUpload}
                    />
                  </label>
                  {monthTemplateFile && (
                    <span className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                      <Check size={16} className="text-green-500" />
                      {monthTemplateFile.name}
                      <button
                        onClick={handleClearMonthTemplate}
                        className="p-1 hover:bg-slate-200 dark:hover:bg-slate-600 rounded"
                      >
                        <X size={14} className="text-slate-400" />
                      </button>
                    </span>
                  )}
                  {!monthTemplateFile && timesheetTemplate?.templateName && (
                    <span className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                      <Check size={16} className="text-green-500" />
                      {timesheetTemplate.templateName}
                    </span>
                  )}
                </div>
              </div>

              {/* Prompt Input */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                  <Bot size={16} />
                  AI Prompt Instructions
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Describe how to fill out the timesheet. This will be saved for this month and used when generating.
                </p>
                <textarea
                  value={timesheetPrompt}
                  onChange={(e) => setTimesheetPrompt(e.target.value)}
                  placeholder="e.g., Fill in the Date column with each working day of the month. Set the Project column to 'Main Project'. Calculate Total Hours as 8 hours per working day."
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm h-24 resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                />
                {!timesheetPrompt && selectedClient.timesheetPrompt && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Client default prompt will be used if left empty.
                  </p>
                )}
              </div>

              {/* Error Message */}
              {timesheetError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Info size={16} className="text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                    <div className="text-red-700 dark:text-red-300 text-sm">{timesheetError}</div>
                  </div>
                </div>
              )}

              {/* Working Days Summary */}
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                <h4 className="font-medium text-slate-700 dark:text-slate-300 mb-2">Working Days Summary</h4>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {workingDays.length} working days in {format(currentDate, 'MMMM yyyy')}
                </p>
              </div>
            </div>

            {/* Dialog Actions */}
            <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
              <button
                onClick={() => setShowTimesheetDialog(false)}
                className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateTimesheet}
                disabled={generatingTimesheet || (!selectedClient.timesheetTemplateBase64 && !timesheetTemplate?.templateBase64 && !monthTemplateBase64)}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg font-medium flex items-center gap-2"
              >
                {generatingTimesheet ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Download size={18} />
                    Generate & Download
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
