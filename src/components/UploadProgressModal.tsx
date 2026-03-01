/**
 * Upload Progress Modal Component
 *
 * Displays a blocking modal with progress bar during file uploads.
 * Prevents user interaction with the application while upload is in progress.
 */

import React, { useState } from 'react';
import { Upload, File, Loader2, CheckCircle, XCircle, FileText, AlertCircle } from 'lucide-react';

// ============================================
// Types
// ============================================

export interface UploadProgressModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Current upload progress (0-100) */
  progress: number;
  /** Name of the file being uploaded */
  fileName?: string;
  /** Optional status message to display */
  statusMessage?: string;
  /** Optional upload state for different visual states */
  state?: 'confirm' | 'uploading' | 'success' | 'error' | 'processing';
  /** Error message to display when state is 'error' */
  errorMessage?: string;
  /** Success details to display when state is 'success' */
  successDetails?: {
    documentType?: string;
    fileFormat?: string;
    fileName?: string;
  };
  /** Initial inferred details for confirmation */
  confirmDetails?: {
    documentType: 'invoice' | 'timesheet';
    fileFormat: string;
    fileName: string;
    targetDocumentId: string;
  };
  /** Available documents for the selected work record */
  availableDocuments?: Array<{
    id: string;
    type: 'invoice' | 'timesheet';
    displayName: string;
  }>;
  /** Called when user confirms the details */
  onConfirm?: (details: { documentType: 'invoice' | 'timesheet'; targetDocumentId: string }) => void;
  /** Called when user cancels */
  onCancel?: () => void;
}

// ============================================
// Component
// ============================================

