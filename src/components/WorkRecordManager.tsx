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
} from 'lucide-react';
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
import type { Client, WorkRecord, WorkRecordInput } from '../types';
import {
  calculateWorkingDaysAsync,
  fetchGreekHolidays,
  getDefaultConfig,
  WorkDayStatus,
  WorkRecordConfig,
} from '../utils/workRecordCalculator';
import {
  getClients,
  getWorkRecordByMonth,
  saveWorkRecord,
  markDocumentsAsOutdated,
} from '../services/db';

interface WorkRecordManagerProps {
  userId: string;
  initialClientId?: string;
  initialMonth?: string;
}

export const WorkRecordManager: React.FC<WorkRecordManagerProps> = ({
  userId,
  initialClientId,
  initialMonth,
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
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

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
          setHolidayNames(existing.holidayNames || {});
          setNotes(existing.notes || '');
        } else {
          // Create new with default config based on client preferences
          const defaultUseGreekHolidays =
            selectedClient?.defaultUseGreekHolidays || false;
          const newConfig = getDefaultConfig(defaultUseGreekHolidays);
          setConfig(newConfig);
          setExistingRecord(null);
          setNotes('');

          // Calculate initial working days
          const result = await calculateWorkingDaysAsync(monthStr, newConfig);
          setWorkingDays(result.workingDays);
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
      else if (isWeekendDay && config.autoExcludedWeekends)
        defaultIsWorking = false;

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
          await markDocumentsAsOutdated(existingRecord.id, workingDays);
          console.log('Checked and marked outdated documents');
        } catch (outdatedErr) {
          console.error('Failed to mark documents as outdated:', outdatedErr);
          // Don't fail the save if marking as outdated fails
        }
      }

      console.log('Work record saved successfully:', saved);
      setExistingRecord(saved);
      setSaveSuccess(true);

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
              className={`w-10 h-6 rounded-full transition-colors relative ${
                config.useGreekHolidays
                  ? 'bg-indigo-600'
                  : 'bg-slate-300 dark:bg-slate-600'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  config.useGreekHolidays ? 'left-5' : 'left-1'
                }`}
              />
            </button>
          </div>

          {config.useGreekHolidays && (
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
              Fetching data from Public Holidays API
            </p>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600 dark:text-slate-400">
              Auto-exclude Weekends
            </span>
            <button
              onClick={() =>
                setConfig((prev) => ({
                  ...prev,
                  autoExcludedWeekends: !prev.autoExcludedWeekends,
                }))
              }
              className={`w-10 h-6 rounded-full transition-colors relative ${
                config.autoExcludedWeekends
                  ? 'bg-indigo-600'
                  : 'bg-slate-300 dark:bg-slate-600'
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  config.autoExcludedWeekends ? 'left-5' : 'left-1'
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
        {existingRecord && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 text-sm">
              <Info size={16} />
              <span>Editing existing record</span>
            </div>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
              Last updated:{' '}
              {format(parseISO(existingRecord.updatedAt), 'dd/MM/yyyy HH:mm')}
            </p>
          </div>
        )}

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

        {/* Summary & Save */}
        <div className="mt-auto bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-3">
            Summary
          </h3>
          <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
            <div className="flex justify-between text-lg font-bold text-indigo-600 dark:text-indigo-400">
              <span>Working Days</span>
              <span>{workingDays.length}</span>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white rounded-lg font-medium transition-colors"
          >
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save size={18} />
                {existingRecord ? 'Update Work Record' : 'Save Work Record'}
              </>
            )}
          </button>
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
                  h-24 rounded-xl border flex flex-col items-start p-3 transition-all relative
                  ${
                    isWorking
                      ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-md'
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
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
