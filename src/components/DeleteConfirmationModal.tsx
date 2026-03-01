/**
 * Delete Confirmation Modal Component
 *
 * A customizable modal for confirming delete operations with document listings.
 * Wider than native confirm() to accommodate long filenames.
 */

import React from 'react';
import { AlertTriangle, X, FileText, Loader2 } from 'lucide-react';

export interface DeleteDocument {
  type: 'Invoice' | 'Timesheet' | 'Document';
  files: string[];
}

export interface DeleteConfirmationModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Title to display */
  title?: string;
  /** Main message */
  message?: string;
  /** List of documents with their files */
  documents?: DeleteDocument[];
  /** Text for the confirm button */
  confirmText?: string;
  /** Text for the cancel button */
  cancelText?: string;
  /** Whether deletion is in progress */
  isLoading?: boolean;
  /** Loading message to display */
  loadingMessage?: string;
  /** Called when user confirms */
  onConfirm: () => void;
  /** Called when user cancels or closes */
  onCancel: () => void;
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  isOpen,
  title = 'Confirm Deletion',
  message = 'Are you sure you want to delete this item?',
  documents = [],
  confirmText = 'Delete',
  cancelText = 'Cancel',
  isLoading = false,
  loadingMessage = 'Deleting...',
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  // Format filename for display (truncate middle if too long)
  const formatFileName = (name: string): string => {
    if (name.length <= 60) return name;
    const start = name.slice(0, 30);
    const end = name.slice(-25);
    return `${start}...${end}`;
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={isLoading ? undefined : onCancel}
      />

      {/* Modal Content - wider max-width */}
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b border-slate-200 dark:border-slate-700">
          <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
            <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">
            {title}
          </h3>
          {!isLoading && (
            <button
              onClick={onCancel}
              className="ml-auto p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="w-10 h-10 text-red-600 dark:text-red-400 animate-spin mb-4" />
              <p className="text-slate-600 dark:text-slate-400 text-center">
                {loadingMessage}
              </p>
            </div>
          ) : (
            <>
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                {message}
              </p>

              {/* Documents List */}
              {documents.length > 0 && (
                <div className="space-y-4">
                  {documents.map((doc, docIndex) => (
                    <div
                      key={docIndex}
                      className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4"
                    >
                      <h4 className="font-semibold text-slate-900 dark:text-white mb-2">
                        {doc.type} documents:
                      </h4>
                      <ul className="space-y-2">
                        {doc.files.map((file, fileIndex) => (
                          <li
                            key={fileIndex}
                            className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400"
                          >
                            <FileText className="w-4 h-4 mt-0.5 flex-shrink-0 text-slate-400" />
                            <span
                              className="break-all font-mono"
                              title={file}
                            >
                              {formatFileName(file)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Deleting...
              </span>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmationModal;