export const UploadProgressModal: React.FC<UploadProgressModalProps> = ({
  isOpen,
  progress,
  fileName,
  statusMessage,
  state = 'uploading',
  errorMessage,
  successDetails,
  confirmDetails,
  availableDocuments = [],
  onConfirm,
  onCancel,
}) => {
  const [selectedDocId, setSelectedDocId] = useState<string>(confirmDetails?.targetDocumentId || '');

  // Update selectedDocId when confirmDetails changes
  React.useEffect(() => {
    if (confirmDetails?.targetDocumentId) {
      setSelectedDocId(confirmDetails.targetDocumentId);
    }
  }, [confirmDetails?.targetDocumentId]);

  if (!isOpen) return null;

  const getStatusIcon = () => {
    switch (state) {
      case 'confirm':
        return <AlertCircle className="w-12 h-12 text-amber-500" />;
      case 'success':
        return <CheckCircle className="w-12 h-12 text-emerald-500" />;
      case 'error':
        return <XCircle className="w-12 h-12 text-red-500" />;
      case 'processing':
        return <Loader2 className="w-12 h-12 text-amber-500 animate-spin" />;
      case 'uploading':
      default:
        return <Upload className="w-12 h-12 text-indigo-500" />;
    }
  };

  const getStatusText = () => {
    switch (state) {
      case 'confirm':
        return 'Confirm Upload Details';
      case 'success':
        return 'Upload Complete';
      case 'error':
        return 'Upload Failed';
      case 'processing':
        return 'Processing...';
      case 'uploading':
      default:
        return 'Uploading File...';
    }
  };

  const getProgressColor = () => {
    switch (state) {
      case 'confirm':
        return 'bg-amber-500';
      case 'success':
        return 'bg-emerald-500';
      case 'error':
        return 'bg-red-500';
      case 'processing':
        return 'bg-amber-500';
      case 'uploading':
      default:
        return 'bg-indigo-500';
    }
  };

  // Format file name for display (truncate if too long)
  const displayFileName = fileName
    ? fileName.length > 40
      ? `${fileName.slice(0, 20)}...${fileName.slice(-17)}`
      : fileName
    : null;

  const handleConfirm = () => {
    const selectedDoc = availableDocuments.find(d => d.id === selectedDocId);
    if (selectedDoc && onConfirm) {
      onConfirm({
        documentType: selectedDoc.type,
        targetDocumentId: selectedDoc.id,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop - blocks all interaction */}
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />

      {/* Modal Content */}
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header with icon */}
        <div className="flex flex-col items-center pt-8 pb-4 px-6">
          <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full mb-4">
            {getStatusIcon()}
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white text-center">
            {getStatusText()}
          </h3>
        </div>

        {/* Confirmation State */}
        {state === 'confirm' && confirmDetails && (
          <div className="px-6 pb-6">
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg space-y-4">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Please review the detected information before uploading:
              </p>

              {/* Document Type Selection */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Document Type
                </label>
                <select
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {availableDocuments.map((doc) => {
                    const typeLabel = doc.type.charAt(0).toUpperCase() + doc.type.slice(1);
                    return (
                      <option key={doc.id} value={doc.id}>
                        {typeLabel}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* File Format (Read-only) */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  File Format
                </label>
                <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-sm text-slate-600 dark:text-slate-400">
                  {confirmDetails.fileFormat}
                </div>
              </div>

              {/* Filename (Read-only) */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Filename
                </label>
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-sm text-slate-600 dark:text-slate-400 truncate">
                    {confirmDetails.fileName}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!selectedDocId}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white rounded-lg font-medium transition"
              >
                Start Upload
              </button>
            </div>
          </div>
        )}

        {/* File info - only show when not in confirm state */}
        {state !== 'confirm' && displayFileName && (
          <div className="px-6 pb-4">
            <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
              <File className="w-5 h-5 text-slate-400 flex-shrink-0" />
              <span className="text-sm text-slate-600 dark:text-slate-400 truncate">
                {displayFileName}
              </span>
            </div>
          </div>
        )}

        {/* Progress bar - only show when uploading/processing */}
        {(state === 'uploading' || state === 'processing') && (
          <div className="px-6 pb-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                {statusMessage || 'Uploading...'}
              </span>
              <span className="text-sm font-bold text-slate-900 dark:text-white">
                {Math.round(progress)}%
              </span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
              <div
                className={`${getProgressColor()} h-3 rounded-full transition-all duration-300 ease-out`}
                style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Error message */}
        {state === 'error' && errorMessage && (
          <div className="px-6 pb-6 pt-2">
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-700 dark:text-red-400">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Processing indicator */}
        {state === 'processing' && (
          <div className="px-6 pb-6 pt-2 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Please wait while we finalize the upload...
            </p>
          </div>
        )}

        {/* Success indicator */}
        {state === 'success' && (
          <div className="px-6 pb-6 pt-2">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg space-y-2">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Uploaded successfully!
              </p>
              {successDetails && (
                <div className="text-sm text-emerald-600 dark:text-emerald-400 space-y-1">
                  {successDetails.documentType && (
                    <p><span className="font-medium">Document Type:</span> {successDetails.documentType}</p>
                  )}
                  {successDetails.fileFormat && (
                    <p><span className="font-medium">File Format:</span> {successDetails.fileFormat}</p>
                  )}
                  {successDetails.fileName && (
                    <p className="truncate"><span className="font-medium">Filename:</span> {successDetails.fileName}</p>
                  )}
                </div>
              )}
              {!successDetails && (
                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                  Your file has been uploaded successfully!
                </p>
              )}
            </div>
          </div>
        )}

        {/* Bottom padding for uploading state */}
        {state === 'uploading' && <div className="pb-6" />}
      </div>
    </div>
  );
};

// ============================================
// Hook for easy usage
// ============================================

import { useCallback } from 'react';

export interface UseUploadProgressModalReturn {
  /** Whether the modal is currently open */
  isOpen: boolean;
  /** Current progress (0-100) */
  progress: number;
  /** Current upload state */
  state: 'confirm' | 'uploading' | 'success' | 'error' | 'processing';
  /** Open the modal in confirmation mode */
  openConfirm: (details: {
    fileName: string;
    documentType: 'invoice' | 'timesheet';
    fileFormat: string;
    targetDocumentId: string;
    availableDocuments: Array<{
      id: string;
      type: 'invoice' | 'timesheet';
      displayName: string;
    }>;
  }) => void;
  /** Open the modal and start upload tracking */
  openUpload: (fileName?: string) => void;
  /** Update progress */
  setProgress: (progress: number) => void;
  /** Set processing state (after upload, before completion) */
  setProcessing: (message?: string) => void;
  /** Mark upload as successful */
  setSuccess: (details?: { documentType?: string; fileFormat?: string; fileName?: string }) => void;
  /** Mark upload as failed */
  setError: (message?: string) => void;
  /** Close the modal */
  closeUpload: () => void;
  /** Status message to display */
  statusMessage: string;
  /** Error message */
  errorMessage: string;
  /** File name being uploaded */
  fileName: string;
  /** Success details to display */
  successDetails?: { documentType?: string; fileFormat?: string; fileName?: string };
  /** Confirmation details */
  confirmDetails?: {
    documentType: 'invoice' | 'timesheet';
    fileFormat: string;
    fileName: string;
    targetDocumentId: string;
    availableDocuments: Array<{
      id: string;
      type: 'invoice' | 'timesheet';
      displayName: string;
    }>;
  };
}

/**
 * Hook to manage upload progress modal state
 */
export function useUploadProgressModal(): UseUploadProgressModalReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [progress, setProgressState] = useState(0);
  const [state, setState] = useState<'confirm' | 'uploading' | 'success' | 'error' | 'processing'>('uploading');
  const [statusMessage, setStatusMessage] = useState('Uploading...');
  const [errorMessage, setErrorMessage] = useState('');
  const [fileName, setFileName] = useState('');
  const [successDetails, setSuccessDetails] = useState<{ documentType?: string; fileFormat?: string; fileName?: string } | undefined>(undefined);
  const [confirmDetails, setConfirmDetails] = useState<{
    documentType: 'invoice' | 'timesheet';
    fileFormat: string;
    fileName: string;
    targetDocumentId: string;
    availableDocuments: Array<{
      id: string;
      type: 'invoice' | 'timesheet';
      displayName: string;
    }>;
  } | undefined>(undefined);

  const openConfirm = useCallback((details: {
    fileName: string;
    documentType: 'invoice' | 'timesheet';
    fileFormat: string;
    targetDocumentId: string;
    availableDocuments: Array<{
      id: string;
      type: 'invoice' | 'timesheet';
      displayName: string;
    }>;
  }) => {
    setFileName(details.fileName);
    setConfirmDetails(details);
    setProgressState(0);
    setState('confirm');
    setStatusMessage('Waiting for confirmation...');
    setErrorMessage('');
    setSuccessDetails(undefined);
    setIsOpen(true);
  }, []);

  const openUpload = useCallback((name?: string) => {
    setFileName(name || '');
    setProgressState(0);
    setState('uploading');
    setStatusMessage('Uploading...');
    setErrorMessage('');
    setSuccessDetails(undefined);
    setConfirmDetails(undefined);
    setIsOpen(true);
  }, []);

  const setProgress = useCallback((value: number) => {
    setProgressState(value);
    if (value < 100) {
      setStatusMessage('Uploading...');
    }
  }, []);

  const setProcessing = useCallback((message?: string) => {
    setState('processing');
    setProgressState(100);
    setStatusMessage(message || 'Processing...');
  }, []);

  const setSuccess = useCallback((details?: { documentType?: string; fileFormat?: string; fileName?: string }) => {
    setState('success');
    setProgressState(100);
    setStatusMessage('Complete');
    setSuccessDetails(details);
  }, []);

  const setError = useCallback((message?: string) => {
    setState('error');
    setErrorMessage(message || 'Upload failed. Please try again.');
  }, []);

  const closeUpload = useCallback(() => {
    setIsOpen(false);
    // Reset after animation
    setTimeout(() => {
      setProgressState(0);
      setState('uploading');
      setStatusMessage('Uploading...');
      setErrorMessage('');
      setSuccessDetails(undefined);
      setConfirmDetails(undefined);
    }, 200);
  }, []);

  return {
    isOpen,
    progress,
    state,
    openConfirm,
    openUpload,
    setProgress,
    setProcessing,
    setSuccess,
    setError,
    closeUpload,
    statusMessage,
    errorMessage,
    fileName,
    successDetails,
    confirmDetails,
  };
}

export default UploadProgressModal;
