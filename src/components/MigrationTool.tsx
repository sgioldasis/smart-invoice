/**
 * Migration Tool Component
 * 
 * Provides a UI for running the migration from old InvoiceRecord
 * to new WorkRecord + Document structure.
 */

import React, { useState, useEffect } from 'react';
import {
  Database,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Play,
  Eye,
  ArrowRight,
  FileText,
  Briefcase,
} from 'lucide-react';
import { getInvoices, getClients, saveWorkRecord, saveDocument, getWorkRecordByMonth } from '../services/db';
import { runMigration, previewMigration, MigrationResult } from '../utils/migration';
import type { InvoiceRecord, Client } from '../types';

interface MigrationToolProps {
  userId: string;
}

export const MigrationTool: React.FC<MigrationToolProps> = ({ userId }) => {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewMode, setPreviewMode] = useState(true);
  const [preview, setPreview] = useState<{
    totalInvoices: number;
    wouldCreateWorkRecords: number;
    wouldCreateDocuments: number;
    sample: {
      invoiceId: string;
      month: string;
      workingDays: number;
      status: string;
    }[];
  } | null>(null);
  
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load existing invoices
  useEffect(() => {
    const loadData = async () => {
      try {
        const [invoicesData, clientsData] = await Promise.all([
          getInvoices(userId),
          getClients(userId),
        ]);
        setInvoices(invoicesData);
        setClients(clientsData);
        
        // Generate preview
        const clientMap = new Map<string, Client>(clientsData.map(c => [c.id, c]));
        
        // Count unique client/month combinations
        const uniqueClientMonths = new Set(
          invoicesData.map(inv => `${inv.clientId}-${inv.month}`)
        );
        const generatedInvoices = invoicesData.filter(inv => inv.status === 'generated');
        
        const previewResult = previewMigration(
          invoicesData,
          (clientId) => {
            const client = clientMap.get(clientId);
            return client ? { dailyRate: client.dailyRate, currency: client.currency } : null;
          }
        );
        
        // Override the work record count to show unique count
        previewResult.wouldCreateWorkRecords = uniqueClientMonths.size;
        previewResult.wouldCreateDocuments = generatedInvoices.length;
        
        setPreview(previewResult);
      } catch (err) {
        setError('Failed to load existing invoices');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [userId]);

  const handleRunMigration = async () => {
    if (!confirm('Are you sure you want to migrate all existing invoices? This cannot be undone.')) {
      return;
    }

    setMigrating(true);
    setError(null);
    setResult(null);

    try {
      const clientMap = new Map<string, Client>(clients.map(c => [c.id, c]));
      
      const migrationResult = await runMigration(
        invoices,
        (clientId) => {
          const client = clientMap.get(clientId);
          if (!client) throw new Error(`Client not found: ${clientId}`);
          return { dailyRate: client.dailyRate, currency: client.currency };
        },
        async (workRecordInput) => {
          const saved = await saveWorkRecord(userId, workRecordInput);
          return { id: saved.id };
        },
        async (documentInput) => {
          const saved = await saveDocument(userId, documentInput);
          return { id: saved.id };
        },
        async (clientId, month) => {
          return await getWorkRecordByMonth(userId, clientId, month);
        },
        (current, total) => setProgress({ current, total })
      );

      setResult(migrationResult);
    } catch (err: any) {
      setError(err?.message || 'Migration failed');
    } finally {
      setMigrating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-indigo-600" />
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-8 text-center">
        <CheckCircle size={48} className="mx-auto mb-4 text-green-500" />
        <h3 className="text-lg font-medium text-slate-800 dark:text-white mb-2">
          No Migration Needed
        </h3>
        <p className="text-slate-500 dark:text-slate-400">
          You don't have any existing invoices to migrate.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
            <Database size={24} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">
              Data Migration
            </h2>
            <p className="text-slate-600 dark:text-slate-400 mb-4">
              Migrate your existing {invoices.length} invoice(s) to the new Work Record system. 
              This will create:
            </p>
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
              <li className="flex items-center gap-2">
                <Briefcase size={16} className="text-indigo-500" />
                <span><strong>Work Records</strong> - Stored facts about days worked</span>
              </li>
              <li className="flex items-center gap-2">
                <FileText size={16} className="text-indigo-500" />
                <span><strong>Documents</strong> - Generated invoices (for completed ones)</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setPreviewMode(true)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            previewMode
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          <Eye size={18} />
          Preview
        </button>
        <button
          onClick={() => setPreviewMode(false)}
          disabled={migrating}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            !previewMode
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          <Play size={18} />
          Run Migration
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-red-800 dark:text-red-300">Migration Error</h4>
              <p className="text-red-700 dark:text-red-400 text-sm mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Preview Mode */}
      {previewMode && preview && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-medium text-slate-800 dark:text-white mb-4">
            Migration Preview
          </h3>
          
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold text-slate-800 dark:text-white">
                {preview.totalInvoices}
              </div>
              <div className="text-sm text-slate-500 dark:text-slate-400">Total Invoices</div>
            </div>
            <div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                {preview.wouldCreateWorkRecords}
              </div>
              <div className="text-sm text-indigo-600 dark:text-indigo-400">Work Records</div>
            </div>
            <div className="bg-green-50 dark:bg-green-900/30 p-4 rounded-lg text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {preview.wouldCreateDocuments}
              </div>
              <div className="text-sm text-green-600 dark:text-green-400">Documents</div>
            </div>
          </div>

          <h4 className="font-medium text-slate-800 dark:text-white mb-3">Sample Conversions</h4>
          <div className="space-y-2">
            {preview.sample.map((item) => (
              <div
                key={item.invoiceId}
                className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <ArrowRight size={16} className="text-slate-400" />
                  <span className="text-slate-700 dark:text-slate-300">
                    Invoice for {item.month}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-slate-500 dark:text-slate-400">
                    {item.workingDays} working days
                  </span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    item.status === 'generated'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                  }`}>
                    {item.status}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <div className="text-sm text-amber-700 dark:text-amber-300">
                <strong>Important:</strong> This migration cannot be undone. Original invoices will remain in the old collection for safety.
              </div>
            </div>
          </div>

          <button
            onClick={() => setPreviewMode(false)}
            disabled={migrating}
            className="mt-6 w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white rounded-lg font-medium transition-colors"
          >
            <Play size={18} />
            Proceed to Migration
          </button>
        </div>
      )}

      {/* Run Mode */}
      {!previewMode && !result && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="text-lg font-medium text-slate-800 dark:text-white mb-4">
            Run Migration
          </h3>

          {migrating ? (
            <div className="text-center py-8">
              <Loader2 size={48} className="mx-auto mb-4 animate-spin text-indigo-600" />
              <p className="text-slate-600 dark:text-slate-400">
                Migrating {progress.current} of {progress.total} invoices...
              </p>
              <div className="mt-4 max-w-md mx-auto">
                <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className="text-slate-600 dark:text-slate-400 mb-6">
                Click the button below to start the migration. This will:
              </p>
              <ol className="list-decimal list-inside space-y-2 text-slate-600 dark:text-slate-400 mb-6">
                <li>Create a Work Record for each invoice</li>
                <li>Create a Document for each generated invoice</li>
                <li>Preserve all your existing data</li>
              </ol>

              <div className="flex gap-4">
                <button
                  onClick={() => setPreviewMode(true)}
                  disabled={migrating}
                  className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-colors"
                >
                  Back to Preview
                </button>
                <button
                  onClick={handleRunMigration}
                  disabled={migrating}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white rounded-lg font-medium transition-colors"
                >
                  <Play size={18} />
                  Start Migration
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <div className="text-center mb-6">
            {result.success ? (
              <CheckCircle size={64} className="mx-auto mb-4 text-green-500" />
            ) : (
              <XCircle size={64} className="mx-auto mb-4 text-amber-500" />
            )}
            <h3 className="text-xl font-medium text-slate-800 dark:text-white">
              {result.success ? 'Migration Complete!' : 'Migration Completed with Issues'}
            </h3>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-lg text-center">
              <div className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                {result.workRecordsCreated}
              </div>
              <div className="text-sm text-indigo-600 dark:text-indigo-400">Work Records Created</div>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/30 p-4 rounded-lg text-center">
              <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                {result.workRecordsSkipped}
              </div>
              <div className="text-sm text-amber-600 dark:text-amber-400">Already Existed</div>
            </div>
            <div className="bg-green-50 dark:bg-green-900/30 p-4 rounded-lg text-center">
              <div className="text-3xl font-bold text-green-600 dark:text-green-400">
                {result.documentsCreated}
              </div>
              <div className="text-sm text-green-600 dark:text-green-400">Documents Created</div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
              <h4 className="font-medium text-red-800 dark:text-red-300 mb-2">
                Errors ({result.errors.length})
              </h4>
              <ul className="text-sm text-red-700 dark:text-red-400 space-y-1 max-h-40 overflow-y-auto">
                {result.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={() => {
              setResult(null);
              setPreviewMode(true);
            }}
            className="w-full py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-colors"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
};
