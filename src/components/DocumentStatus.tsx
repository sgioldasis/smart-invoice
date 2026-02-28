/**
 * Document Status Component
 *
 * Provides status display, timeline, and action buttons for documents.
 * Can be used in DocumentManager, WorkRecordList, and other components.
 */

import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Upload,
  Send,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  RefreshCw,
  X,
  Loader2,
} from 'lucide-react';
import type { Document, DocumentStatus as TDocumentStatus } from '../types';
import {
  STATUS_METADATA,
  formatStatusDate,
  formatStatusDateCompact,
  hasFinalVersion,
  canMarkAsFinal,
  canMarkAsSent,
  canMarkAsPaid,
  getEffectiveDownloadUrl,
  getEffectiveFileName,
  getFinalDocuments,
} from '../utils/documentStatus';

// ============================================
// Types
// ============================================

interface DocumentStatusProps {
  document: Document;
  clientName?: string;
  onUploadFinal?: (file: File) => void;
  onMarkSent?: () => void;
  onMarkPaid?: () => void;
  onDownload?: () => void;
  isUploading?: boolean;
  compact?: boolean;
}

interface StatusBadgeProps {
  status: TDocumentStatus;
  size?: 'sm' | 'md' | 'lg';
  timestamp?: string;
}

interface StatusTimelineProps {
  document: Document;
}

interface StatusActionsProps {
  document: Document;
  clientName?: string;
  onUploadFinal?: (file: File) => void;
  onMarkSent?: () => void;
  onMarkPaid?: () => void;
  isUploading?: boolean;
}

