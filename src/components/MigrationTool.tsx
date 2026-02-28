/**
 * Migration Tool Component
 *
 * Provides a UI for running document status migrations with:
 * - Preview mode to see what changes would be made
 * - File existence verification in Firebase Storage
 * - Batch processing with progress tracking
 * - Detailed results reporting
 */

import React, { useState, useCallback } from 'react';
import {
  Database,
  FileCheck,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  Play,
  Eye,
  ChevronDown,
  ChevronUp,
  FileX,
  RefreshCw,
} from 'lucide-react';
import type { MigrationResult, StatusChange, DocumentFileStatus } from '../services/migrateDocumentStatusService';
import {
  previewStatusMigration,
  runStatusMigrationWithVerification,
} from '../services/migrateDocumentStatusService';

// ============================================
// Types
// ============================================

interface MigrationToolProps {
  onClose?: () => void;
}

type MigrationPhase = 'idle' | 'preview' | 'verifying' | 'migrating' | 'complete' | 'error';

// ============================================
// Helper Functions
// ============================================

function getStatusColor(status: string): string {
  switch (status) {
    case 'paid':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'sent':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'pdf-uploaded':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400';
    case 'excel-uploaded':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
    case 'generated':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400';
  }
}

// ============================================
// Components
// ============================================

export function MigrationTool({ onClose }: MigrationToolProps) {
  // State
  const [phase, setPhase] = useState<MigrationPhase>('idle');
  const [verifyFiles, setVerifyFiles] = useState(true);
  const [progress, setProgress] = useState<string>('');
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [error, setError] = useState<string>('');
  const [expandedChanges, setExpandedChanges] = useState<Set<string>>(new Set());

  // Toggle expanded change
  const toggleChange = useCallback((id: string) => {
    setExpandedChanges(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Run preview
  const handlePreview = useCallback(async () => {
    setPhase('preview');
    setProgress('Analyzing documents...');
    setError('');

    try {
      const previewResult = await previewStatusMigration();
      setResult(previewResult);
      setPhase('idle');
      setProgress('');
    } catch (err: any) {
      setError(err.message || 'Failed to run preview');
      setPhase('error');
      setProgress('');
    }
  }, []);

  // Run migration
  const handleMigrate = useCallback(async () => {
    setPhase(verifyFiles ? 'verifying' : 'migrating');
    setProgress(verifyFiles ? 'Starting file verification...' : 'Starting migration...');
    setError('');

    try {
      const migrationResult = await runStatusMigrationWithVerification(
        verifyFiles,
        (message) => setProgress(message)
      );
      setResult(migrationResult);
      setPhase('complete');
    } catch (err: any) {
      setError(err.message || 'Migration failed');
      setPhase('error');
    }
  }, [verifyFiles]);

  // Reset
  const handleReset = useCallback(() => {
    setPhase('idle');
    setProgress('');
    setResult(null);
    setError('');
    setExpandedChanges(new Set());
  }, []);

  // ============================================
  // Render
  // ============================================

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <Database className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Document Status Migration
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Update document statuses based on existing files
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <XCircle className="w-5 h-5 text-gray-500" />
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-red-900 dark:text-red-300">Error</h4>
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Configuration */}
      {phase === 'idle' && !result && (
        <div className="mb-6 space-y-4">
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={verifyFiles}
                onChange={(e) => setVerifyFiles(e.target.checked)}
                className="w-5 h-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <div>
                <span className="font-medium text-gray-900 dark:text-white">
                  Verify files in Firebase Storage
                </span>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Check if referenced files actually exist before updating status
                </p>
              </div>
            </label>
          </div>

          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <h4 className="font-medium text-blue-900 dark:text-blue-300 mb-2">
              Status Hierarchy
            </h4>
            <p className="text-sm text-blue-700 dark:text-blue-400">
              paid {'>'} sent {'>'} pdf-uploaded {'>'} excel-uploaded {'>'} generated
            </p>
          </div>
        </div>
      )}

      {/* Progress */}
      {(phase === 'preview' || phase === 'verifying' || phase === 'migrating') && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
            <span className="text-blue-900 dark:text-blue-300">{progress}</span>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {result.totalDocuments}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Total
              </div>
            </div>
            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
              <div className="text-2xl font-bold text-green-700 dark:text-green-400">
                {result.updatedCount}
              </div>
              <div className="text-xs text-green-600 dark:text-green-500 uppercase tracking-wide">
                Updated
              </div>
            </div>
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center">
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                {result.skippedCount}
              </div>
              <div className="text-xs text-blue-600 dark:text-blue-500 uppercase tracking-wide">
                Skipped
              </div>
            </div>
            {result.failedCount > 0 && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg text-center">
                <div className="text-2xl font-bold text-red-700 dark:text-red-400">
                  {result.failedCount}
                </div>
                <div className="text-xs text-red-600 dark:text-red-500 uppercase tracking-wide">
                  Failed
                </div>
              </div>
            )}
          </div>

          {/* File Verification Summary */}
          {result.fileVerification && (
            <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg">
              <h4 className="font-medium text-indigo-900 dark:text-indigo-300 mb-3 flex items-center gap-2">
                <FileCheck className="w-5 h-5" />
                File Verification Results
              </h4>
              <div className="grid grid-cols-3 gap-4 mb-3">
                <div className="text-center">
                  <div className="text-xl font-semibold text-indigo-700 dark:text-indigo-400">
                    {result.fileVerification.checked}
                  </div>
                  <div className="text-xs text-indigo-600 dark:text-indigo-500">Documents</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-semibold text-green-700 dark:text-green-400">
                    {result.fileVerification.exists}
                  </div>
                  <div className="text-xs text-green-600 dark:text-green-500">Files Exist</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-semibold text-red-700 dark:text-red-400">
                    {result.fileVerification.missing}
                  </div>
                  <div className="text-xs text-red-600 dark:text-red-500">Files Missing</div>
                </div>
              </div>
              {result.fileVerification.missingFiles.length > 0 && (
                <div className="mt-3 pt-3 border-t border-indigo-200 dark:border-indigo-800">
                  <p className="text-sm font-medium text-indigo-900 dark:text-indigo-300 mb-2">
                    Missing files ({result.fileVerification.missingFiles.length}):
                  </p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {result.fileVerification.missingFiles.map((mf, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-sm text-indigo-700 dark:text-indigo-400"
                      >
                        <FileX className="w-4 h-4" />
                        <span className="truncate">{mf.fileName}</span>
                        <span className="text-xs text-indigo-500">({mf.docId.slice(0, 8)}...)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Changes List */}
          {result.changes.length > 0 && (
            <div>
              <h4 className="font-medium text-gray-900 dark:text-white mb-3">
                Changes ({result.changes.length})
              </h4>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {result.changes.map((change) => (
                    <div key={change.id}>
                      <ChangeItem
                        change={change}
                        isExpanded={expandedChanges.has(change.id)}
                        onToggle={() => toggleChange(change.id)}
                      />
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* No Changes */}
          {result.changes.length === 0 && result.skippedCount > 0 && (
            <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              <span className="text-green-900 dark:text-green-300">
                All documents have correct status. No changes needed.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-6 flex flex-wrap gap-3">
        {phase === 'idle' && !result && (
          <>
            <button
              onClick={handlePreview}
              disabled={phase !== 'idle'}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Eye className="w-4 h-4" />
              Preview Changes
            </button>
            <button
              onClick={handleMigrate}
              disabled={phase !== 'idle'}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Play className="w-4 h-4" />
              Run Migration
            </button>
          </>
        )}

        {(phase === 'complete' || phase === 'error') && (
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Run Again
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================
// Change Item Component
// ============================================

interface ChangeItemProps {
  change: StatusChange & { fileStatus?: DocumentFileStatus };
  isExpanded: boolean;
  onToggle: () => void;
}

function ChangeItem({ change, isExpanded, onToggle }: ChangeItemProps) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(change.oldStatus)}`}>
              {change.oldStatus}
            </span>
            <span className="text-gray-400">→</span>
            <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(change.newStatus)}`}>
              {change.newStatus}
            </span>
          </div>
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {change.documentNumber || change.id.slice(0, 8)}
          </span>
          {change.clientName && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              ({change.clientName})
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-0 bg-gray-50 dark:bg-gray-700/30 border-t border-gray-200 dark:border-gray-700">
          <div className="pt-3 space-y-2">
            <div className="text-sm">
              <span className="text-gray-500 dark:text-gray-400">Reason: </span>
              <span className="text-gray-700 dark:text-gray-300">{change.reason}</span>
            </div>
            {change.files && change.files.length > 0 && (
              <div className="text-sm">
                <span className="text-gray-500 dark:text-gray-400">Files: </span>
                <span className="text-gray-700 dark:text-gray-300">{change.files.join(', ')}</span>
              </div>
            )}
            {change.fileStatus && (
              <div className="mt-2 space-y-1">
                <span className="text-sm text-gray-500 dark:text-gray-400">File Status:</span>
                {change.fileStatus.files.map((file, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 text-sm pl-2"
                  >
                    {file.exists ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className={file.exists ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                      {file.fileName}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default MigrationTool;