// ============================================
// Status Badge Component
// ============================================

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md', timestamp }) => {
  const meta = STATUS_METADATA[status];

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base',
  };

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 16,
  };

  const getIcon = () => {
    const props = { size: iconSizes[size] };
    switch (status) {
      case 'generated':
        return <FileSpreadsheet {...props} />;
      case 'final':
        return <Upload {...props} />;
      case 'sent':
        return <Send {...props} />;
      case 'paid':
        return <CheckCircle {...props} />;
      default:
        return <Clock {...props} />;
    }
  };

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full font-medium
        border ${meta.bgColor} ${meta.textColor} ${meta.borderColor}
        ${sizeClasses[size]}
        transition-all duration-200
      `}
      title={meta.description}
    >
      {getIcon()}
      <span className="flex items-center gap-1.5">
        {meta.label}
        {timestamp && (
          <span className="opacity-75">
            • {formatStatusDateCompact(timestamp)}
          </span>
        )}
      </span>
    </span>
  );
};

// ============================================
// Status Timeline Component
// ============================================

export const StatusTimeline: React.FC<StatusTimelineProps> = ({ document }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const statuses: { status: TDocumentStatus; date?: string; label: string }[] = [
    { status: 'generated', date: document.generatedAt, label: 'Generated' },
    { status: 'excel-uploaded', date: document.finalizedAt, label: 'Excel Uploaded' },
    { status: 'pdf-uploaded', date: document.finalizedAt, label: 'PDF Uploaded' },
    { status: 'sent', date: document.sentAt, label: 'Sent' },
    { status: 'paid', date: document.paidAt, label: 'Paid' },
  ];

  // Filter out future statuses (those that haven't happened yet)
  const reachedIndex = statuses.findIndex((s) => !s.date);
  const activeIndex = reachedIndex === -1 ? statuses.length - 1 : reachedIndex - 1;

  return (
    <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          Status Timeline
        </h4>
        {isExpanded ? (
          <ChevronUp size={16} className="text-slate-400" />
        ) : (
          <ChevronDown size={16} className="text-slate-400" />
        )}
      </button>

      <div className="mt-3 space-y-3">
        {statuses.map((item, index) => {
          const meta = STATUS_METADATA[item.status];
          const isActive = index === activeIndex;
          const isCompleted = index < activeIndex || (index === activeIndex && item.date);
          const isPending = index > activeIndex;

          // Skip 'paid' for timesheets
          if (document.type === 'timesheet' && item.status === 'paid') {
            return null;
          }

          return (
            <div
              key={item.status}
              className={`
                flex items-center gap-3 p-2 rounded-lg transition-colors
                ${isActive ? 'bg-white dark:bg-slate-800 shadow-sm' : ''}
                ${isPending ? 'opacity-50' : ''}
              `}
            >
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center
                  ${isCompleted ? meta.bgColor : 'bg-slate-200 dark:bg-slate-700'}
                `}
              >
                {item.status === 'generated' && (
                  <FileSpreadsheet
                    size={16}
                    className={isCompleted ? meta.textColor : 'text-slate-400'}
                  />
                )}
                {(item.status === 'excel-uploaded' || item.status === 'pdf-uploaded') && (
                  <Upload
                    size={16}
                    className={isCompleted ? meta.textColor : 'text-slate-400'}
                  />
                )}
                {item.status === 'sent' && (
                  <Send
                    size={16}
                    className={isCompleted ? meta.textColor : 'text-slate-400'}
                  />
                )}
                {item.status === 'paid' && (
                  <CheckCircle
                    size={16}
                    className={isCompleted ? meta.textColor : 'text-slate-400'}
                  />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p
                  className={`
                    text-sm font-medium
                    ${isCompleted ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}
                  `}
                >
                  {meta.label}
                </p>
                {item.date && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatStatusDate(item.date)}
                  </p>
                )}
              </div>

              {isActive && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
                  Current
                </span>
              )}
            </div>
          );
        })}
      </div>

      {isExpanded && document.statusHistory && document.statusHistory.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
          <h5 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
            History
          </h5>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {document.statusHistory.map((entry, index) => (
              <div
                key={index}
                className="flex items-start gap-2 text-xs p-2 rounded bg-white dark:bg-slate-800"
              >
                <span
                  className={`px-1.5 py-0.5 rounded font-medium ${
                    STATUS_METADATA[entry.status].bgColor
                  } ${STATUS_METADATA[entry.status].textColor}`}
                >
                  {STATUS_METADATA[entry.status].label}
                </span>
                <div className="flex-1">
                  <p className="text-slate-600 dark:text-slate-300">
                    {formatStatusDate(entry.timestamp)}
                  </p>
                  {entry.note && (
                    <p className="text-slate-500 dark:text-slate-400 italic mt-0.5">
                      {entry.note}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================
// Status Actions Component
// ============================================

export const StatusActions: React.FC<StatusActionsProps> = ({
  document,
  clientName,
  onUploadFinal,
  onMarkSent,
  onMarkPaid,
  isUploading,
}) => {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = () => {
    if (selectedFile && onUploadFinal) {
      onUploadFinal(selectedFile);
      setShowUploadModal(false);
      setSelectedFile(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {/* Upload Final / Re-upload Final */}
      {(document.status === 'generated' ||
        document.status === 'excel-uploaded' ||
        document.status === 'pdf-uploaded' ||
        document.status === 'sent') && (
        <>
          <button
            onClick={() => setShowUploadModal(true)}
            disabled={isUploading}
            className="
              flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
              bg-purple-100 text-purple-700 hover:bg-purple-200
              dark:bg-purple-900/30 dark:text-purple-400 dark:hover:bg-purple-900/50
              transition-colors disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {isUploading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : document.status === 'generated' ? (
              <Upload size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
            {document.status === 'generated' ? 'Upload Final' : 'Re-upload Final'}
          </button>

          {/* Upload Modal */}
          {showUploadModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                    <Upload size={20} className="text-purple-500" />
                    Upload Final Version
                  </h3>
                  <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setSelectedFile(null);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Upload the final edited version of this document (PDF or Excel).
                    This will replace the generated version.
                  </p>

                  <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-6 text-center">
                    <input
                      type="file"
                      accept=".pdf,.xlsx,.xls"
                      onChange={handleFileSelect}
                      className="hidden"
                      id="final-file-input"
                    />
                    <label
                      htmlFor="final-file-input"
                      className="cursor-pointer flex flex-col items-center gap-2"
                    >
                      <Upload size={32} className="text-slate-400" />
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        {selectedFile ? selectedFile.name : 'Click to select file'}
                      </span>
                      <span className="text-xs text-slate-500">
                        PDF or Excel files accepted
                      </span>
                    </label>
                  </div>
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setSelectedFile(null);
                    }}
                    className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpload}
                    disabled={!selectedFile}
                    className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Upload
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Mark as Sent */}
      {canMarkAsSent(document) && onMarkSent && (
        <button
          onClick={onMarkSent}
          className="
            flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
            bg-green-100 text-green-700 hover:bg-green-200
            dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50
            transition-colors
          "
        >
          <Send size={16} />
          Mark as Sent
        </button>
      )}

      {/* Mark as Paid (invoices only) */}
      {canMarkAsPaid(document) && onMarkPaid && (
        <button
          onClick={onMarkPaid}
          className="
            flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
            bg-emerald-100 text-emerald-700 hover:bg-emerald-200
            dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50
            transition-colors
          "
        >
          <CheckCircle size={16} />
          Mark as Paid
        </button>
      )}

      {/* Download buttons for all final documents */}
      {hasFinalVersion(document) && (
        <>
          {getFinalDocuments(document).map((finalDoc) => (
            <a
              key={finalDoc.fileName}
              href={finalDoc.downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="
                flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                bg-sky-100 text-sky-700 hover:bg-sky-200
                dark:bg-sky-900/30 dark:text-sky-400 dark:hover:bg-sky-900/50
                transition-colors
              "
            >
              <FileSpreadsheet size={16} />
              Download {finalDoc.fileExtension.toUpperCase()}
            </a>
          ))}
        </>
      )}

      <a
        href={document.downloadUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="
          flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
          bg-slate-100 text-slate-700 hover:bg-slate-200
          dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700
          transition-colors
        "
      >
        <FileSpreadsheet size={16} />
        Download Original
      </a>
    </div>
  );
};

// ============================================
// Main Document Status Component
// ============================================

export const DocumentStatusPanel: React.FC<DocumentStatusProps> = ({
  document,
  clientName,
  onUploadFinal,
  onMarkSent,
  onMarkPaid,
  isUploading,
  compact = false,
}) => {
  if (compact) {
    const finalDocs = getFinalDocuments(document);
    return (
      <div className="flex items-center gap-3">
        <StatusBadge status={document.status} size="sm" />
        {finalDocs.length > 0 && (
          <div className="flex gap-2">
            {finalDocs.map((finalDoc) => (
              <a
                key={finalDoc.fileName}
                href={finalDoc.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-600 hover:text-sky-700 dark:text-sky-400 text-sm"
              >
                {finalDoc.fileExtension.toUpperCase()}
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current Status */}
      <div className="flex items-center gap-3">
        <StatusBadge status={document.status} size="md" />
        {document.isOutdated && (
          <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2 py-1 rounded-full">
            <AlertCircle size={12} />
            Outdated
          </span>
        )}
      </div>

      {/* Effective File Info */}
      <div className="text-sm text-slate-600 dark:text-slate-400">
        {getFinalDocuments(document).length > 0 ? (
          <>
            <p className="font-medium text-slate-900 dark:text-white">
              Final Versions:
            </p>
            <ul className="text-xs mt-1 space-y-1">
              {getFinalDocuments(document).map((finalDoc) => (
                <li key={finalDoc.fileName}>
                  • {finalDoc.fileName}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="font-medium text-slate-900 dark:text-white">
            {getEffectiveFileName(document) || 'Unnamed document'}
          </p>
        )}
      </div>

      {/* Status Timeline */}
      <StatusTimeline document={document} />

      {/* Action Buttons */}
      {(onUploadFinal || onMarkSent || onMarkPaid) && (
        <StatusActions
          document={document}
          clientName={clientName}
          onUploadFinal={onUploadFinal}
          onMarkSent={onMarkSent}
          onMarkPaid={onMarkPaid}
          isUploading={isUploading}
        />
      )}
    </div>
  );
};

export default DocumentStatusPanel;
