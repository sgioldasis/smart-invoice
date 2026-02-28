/**
 * DocumentManager Component
 *
 * Firestore Data Browser - View and manage all Firestore collections
 * Collections: clients, workRecords, documents, invoices (legacy), timesheets
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Database,
  Trash2,
  Loader2,
  Search,
  ChevronDown,
  ChevronUp,
  FileText,
  Users,
  Briefcase,
  FileSpreadsheet,
  Calendar,
  X,
  Eye,
  AlertTriangle,
  RefreshCw,
  LayoutTemplate,
  AlertCircle,
  Download,
  File,
  Upload,
  FolderSync,
  CheckCircle,
  XCircle,
  Copy,
} from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import {
  getCollectionData,
  deleteDocumentById,
  getTemplates,
  type CollectionType,
  type FirestoreDocument,
} from '../services/db';
import {
  downloadDocument as downloadFromStorage,
  uploadDocument,
  downloadTemplate as downloadTemplateFromStorage,
  sanitizeUserEmail,
  sanitizeClientName,
  listStorageFiles,
  getFinalDocumentDownloadUrl,
  deleteFinalDocument,
} from '../services/storage';
import { saveDocument } from '../services/db';
import type { Template } from '../types';
import {
  migrateDocuments,
  previewMigration,
  getMigrationStats,
  type MigrationProgress,
  type MigrationResult,
} from '../services/migrateDocuments';
import {
  previewDuplicates,
  runDeduplication,
  type DeduplicationResult,
  type DuplicateGroup,
} from '../services/deduplicateService';
import {
  previewStatusMigration,
  runStatusMigration,
  type MigrationResult as StatusMigrationResult,
  type StatusChange,
} from '../services/migrateDocumentStatusService';

interface DocumentManagerProps {
  userEmail: string;
}

const COLLECTIONS: { id: CollectionType | 'templates'; name: string; icon: React.ElementType; description: string }[] = [
  { id: 'clients', name: 'Clients', icon: Users, description: 'Client configurations and templates' },
  { id: 'workRecords', name: 'Work Records', icon: Briefcase, description: 'Monthly work day records' },
  { id: 'documents', name: 'Documents', icon: FileText, description: 'Generated invoices and timesheets' },
  { id: 'timesheets', name: 'Timesheet Configs', icon: Calendar, description: 'Timesheet templates and prompts' },
  { id: 'templates', name: 'Templates', icon: LayoutTemplate, description: 'Invoice & timesheet templates' },
];

interface TemplateDoc {
  id: string;
  clientId: string;
  clientName: string;
  type: 'invoice' | 'timesheet';
  name: string;
  fileName: string;
  hasTemplate: boolean;
  size?: string;
  storagePath?: string;
  downloadUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================
// Excel Preview Modal Component
// ============================================

interface ExcelPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: any[][];
  fileName: string;
  merges?: XLSX.Range[];
  cols?: XLSX.ColInfo[];
}

const ExcelPreviewModal: React.FC<ExcelPreviewModalProps> = ({
  isOpen,
  onClose,
  data,
  fileName,
  merges = [],
  cols = []
}) => {
  if (!isOpen) return null;

  // Helper to check if a cell is the start of a merge
  const getMergeInfo = (r: number, c: number) => {
    return merges.find(m => m.s.r === r && m.s.c === c);
  };

  // Helper to check if a cell is covered by a merge (but not the start)
  const isCellCovered = (r: number, c: number) => {
    return merges.some(m =>
      r >= m.s.r && r <= m.e.r &&
      c >= m.s.c && c <= m.e.c &&
      !(r === m.s.r && c === m.s.c)
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-lg">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                Preview Document
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-mono">
                {fileName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors text-slate-500 dark:text-slate-400"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 bg-slate-50 dark:bg-slate-950">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="bg-white dark:bg-slate-900 border-collapse table-fixed">
                <colgroup>
                  {cols.map((col, i) => (
                    <col key={i} style={{ width: col.wpx ? `${col.wpx}px` : '120px' }} />
                  ))}
                  {/* Fallback columns if data is wider than cols info */}
                  {data[0]?.length > cols.length &&
                    Array.from({ length: data[0].length - cols.length }).map((_, i) => (
                      <col key={i + cols.length} style={{ width: '120px' }} />
                    ))
                  }
                </colgroup>
                <tbody>
                  {data.map((row, rowIndex) => (
                    <tr key={rowIndex} className="h-8 border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                      {row.map((cell, cellIndex) => {
                        // Skip if this cell is part of a merge but not the start
                        if (isCellCovered(rowIndex, cellIndex)) return null;

                        const merge = getMergeInfo(rowIndex, cellIndex);
                        const rowSpan = merge ? (merge.e.r - merge.s.r + 1) : 1;
                        const colSpan = merge ? (merge.e.c - merge.s.c + 1) : 1;

                        return (
                          <td
                            key={cellIndex}
                            rowSpan={rowSpan}
                            colSpan={colSpan}
                            className={`
                              px-3 py-1 text-slate-700 dark:text-slate-300 border-r border-slate-100 dark:border-slate-800 last:border-0 truncate
                              ${rowIndex === 0 ? 'font-semibold bg-slate-50/50 dark:bg-slate-800/30' : ''}
                              ${cell === null || cell === undefined || cell === '' ? 'bg-slate-50/30 dark:bg-slate-800/10' : ''}
                            `}
                            title={String(cell || '')}
                          >
                            {cell !== null && cell !== undefined ? String(cell) : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.length === 0 && (
              <div className="py-12 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400">
                <FileSpreadsheet size={48} className="mb-4 opacity-20" />
                <p>No data found in this spreadsheet</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 bg-white dark:bg-slate-950">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
};

export const DocumentManager: React.FC<DocumentManagerProps> = ({ userEmail }) => {
  // ============================================
  // State
  // ============================================
  const [selectedCollection, setSelectedCollection] = useState<CollectionType | 'templates'>('documents');
  const [documents, setDocuments] = useState<FirestoreDocument[]>([]);
  const [templates, setTemplates] = useState<TemplateDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Detail view
  const [selectedDoc, setSelectedDoc] = useState<FirestoreDocument | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDoc | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  // Expand/collapse JSON view
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());

  // Excel Preview state
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any[][]>([]);
  const [previewMerges, setPreviewMerges] = useState<XLSX.Range[]>([]);
  const [previewCols, setPreviewCols] = useState<XLSX.ColInfo[]>([]);
  const [previewFileName, setPreviewFileName] = useState('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Client name cache for displaying client names instead of IDs
  const [clientNames, setClientNames] = useState<Map<string, string>>(new Map());

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadClient, setUploadClient] = useState('');
  const [uploadMonth, setUploadMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [uploadType, setUploadType] = useState<'invoice' | 'timesheet'>('invoice');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Clients list for upload modal
  const [uploadClientsList, setUploadClientsList] = useState<{ id: string, name: string }[]>([]);

  // Storage files per document folder (to show ALL files, not just the one in Firestore)
  const [storageFilesMap, setStorageFilesMap] = useState<Map<string, { name: string; fullPath: string; downloadUrl?: string }[]>>(new Map());
  const [loadingStorageFiles, setLoadingStorageFiles] = useState<Set<string>>(new Set());

  // Migration state
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);
  const [migrationStats, setMigrationStats] = useState<{
    total: number;
    migrated: number;
    needsMigration: number;
    withBase64Data: number;
    withOldPath: number;
  } | null>(null);

  // Deduplication state
  const [showDeduplicateModal, setShowDeduplicateModal] = useState(false);
  const [isDeduplicating, setIsDeduplicating] = useState(false);
  const [deduplicatePreview, setDeduplicatePreview] = useState<DeduplicationResult | null>(null);
  const [deduplicateResult, setDeduplicateResult] = useState<DeduplicationResult | null>(null);
  const [deduplicateLogs, setDeduplicateLogs] = useState<string[]>([]);

  // Status Migration state
  const [showStatusMigrationModal, setShowStatusMigrationModal] = useState(false);
  const [isMigratingStatus, setIsMigratingStatus] = useState(false);
  const [statusMigrationPreview, setStatusMigrationPreview] = useState<StatusMigrationResult | null>(null);
  const [statusMigrationResult, setStatusMigrationResult] = useState<StatusMigrationResult | null>(null);
  const [statusMigrationLogs, setStatusMigrationLogs] = useState<string[]>([]);

  // ============================================
  // Data Loading
  // ============================================

  const loadCollection = async (collectionName: CollectionType | 'templates') => {
    try {
      setLoading(true);
      setError(null);

      if (collectionName === 'templates') {
        // Fetch templates from the templates collection
        const templatesData = await getTemplates(userEmail);
        const clientsData = await getCollectionData('clients', userEmail);
        const clientMap = new Map(clientsData.map(c => [c.id, String(c.data.name || 'Unknown')]));

        const extractedTemplates: TemplateDoc[] = templatesData.map((template: Template) => {
          return {
            id: template.id,
            clientId: template.clientId,
            clientName: clientMap.get(template.clientId) || 'Unknown',
            type: template.type,
            name: template.name,
            fileName: template.fileName,
            hasTemplate: !!template.storagePath,
            size: 'Storage',
            storagePath: template.storagePath,
            downloadUrl: template.downloadUrl,
            createdAt: template.createdAt,
            updatedAt: template.updatedAt,
          };
        });

        setTemplates(extractedTemplates);
        setDocuments([]);
      } else {
        const data = await getCollectionData(collectionName, userEmail);
        setDocuments(data);
        setTemplates([]);

        // Load client names for documents that have clientId
        const clientIds = new Set<string>();
        data.forEach((doc) => {
          if (doc.data.clientId) {
            clientIds.add(String(doc.data.clientId));
          }
        });

        if (clientIds.size > 0) {
          const { getClients } = await import('../services/db');
          const clients = await getClients(userEmail);
          const nameMap = new Map<string, string>();
          clients.forEach((client) => {
            nameMap.set(client.id, client.name);
          });
          setClientNames(nameMap);
        }
      }
    } catch (err) {
      console.error(`Error loading ${collectionName}:`, err);
      setError(`Failed to load ${collectionName}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCollection(selectedCollection);
  }, [selectedCollection, userEmail]);

  // Load storage files for documents to show ALL files in each folder
  // Construct folder path from document metadata (client, month, type) to ensure consistency
  // Files are now organized in type-specific subfolders: {client}/{month}/{type}/
  const loadStorageFilesForDocs = async (docs: FirestoreDocument[]) => {
    const newStorageFilesMap = new Map<string, { name: string; fullPath: string; downloadUrl?: string }[]>();
    const loadingSet = new Set<string>();
    const { sanitizeUserEmail, sanitizeClientName } = await import('../services/storage');
    const sanitizedEmail = sanitizeUserEmail(userEmail);

    for (const doc of docs) {
      const data = doc.data;
      // Build folder path from document metadata to ensure we get the right folder
      // even if finalStoragePath points to a different file
      
      // Try to get clientName from document or lookup from clientId
      let clientName = data.clientName;
      if (!clientName && data.clientId) {
        clientName = clientNames.get(String(data.clientId));
      }
      
      // Try to get month from document
      let month = data.month;
      if (!month && data.documentNumber) {
        const match = String(data.documentNumber).match(/(\d{4})-(\d{2})/);
        if (match) month = `${match[1]}-${match[2]}`;
      }
      
      // Try to get type from document
      let docType = data.type;
      if (!docType) {
        const fileNameStr = String(data.fileName || '');
        if (data.documentNumber?.toString().startsWith('INV') ||
            fileNameStr.includes('Invoice')) {
          docType = 'invoice';
        } else if (data.documentNumber?.toString().startsWith('TMS') ||
                   fileNameStr.includes('Timesheet') ||
                   fileNameStr.includes('Time Sheet')) {
          docType = 'timesheet';
        }
      }
      
      if (clientName && month && docType) {
        const sanitizedClient = sanitizeClientName(String(clientName));
        const docTypeLower = String(docType).toLowerCase();
        
        // Path for documents (e.g., users/email/client/2026-03/invoice/)
        const docsPath = `users/${sanitizedEmail}/${sanitizedClient}/${month}/${docTypeLower}`;

        // Load documents folder (type-specific subfolder)
        if (!loadingSet.has(docsPath)) {
          loadingSet.add(docsPath);
          try {
            const files = await listStorageFiles(docsPath);
            // Get download URLs for each file
            const filesWithUrls = await Promise.all(
              files.map(async (file) => ({
                ...file,
                downloadUrl: await getFinalDocumentDownloadUrl(file.fullPath),
              }))
            );
            newStorageFilesMap.set(docsPath, filesWithUrls);
          } catch (err) {
            // Don't error if folder doesn't exist - it just means no files yet
            console.log(`No files found in ${docsPath} (folder may not exist yet)`);
            newStorageFilesMap.set(docsPath, []);
          }
        }
      }
    }

    setStorageFilesMap(newStorageFilesMap);
    setLoadingStorageFiles(new Set());
  };

  // Load storage files when documents change
  useEffect(() => {
    if (selectedCollection === 'documents' && documents.length > 0 && clientNames.size > 0) {
      loadStorageFilesForDocs(documents);
    }
  }, [documents, selectedCollection, clientNames]);

  // Load clients for the upload modal
  useEffect(() => {
    const loadClients = async () => {
      try {
        const { getClients } = await import('../services/db');
        const clientsData = await getClients(userEmail);
        setUploadClientsList(clientsData.map(c => ({ id: c.id, name: c.name })));
        if (clientsData.length > 0) {
          setUploadClient(clientsData[0].id);
        }
      } catch (err) {
        console.error('Error loading clients for upload:', err);
      }
    };
    if (showUploadModal && uploadClientsList.length === 0) {
      loadClients();
    }
  }, [showUploadModal, userEmail, uploadClientsList.length]);

  // Helper to estimate base64 size
  const estimateBase64Size = (base64: string): string => {
    const bytes = (base64.length * 3) / 4;
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  /**
   * Helper to rewrite legacy UID-based storage paths to email-based paths
   * Legacy: users/04eFF4c9fKQ7f4AicMFVgrVsgpT2/...
   * Modern: users/s_dot_gioldasis_at_gmail_dot_com/...
   */
  const getCorrectedPath = (storagePath: string): string => {
    if (!storagePath || typeof storagePath !== 'string') return storagePath;

    const parts = storagePath.split('/');
    if (parts.length >= 2 && parts[0] === 'users') {
      const sanitizedEmail = sanitizeUserEmail(userEmail);
      // If second part is NOT the sanitized email, it's likely a UID
      if (parts[1] !== sanitizedEmail) {
        console.log(`[PathCorrection] Rewriting ${parts[1]} to ${sanitizedEmail}`);
        return ['users', sanitizedEmail, ...parts.slice(2)].join('/');
      }
    }
    return storagePath;
  };

  // ============================================
  // Helpers
  // ============================================

  const handleDelete = async (docId: string) => {
    try {
      setDeletingId(docId);

      if (selectedCollection === 'templates') {
        // Import deleteTemplate function
        const { deleteTemplate } = await import('../services/db');
        await deleteTemplate(docId);
        setTemplates((prev) => prev.filter((t) => t.id !== docId));
        setShowDeleteConfirm(null);
        if (selectedTemplate?.id === docId) {
          setShowDetail(false);
          setSelectedTemplate(null);
        }
        return;
      }

      await deleteDocumentById(selectedCollection as CollectionType, docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      setShowDeleteConfirm(null);
      if (selectedDoc?.id === docId) {
        setShowDetail(false);
        setSelectedDoc(null);
      }
    } catch (err) {
      console.error('Error deleting document:', err);
      setError('Failed to delete document');
    } finally {
      setDeletingId(null);
    }
  };

  const viewTemplate = (template: TemplateDoc) => {
    setSelectedTemplate(template);
    setShowDetail(true);
  };

  const toggleExpanded = (docId: string) => {
    setExpandedDocs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(docId)) {
        newSet.delete(docId);
      } else {
        newSet.add(docId);
      }
      return newSet;
    });
  };

  const viewDocument = (doc: FirestoreDocument) => {
    setSelectedDoc(doc);
    setShowDetail(true);
  };

  const downloadDocument = async (doc: FirestoreDocument) => {
    const data = doc.data;
    
    // Use finalFileName if available (for uploaded final versions), otherwise fall back to fileName
    const fileName = String(data.finalFileName || data.fileName || `${data.documentNumber || doc.id}.xlsx`);

    // Priority 0: Download final version from Firebase Storage if available
    if (data.finalStoragePath && typeof data.finalStoragePath === 'string') {
      try {
        const correctedPath = getCorrectedPath(data.finalStoragePath);
        const blob = await downloadFromStorage(correctedPath);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return;
      } catch (error) {
        console.error('Error downloading final version from Storage:', error);
        // Fall through to other methods
      }
    }

    // Priority 1: Download from Firebase Storage using storagePath via SDK (Authenticated)
    if (data.storagePath && typeof data.storagePath === 'string') {
      try {
        const correctedPath = getCorrectedPath(data.storagePath);
        const blob = await downloadFromStorage(correctedPath);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return;
      } catch (error) {
        console.error('Error downloading from Storage:', error);
        // Fall through to other methods
      }
    }

    // Priority 2: Use final download URL if available (for uploaded final versions)
    if (data.finalDownloadUrl && typeof data.finalDownloadUrl === 'string') {
      const link = document.createElement('a');
      link.href = data.finalDownloadUrl;
      link.download = fileName;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // Priority 3: Use Firebase Storage download URL if available (Legacy/Public)
    if (data.downloadUrl && typeof data.downloadUrl === 'string') {
      const link = document.createElement('a');
      link.href = data.downloadUrl;
      link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // Priority 3: Check if document has base64 file data (legacy)
    if (data.fileData && typeof data.fileData === 'string') {
      // Create proper data URL if it's just base64
      const fileDataStr = data.fileData.startsWith('data:')
        ? data.fileData
        : `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${data.fileData}`;

      const link = document.createElement('a');
      link.href = fileDataStr;
      link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // Priority 4: Legacy support for excelBase64 field
    if (data.excelBase64 && typeof data.excelBase64 === 'string') {
      const excelData = data.excelBase64.startsWith('data:')
        ? data.excelBase64
        : `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${data.excelBase64}`;

      const link = document.createElement('a');
      link.href = excelData;
      link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      // No file data available - download as JSON
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${data.documentNumber || doc.id || 'document'}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  const handleExcelPreview = async (doc: FirestoreDocument) => {
    setIsPreviewLoading(true);
    setPreviewFileName(doc.data.fileName || 'document.xlsx');

    try {
      let arrayBuffer: ArrayBuffer;

      // 1. Get binary data
      console.log('[handleExcelPreview] Fetching data for:', doc.id, doc.data.fileName);

      // Priority 1: Use storagePath via Firebase SDK (Authenticated)
      if (typeof doc.data.storagePath === 'string') {
        const correctedPath = getCorrectedPath(doc.data.storagePath as string);
        console.log('[handleExcelPreview] Using Storage SDK:', correctedPath);
        const blob = await downloadFromStorage(correctedPath);
        arrayBuffer = await blob.arrayBuffer();
      }
      // Priority 2: Use downloadUrl via fetch (Legacy/External)
      else if (typeof doc.data.downloadUrl === 'string') {
        console.log('[handleExcelPreview] Using fetch:', doc.data.downloadUrl);
        const response = await fetch(doc.data.downloadUrl as string);
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[handleExcelPreview] Fetch failed:', response.status, errorText);
          throw new Error(`Access Denied: ${response.status} ${response.statusText}`);
        }
        arrayBuffer = await response.arrayBuffer();
      }
      // Priority 3: Handle base64 data
      else if (typeof doc.data.fileData === 'string' || typeof doc.data.excelBase64 === 'string') {
        console.log('[handleExcelPreview] Using base64 data');
        const fileContent = (doc.data.fileData as string) || (doc.data.excelBase64 as string);
        const base64 = fileContent.includes(',') ? fileContent.split(',')[1] : fileContent;
        const binaryString = window.atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        arrayBuffer = bytes.buffer;
      } else {
        throw new Error('No file data available for preview');
      }

      console.log('[handleExcelPreview] Data received, size:', arrayBuffer.byteLength);

      // Basic check: is it XML? (Commonly an error message from GCS)
      const firstBytes = new Uint8Array(arrayBuffer.slice(0, 100));
      const firstChars = String.fromCharCode(...firstBytes);
      console.log('[handleExcelPreview] First chars:', firstChars.slice(0, 50));

      if (firstChars.trim().startsWith('<Error>') || firstChars.trim().startsWith('<?xml')) {
        if (!firstChars.includes('workbook') && !firstChars.includes('worksheet')) {
          // If it starts with < but doesn't look like Excel XML, it's probably a GCS error
          console.error('[handleExcelPreview] Received XML error message instead of Excel file');
          throw new Error('Received an error message from the storage server instead of the Excel file. Access may be denied.');
        }
      }

      // 2. Parse with SheetJS
      const workbook = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      console.log('[handleExcelPreview] Sheet parsed:', firstSheetName);
      console.log('[handleExcelPreview] Merges:', worksheet['!merges']?.length || 0);

      // 3. Convert to JSON (array of arrays, preserving empty cells for alignment)
      const jsonData = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '', // Use empty string for empty cells
        blankrows: true
      }) as any[][];

      setPreviewData(jsonData);
      setPreviewMerges(worksheet['!merges'] || []);
      setPreviewCols(worksheet['!cols'] || []);
      setIsPreviewModalOpen(true);
    } catch (error) {
      console.error('Error previewing Excel:', error);
      alert('Failed to preview Excel file. You might need to download it instead.');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // ============================================
  // Render Helpers (defined before use)
  // ============================================

  const getDocumentTitle = (doc: FirestoreDocument): string => {
    const data = doc.data;
    const clientName = data.clientId ? clientNames.get(String(data.clientId)) : null;
    const clientPart = clientName ? `${clientName}` : (data.clientId ? String(data.clientId).slice(0, 8) : null);

    // Build title: [YYYY-MM Client Name] or [YYYY-MM] or [Client Name]
    const prefixParts: string[] = [];
    if (data.month) prefixParts.push(String(data.month));
    if (clientPart) prefixParts.push(clientPart);
    
    // Return just the prefix (month and client name)
    if (prefixParts.length > 0) {
      return prefixParts.join(' ');
    }

    // Fallback if no month/client available
    switch (selectedCollection) {
      case 'documents': {
        const type = data.type === 'invoice' ? 'Invoice' : data.type === 'timesheet' ? 'Timesheet' : 'Document';
        if (data.documentNumber) {
          return `${type} #${data.documentNumber}`;
        }
        return String(data.name || doc.id.slice(0, 8) + '...');
      }

      case 'workRecords': {
        // For work records - show month and client only
        const wrParts: string[] = [];
        if (data.month) wrParts.push(String(data.month));
        if (clientPart) wrParts.push(clientPart);
        return wrParts.length > 0 ? wrParts.join(' ') : 'Work Record';
      }

      case 'clients': {
        // For clients (just name)
        return String(data.name || 'Unnamed Client');
      }

      case 'timesheets': {
        // For timesheet configs - show month and client only
        const tsParts: string[] = [];
        if (data.month) tsParts.push(String(data.month));
        if (clientPart) tsParts.push(clientPart);
        return tsParts.length > 0 ? tsParts.join(' ') : 'Timesheet Config';
      }

      default:
        // Fallback - show month and client only
        if (data.month && clientPart) return `${data.month} ${clientPart}`;
        if (data.month) return String(data.month);
        if (clientPart) return clientPart;
        if (data.name) return String(data.name);
        if (data.documentNumber) return String(data.documentNumber);
        return doc.id.slice(0, 8) + '...';
    }
  };

  const getDocumentSubtitle = (doc: FirestoreDocument): string => {
    const data = doc.data;
    const parts: string[] = [];

    // Determine document type
    const docType = data.type || (data.invoiceNumber ? 'invoice' : null);

    // Collection-specific subtitle content
    switch (selectedCollection) {
      case 'documents': {
        // Month is shown in the title, not needed in subtitle

        if (docType === 'invoice') {
          // Invoice-specific info
          if (data.workingDays !== undefined) {
            parts.push(`${data.workingDays} working days`);
          }
          if (data.totalAmount !== undefined) {
            const currency = data.currency || '€';
            parts.push(`Total: ${currency} ${data.totalAmount}`);
          }
          if (data.dailyRate !== undefined) {
            const currency = data.currency || '€';
            parts.push(`${currency} ${data.dailyRate}/day`);
          }
        } else if (docType === 'timesheet') {
          // Timesheet-specific info (no amounts/rates)
          if (data.workingDays !== undefined) {
            parts.push(`${data.workingDays} working days`);
          }
          // Timesheets don't show daily rate or total amount
        }
        break;
      }

      case 'workRecords': {
        // Month is shown in the title, not needed in subtitle
        // Work record info
        if (data.workingDays && Array.isArray(data.workingDays)) {
          parts.push(`${data.workingDays.length} working days`);
        }
        if (data.dailyRate !== undefined) {
          const currency = data.currency || '€';
          parts.push(`${currency} ${data.dailyRate}/day`);
        }
        break;
      }

      case 'clients': {
        // Client info
        if (data.dailyRate !== undefined) {
          const currency = data.currency || '€';
          parts.push(`${currency} ${data.dailyRate}/day`);
        }
        break;
      }

      default:
        // Generic fallback
        if (data.workingDays !== undefined) {
          parts.push(`${Array.isArray(data.workingDays) ? data.workingDays.length : data.workingDays} working days`);
        }
        if (data.totalAmount !== undefined) {
          const currency = data.currency || '€';
          parts.push(`Total: ${currency} ${data.totalAmount}`);
        }
    }

    // Show outdated status (applies to all types)
    if (data.isOutdated) {
      parts.push('⚠ Outdated');
    }

    return parts.join(' • ') || 'No additional info';
  };

  // ============================================
  // Filtering
  // ============================================

  const filteredDocuments = useMemo(() => {
    // Deduplicate documents by workRecordId + type, keeping the most recent one
    const docMap = new Map<string, FirestoreDocument>();
    documents.forEach((doc) => {
      const workRecordId = doc.data?.workRecordId;
      const type = doc.data?.type;
      // Only deduplicate documents that have a workRecordId (invoices/timesheets from work records)
      if (workRecordId && type) {
        const key = `${workRecordId}-${type}`;
        const existing = docMap.get(key);
        // Keep the document with the most recent generatedAt timestamp
        if (!existing) {
          docMap.set(key, doc);
        } else {
          const existingDate = new Date(String(existing.data?.generatedAt || 0)).getTime();
          const newDate = new Date(String(doc.data?.generatedAt || 0)).getTime();
          if (newDate > existingDate) {
            docMap.set(key, doc);
          }
        }
      } else {
        // For documents without workRecordId, use document ID as key (no deduplication)
        docMap.set(doc.id, doc);
      }
    });
    const deduplicatedDocs = Array.from(docMap.values());

    // First, sort all documents by title descending (newest month first)
    const sortedDocuments = deduplicatedDocs.sort((a, b) => {
      const titleA = getDocumentTitle(a);
      const titleB = getDocumentTitle(b);
      // Sort descending (Z to A, so newer dates come first)
      return titleB.localeCompare(titleA);
    });

    if (!searchQuery.trim()) return sortedDocuments;

    const query = searchQuery.toLowerCase();
    return sortedDocuments.filter((doc) => {
      // Search in descriptive title (includes collection type, client name, etc.)
      const title = getDocumentTitle(doc).toLowerCase();
      if (title.includes(query)) return true;

      // Search in ID
      if (doc.id.toLowerCase().includes(query)) return true;

      // Search in document type
      const docType = doc.data?.type;
      if (docType && String(docType).toLowerCase().includes(query)) return true;

      // Search in document number (invoice number or timesheet number)
      const docNumber = doc.data?.documentNumber || doc.data?.invoiceNumber || doc.data?.timesheetNumber;
      if (docNumber && String(docNumber).toLowerCase().includes(query)) return true;

      // Search in filename
      const fileName = doc.data?.fileName;
      if (fileName && String(fileName).toLowerCase().includes(query)) return true;

      // Search in client name (if document has clientId)
      const clientId = doc.data?.clientId;
      if (clientId) {
        const clientName = clientNames.get(String(clientId));
        if (clientName?.toLowerCase().includes(query)) return true;
      }

      // Search in month
      const month = doc.data?.month;
      if (month && String(month).toLowerCase().includes(query)) return true;

      // Search in notes/description
      const notes = doc.data?.notes || doc.data?.description;
      if (notes && String(notes).toLowerCase().includes(query)) return true;

      return false;
    });
  }, [documents, searchQuery, clientNames, selectedCollection]);

  // Filter templates by search query
  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return templates;

    const query = searchQuery.toLowerCase();
    return templates.filter((template) => {
      // Search in template name
      if (template.name.toLowerCase().includes(query)) return true;

      // Search in client name
      if (template.clientName.toLowerCase().includes(query)) return true;

      // Search in type
      if (template.type.toLowerCase().includes(query)) return true;

      // Search in filename
      if (template.fileName?.toLowerCase().includes(query)) return true;

      return false;
    });
  }, [templates, searchQuery]);

  // ============================================
  // Stats
  // ============================================

  const stats = useMemo(() => {
    if (selectedCollection === 'templates') {
      return {
        total: templates.length,
        filtered: filteredTemplates.length,
      };
    }
    return {
      total: documents.length,
      filtered: filteredDocuments.length,
    };
  }, [documents, filteredDocuments, templates, filteredTemplates, selectedCollection]);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !uploadClient || !uploadMonth) return;

    try {
      setUploading(true);
      setUploadProgress(0);
      const clientId = uploadClient;
      const clientName = clientNames.get(clientId) || uploadClientsList.find(c => c.id === clientId)?.name || 'Unknown Client';
      const fileName = uploadFile.name;

      // Upload the document to Firebase Storage with progress tracking
      const { storagePath, downloadUrl } = await uploadDocument(
        userEmail,
        clientName,
        uploadMonth,
        fileName,
        uploadFile,
        undefined,
        (progress) => setUploadProgress(progress)
      );

      // Save document metadata to Firestore
      await saveDocument(userEmail, {
        clientId: clientId,
        clientName: clientName,
        workRecordId: `manual-upload-${Date.now()}`, // Or a meaningful ID if applicable
        type: uploadType,
        month: uploadMonth,
        fileName: fileName,
        storagePath: storagePath,
        downloadUrl: downloadUrl,
        isPaid: false,
        isOutdated: false,
        documentNumber: '',
        workingDays: 0,
        workingDaysArray: [],
        dailyRate: 0,
        totalAmount: 0,
      });

      // Reset internal modal state and close
      setUploadFile(null);
      setUploadProgress(0);
      setShowUploadModal(false);

      // Refresh documents
      if (selectedCollection === 'documents') {
        loadCollection('documents');
      }

    } catch (err) {
      console.error('Upload error:', err);
      alert('Failed to upload document.');
    } finally {
      setUploading(false);
    }
  };

  // ============================================
  // Render
  // ============================================

  return (
    <div className="h-full flex bg-slate-50 dark:bg-slate-950">
      {/* Sidebar - Collection Selector */}
      <div className="w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <h1 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Database size={20} className="text-indigo-600" />
            Firestore Browser
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Browse all collections
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {COLLECTIONS.map((collection) => {
            const Icon = collection.icon;
            const isActive = selectedCollection === collection.id;
            const count = collection.id === selectedCollection ? stats.total : undefined;

            return (
              <button
                key={collection.id}
                onClick={() => setSelectedCollection(collection.id)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg mb-1 text-left transition-colors ${isActive
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
              >
                <Icon size={18} className={isActive ? 'text-indigo-600' : 'text-slate-500'} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{collection.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {collection.description}
                  </div>
                </div>
                {count !== undefined && (
                  <span className="text-xs font-medium bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-white">
                {COLLECTIONS.find((c) => c.id === selectedCollection)?.name}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {stats.filtered} of {stats.total} documents
              </p>
            </div>
            <div className="flex items-center gap-2"> {/* Grouping action buttons */}
              {selectedCollection === 'documents' && (
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-500/20 dark:text-sky-300 dark:hover:bg-sky-500/30 rounded-lg transition-colors text-sm font-medium"
                >
                  <Upload size={16} />
                  Upload PDF
                </button>
              )}
              <button
                onClick={() => loadCollection(selectedCollection)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshCw size={20} className="text-slate-600 dark:text-slate-400" />
              </button>
              {selectedCollection === 'documents' && (
                <button
                  onClick={async () => {
                    const stats = await getMigrationStats(userEmail);
                    setMigrationStats(stats);
                    setShowMigrationModal(true);
                    setMigrationResult(null);
                    setMigrationProgress(null);
                  }}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                  title="Migrate Storage Structure"
                >
                  <FolderSync size={20} className="text-slate-600 dark:text-slate-400" />
                </button>
              )}
              {selectedCollection === 'documents' && (
                <button
                  onClick={async () => {
                    setShowDeduplicateModal(true);
                    setDeduplicatePreview(null);
                    setDeduplicateResult(null);
                    setDeduplicateLogs([]);
                    // Load preview
                    const preview = await previewDuplicates();
                    setDeduplicatePreview(preview);
                  }}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                  title="Deduplicate Documents"
                >
                  <Copy size={20} className="text-slate-600 dark:text-slate-400" />
                </button>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Document List */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 size={32} className="animate-spin text-indigo-600" />
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-red-600 dark:text-red-400 mt-0.5" />
                <div>
                  <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
                </div>
              </div>
            </div>
          ) : selectedCollection === 'templates' ? (
            // Templates View
            filteredTemplates.length === 0 ? (
              <div className="text-center py-12">
                <LayoutTemplate size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                <p className="text-slate-500 dark:text-slate-400">
                  {searchQuery ? 'No templates match your search' : 'No templates found. Upload templates in client settings.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredTemplates.map((template) => {
                  // Excel icon component for Excel files
                  const ExcelIcon = () => (
                    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                      <rect width="32" height="32" rx="4" fill="#217346" />
                      <path
                        d="M10 8 L16 14 L22 8 L24 10 L18 16 L24 22 L22 24 L16 18 L10 24 L8 22 L14 16 L8 10 Z"
                        fill="white"
                      />
                    </svg>
                  );

                  const isExcel = template.name.toLowerCase().endsWith('.xlsx') ||
                    template.name.toLowerCase().endsWith('.xls');

                  return (
                    <div
                      key={template.id}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {isExcel ? <ExcelIcon /> : <FileText size={20} className="text-slate-500 dark:text-slate-400 shrink-0" />}
                            <h3 className="font-semibold text-slate-800 dark:text-white truncate">
                              {template.name}
                            </h3>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${template.type === 'invoice'
                              ? 'bg-red-200 text-red-900 dark:bg-red-500/30 dark:text-red-200'
                              : 'bg-sky-200 text-sky-900 dark:bg-sky-500/30 dark:text-sky-200'
                              }`}>
                              {template.type === 'invoice' ? 'Invoice Template' : 'Timesheet Template'}
                            </span>
                          </div>
                          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            Client: {template.clientName}
                          </p>
                          <p className="text-xs text-slate-400 dark:text-slate-500 font-mono mt-1">
                            Size: {template.size}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 ml-4">
                          <button
                            onClick={() => viewTemplate(template)}
                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                            title="View details"
                          >
                            <Eye size={18} className="text-slate-600 dark:text-slate-400" />
                          </button>

                          <button
                            onClick={async () => {
                              // Download template from Firebase Storage
                              if (template.storagePath) {
                                try {
                                  const blob = await downloadTemplateFromStorage(template.storagePath);
                                  const url = URL.createObjectURL(blob);
                                  const link = document.createElement('a');
                                  link.href = url;
                                  link.download = template.fileName.endsWith('.xlsx') ? template.fileName : `${template.fileName}.xlsx`;
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                  URL.revokeObjectURL(url);
                                } catch (err) {
                                  console.error('Error downloading template:', err);
                                  alert('Failed to download template');
                                }
                              }
                            }}
                            disabled={!template.storagePath}
                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={template.storagePath ? "Download template" : "No download available"}
                          >
                            <Download size={18} className="text-slate-600 dark:text-slate-400" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : filteredDocuments.length === 0 ? (
            <div className="text-center py-12">
              <Database size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
              <p className="text-slate-500 dark:text-slate-400">
                {searchQuery ? 'No documents match your search' : 'No documents in this collection'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredDocuments.map((doc) => {
                const isExpanded = expandedDocs.has(doc.id);
                const isDeleting = deletingId === doc.id;
                const isConfirmingDelete = showDeleteConfirm === doc.id;
                const isPdf = doc.data.fileName?.toLowerCase().endsWith('.pdf') ||
                  doc.data.finalFileName?.toLowerCase().endsWith('.pdf');
                const type = doc.data.type ||
                  (selectedCollection === 'workRecords' ? 'workRecord' :
                    doc.data.documentNumber?.toString().startsWith('INV') ? 'invoice' :
                      doc.data.documentNumber?.toString().startsWith('TMS') ? 'timesheet' :
                        doc.data.invoiceNumber ? 'invoice' :
                          doc.data.fileName?.includes('Timesheet') ? 'timesheet' :
                            doc.data.excelBase64 || doc.data.fileData ? 'file' : 'document');
                const isExcel = type !== 'workRecord' && (
                  type === 'timesheet' ||
                  doc.data.fileName?.toLowerCase().endsWith('.xlsx') ||
                  doc.data.fileName?.toLowerCase().endsWith('.xls') ||
                  doc.data.finalFileName?.toLowerCase().endsWith('.xlsx') ||
                  doc.data.finalFileName?.toLowerCase().endsWith('.xls') ||
                  doc.data.fileData?.includes('spreadsheet') ||
                  doc.data.excelBase64);

                return (
                  <div
                    key={doc.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden"
                  >
                    {/* Document Header */}
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        {(() => {
                          // Get file icon based on type
                          const FileIcon = type === 'invoice' ? FileText :
                            type === 'timesheet' ? FileSpreadsheet :
                              type === 'workRecord' ? Briefcase :
                                type === 'file' ? FileText : FileText;

                          // Excel icon component for Excel files - Official Excel logo style
                          const ExcelIcon = () => (
                            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                              {/* Excel green rounded rectangle */}
                              <rect width="32" height="32" rx="4" fill="#217346" />
                              {/* White X shape - stylized like Excel */}
                              <path
                                d="M10 8 L16 14 L22 8 L24 10 L18 16 L24 22 L22 24 L16 18 L10 24 L8 22 L14 16 L8 10 Z"
                                fill="white"
                              />
                            </svg>
                          );

                          // PDF icon component
                          const PdfIcon = () => (
                            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                              <rect width="32" height="32" rx="4" fill="#E23028" />
                              <path
                                d="M22.5 16.5C22.5 17.5 21.5 18 20.5 18H18.5V14.5H20.5C21.5 14.5 22.5 15.5 22.5 16.5Z M12 18H10V12H12.5C14 12 15 13 15 14.5C15 16 14 17 12.5 17H12V18Z M17 12H18.5V18H17V12Z M12.5 13.5H12V15.5H12.5C13 15.5 13.5 15 13.5 14.5C13.5 14 13 13.5 12.5 13.5Z M25 12H27V13.5H25.5V14.5H27V16H25.5V18H24V12H25Z"
                                fill="white"
                              />
                            </svg>
                          );

                          // Get display title using the descriptive title function
                          const displayTitle = getDocumentTitle(doc);

                          const typeColors: Record<string, string> = {
                            invoice: 'bg-red-200 text-red-900 dark:bg-red-500/30 dark:text-red-200',
                            timesheet: 'bg-sky-200 text-sky-900 dark:bg-sky-500/30 dark:text-sky-200',
                            file: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-200',
                            document: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-300',
                            workRecord: 'bg-amber-200 text-amber-900 dark:bg-amber-500/30 dark:text-amber-200',
                          };

                          // Get all storage files for this document's folder
                          // Build folder path from document metadata (same logic as loadStorageFilesForDocs)
                          const storageFiles = (() => {
                            // Try to get clientName from document or lookup from clientId
                            let clientName = doc.data.clientName;
                            if (!clientName && doc.data.clientId) {
                              clientName = clientNames.get(String(doc.data.clientId));
                            }
                            // Try to get month from document
                            let month = doc.data.month;
                            if (!month && doc.data.documentNumber) {
                              const match = String(doc.data.documentNumber).match(/(\d{4})-(\d{2})/);
                              if (match) month = `${match[1]}-${match[2]}`;
                            }
                            // Try to get type from document
                            let docType = doc.data.type;
                            if (!docType) {
                              if (doc.data.documentNumber?.toString().startsWith('INV') ||
                                  doc.data.fileName?.includes('Invoice')) {
                                docType = 'invoice';
                              } else if (doc.data.documentNumber?.toString().startsWith('TMS') ||
                                         doc.data.fileName?.includes('Timesheet') ||
                                         doc.data.fileName?.includes('Time Sheet')) {
                                docType = 'timesheet';
                              }
                            }
                            
                            if (!clientName || !month || !docType) return [];
                            const sanitizedEmail = sanitizeUserEmail(userEmail);
                            const sanitizedClient = sanitizeClientName(String(clientName));
                            const folderPath = `users/${sanitizedEmail}/${sanitizedClient}/${month}/${String(docType).toLowerCase()}`;
                            return storageFilesMap.get(folderPath) || [];
                          })();

                          // Get latest status with date for tag
                          const statusHistory = doc.data.statusHistory as Array<{status: string; timestamp: string}> | undefined;
                          const currentStatus = doc.data.status as string | undefined;
                          const formatStatusLabel = (status: string): string => {
                            switch (status) {
                              case 'excel-uploaded': return 'Excel Uploaded';
                              case 'pdf-uploaded': return 'PDF Uploaded';
                              case 'final': return 'Uploaded';
                              default: return status.charAt(0).toUpperCase() + status.slice(1);
                            }
                          };
                          let statusTagText = '';
                          // First check if we have files to determine status from
                          const hasFiles = storageFiles.length > 0 || doc.data.storagePath || doc.data.finalDocuments?.length > 0;
                          const hasPdf = storageFiles.some(f => f.name.toLowerCase().endsWith('.pdf')) ||
                            doc.data.finalDocuments?.some((fd: any) => fd.fileName?.toLowerCase().endsWith('.pdf'));
                          const hasExcel = storageFiles.some(f => f.name.toLowerCase().endsWith('.xlsx') || f.name.toLowerCase().endsWith('.xls')) ||
                            doc.data.finalDocuments?.some((fd: any) => fd.fileName?.toLowerCase().match(/\.(xlsx|xls)$/));
                          
                          if (statusHistory && statusHistory.length > 0) {
                            const latest = statusHistory[statusHistory.length - 1];
                            const statusLabel = formatStatusLabel(latest.status);
                            const statusDate = format(new Date(latest.timestamp), 'MMM d, HH:mm');
                            statusTagText = `${statusLabel} • ${statusDate}`;
                          } else if (currentStatus && !hasFiles) {
                            // Only use currentStatus if no files exist
                            statusTagText = formatStatusLabel(currentStatus);
                          } else if (hasFiles) {
                            // Document has files - prioritize PDF status if PDF exists
                            if (hasPdf) {
                              statusTagText = 'PDF Uploaded';
                            } else if (hasExcel) {
                              statusTagText = 'Excel Uploaded';
                            } else if (doc.data.finalDocuments?.length > 0 || doc.data.finalStoragePath) {
                              statusTagText = 'Uploaded';
                            } else {
                              statusTagText = 'Generated';
                            }
                          } else if (currentStatus) {
                            statusTagText = formatStatusLabel(currentStatus);
                          }

                          const statusColors: Record<string, string> = {
                            generated: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
                            'excel-uploaded': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
                            'pdf-uploaded': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
                            sent: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                            paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
                            uploaded: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
                          };
                          let currentStatusKey = statusHistory?.[statusHistory.length - 1]?.status;
                          if (!currentStatusKey && hasFiles) {
                            // Determine status from storage files (prioritize PDF over stored status)
                            if (hasPdf) {
                              currentStatusKey = 'pdf-uploaded';
                            } else if (hasExcel) {
                              currentStatusKey = 'excel-uploaded';
                            } else if (doc.data.finalDocuments?.length > 0 || doc.data.finalStoragePath) {
                              currentStatusKey = 'uploaded';
                            } else {
                              currentStatusKey = 'generated';
                            }
                          } else if (!currentStatusKey) {
                            currentStatusKey = currentStatus || 'generated';
                          }
                          const statusColorClass = statusColors[currentStatusKey] || statusColors.generated;

                          return (
                            <>
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-slate-800 dark:text-white truncate">
                                  {displayTitle}
                                </h3>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${typeColors[type] || typeColors.document}`}>
                                  {type === 'workRecord' ? 'Work Record' : type.charAt(0).toUpperCase() + type.slice(1)}
                                </span>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${statusColorClass}`}>
                                  {statusTagText}
                                </span>
                                {storageFiles.length > 1 && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                                    {storageFiles.length} files
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-1">
                                {getDocumentSubtitle(doc)}
                              </p>
                            </>
                          );
                        })()}
                      </div>

                      {/* Right side - Client tag + Actions */}
                      <div className="flex flex-col items-end gap-2 ml-4">
                        {/* Client Tag */}
                        {doc.data.clientId && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-300">
                            {clientNames.get(String(doc.data.clientId)) || String(doc.data.clientId).slice(0, 8) + '...'}
                          </span>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => viewDocument(doc)}
                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                            title="View details"
                          >
                            <Eye size={18} className="text-slate-600 dark:text-slate-400" />
                          </button>

                          {isConfirmingDelete ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-red-600 dark:text-red-400 mr-1">Delete?</span>
                              <button
                                onClick={() => handleDelete(doc.id)}
                                disabled={isDeleting}
                                className="p-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                              >
                                {isDeleting ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  'Yes'
                                )}
                              </button>
                              <button
                                onClick={() => setShowDeleteConfirm(null)}
                                className="p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setShowDeleteConfirm(doc.id)}
                              className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={18} />
                            </button>
                          )}

                          <button
                            onClick={() => toggleExpanded(doc.id)}
                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronUp size={18} className="text-slate-600 dark:text-slate-400" />
                            ) : (
                              <ChevronDown size={18} className="text-slate-600 dark:text-slate-400" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* File List - Shows all files in the document's storage folder */}
                    {(() => {
                      // Build folder path from document metadata (same logic as loadStorageFilesForDocs)
                      const storageFiles = (() => {
                        // Try to get clientName from document or lookup from clientId
                        let clientName = doc.data.clientName;
                        if (!clientName && doc.data.clientId) {
                          clientName = clientNames.get(String(doc.data.clientId));
                        }
                        // Try to get month from document (could be in 'month' or parsed from documentNumber/month field)
                        let month = doc.data.month;
                        if (!month && doc.data.documentNumber) {
                          // Try to extract from document ID or number (e.g., INV-2026-02-001 -> 2026-02)
                          const match = String(doc.data.documentNumber).match(/(\d{4})-(\d{2})/);
                          if (match) month = `${match[1]}-${match[2]}`;
                        }
                        // Try to get type from document
                        let docType = doc.data.type;
                        if (!docType) {
                          // Infer from documentNumber or other fields
                          if (doc.data.documentNumber?.toString().startsWith('INV') ||
                              doc.data.fileName?.includes('Invoice')) {
                            docType = 'invoice';
                          } else if (doc.data.documentNumber?.toString().startsWith('TMS') ||
                                     doc.data.fileName?.includes('Timesheet') ||
                                     doc.data.fileName?.includes('Time Sheet')) {
                            docType = 'timesheet';
                          }
                        }
                        
                        if (!clientName || !month || !docType) return [];
                        const sanitizedEmail = sanitizeUserEmail(userEmail);
                        const sanitizedClient = sanitizeClientName(String(clientName));
                        const folderPath = `users/${sanitizedEmail}/${sanitizedClient}/${month}/${String(docType).toLowerCase()}`;
                        return storageFilesMap.get(folderPath) || [];
                      })();

                      if (storageFiles.length === 0) return null;

                      return (
                        <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 px-4 py-3">
                          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">
                            Files ({storageFiles.length})
                          </div>
                          <div className="space-y-2">
                            {storageFiles.map((file) => {
                              const isFilePdf = file.name.toLowerCase().endsWith('.pdf');
                              const isFileExcel = file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls');
                              
                              return (
                                <div key={file.fullPath} className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-200 dark:border-slate-700">
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    {/* File Icon */}
                                    {isFilePdf ? (
                                      <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                                        <rect width="32" height="32" rx="4" fill="#E23028" />
                                        <path d="M22.5 16.5C22.5 17.5 21.5 18 20.5 18H18.5V14.5H20.5C21.5 14.5 22.5 15.5 22.5 16.5Z M12 18H10V12H12.5C14 12 15 13 15 14.5C15 16 14 17 12.5 17H12V18Z M17 12H18.5V18H17V12Z M12.5 13.5H12V15.5H12.5C13 15.5 13.5 15 13.5 14.5C13.5 14 13 13.5 12.5 13.5Z M25 12H27V13.5H25.5V14.5H27V16H25.5V18H24V12H25Z" fill="white"/>
                                      </svg>
                                    ) : isFileExcel ? (
                                      <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                                        <rect width="32" height="32" rx="4" fill="#217346" />
                                        <path d="M10 8 L16 14 L22 8 L24 10 L18 16 L24 22 L22 24 L16 18 L10 24 L8 22 L14 16 L8 10 Z" fill="white"/>
                                      </svg>
                                    ) : (
                                      <File size={20} className="text-slate-400 shrink-0" />
                                    )}
                                    {/* Filename */}
                                    <span className="text-sm text-slate-700 dark:text-slate-200 truncate font-mono">
                                      {file.name}
                                    </span>
                                  </div>
                                  
                                  {/* File Actions */}
                                  <div className="flex items-center gap-1 ml-2 shrink-0">
                                    {/* Preview button */}
                                    {isFilePdf ? (
                                      <button
                                        onClick={() => window.open(file.downloadUrl, '_blank')}
                                        className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors text-sky-600 dark:text-sky-400"
                                        title="Preview PDF"
                                      >
                                        <Eye size={16} />
                                      </button>
                                    ) : isFileExcel ? (
                                      <button
                                        onClick={async () => {
                                          try {
                                            const { downloadFinalDocument } = await import('../services/storage');
                                            const blob = await downloadFinalDocument(file.fullPath);
                                            const arrayBuffer = await blob.arrayBuffer();
                                            const workbook = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true });
                                            const firstSheetName = workbook.SheetNames[0];
                                            const worksheet = workbook.Sheets[firstSheetName];
                                            const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                                              header: 1,
                                              defval: '',
                                              blankrows: true
                                            }) as any[][];
                                            setPreviewData(jsonData);
                                            setPreviewMerges(worksheet['!merges'] || []);
                                            setPreviewCols(worksheet['!cols'] || []);
                                            setPreviewFileName(file.name);
                                            setIsPreviewModalOpen(true);
                                          } catch (err) {
                                            console.error('Error previewing Excel:', err);
                                            alert('Failed to preview Excel file');
                                          }
                                        }}
                                        className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors text-emerald-600 dark:text-emerald-400"
                                        title="Preview Excel"
                                      >
                                        <Eye size={16} />
                                      </button>
                                    ) : null}
                                    
                                    {/* Download button */}
                                    <button
                                      onClick={async () => {
                                        try {
                                          // Prefer direct download URL first to avoid XHR/CORS issues
                                          // from Firebase Storage SDK download calls on web.app origins.
                                          if (file.downloadUrl) {
                                            const link = document.createElement('a');
                                            link.href = file.downloadUrl;
                                            link.download = file.name;
                                            link.rel = 'noopener noreferrer';
                                            link.style.display = 'none';
                                            document.body.appendChild(link);
                                            link.click();
                                            link.remove();
                                          } else {
                                            // Fallback: SDK blob download
                                            const { downloadFinalDocument } = await import('../services/storage');
                                            const blob = await downloadFinalDocument(file.fullPath);
                                            const url = URL.createObjectURL(blob);
                                            const link = document.createElement('a');
                                            link.href = url;
                                            link.download = file.name;
                                            link.rel = 'noopener noreferrer';
                                            link.style.display = 'none';
                                            document.body.appendChild(link);
                                            link.click();
                                            // Delay cleanup so browser has time to start the download
                                            setTimeout(() => {
                                              link.remove();
                                              URL.revokeObjectURL(url);
                                            }, 300);
                                          }
                                        } catch (err) {
                                          console.error('Error downloading file:', err);
                                          alert('Failed to download file');
                                        }
                                      }}
                                      className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors text-slate-600 dark:text-slate-400"
                                      title="Download"
                                    >
                                      <Download size={16} />
                                    </button>
                                    
                                    {/* Delete button */}
                                    <button
                                      onClick={async () => {
                                        if (!confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
                                        try {
                                          await deleteFinalDocument(file.fullPath);
                                          // Refresh storage files - build folder path from document metadata
                                          const sanitizedEmail = sanitizeUserEmail(userEmail);
                                          const sanitizedClient = sanitizeClientName(String(doc.data.clientName));
                                          const docType = String(doc.data.type).toLowerCase();
                                          const folderPath = `users/${sanitizedEmail}/${sanitizedClient}/${doc.data.month}/${docType}`;
                                          const files = await listStorageFiles(folderPath);
                                          const filesWithUrls = await Promise.all(
                                            files.map(async (f) => ({
                                              ...f,
                                              downloadUrl: await getFinalDocumentDownloadUrl(f.fullPath),
                                            }))
                                          );
                                          setStorageFilesMap(prev => new Map(prev).set(folderPath, filesWithUrls));
                                        } catch (err) {
                                          console.error('Error deleting file:', err);
                                          alert('Failed to delete file');
                                        }
                                      }}
                                      className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-md transition-colors text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                                      title="Delete file"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Expanded JSON View */}
                    {isExpanded && (
                      <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
                        <pre className="text-xs text-slate-700 dark:text-slate-300 overflow-x-auto">
                          {JSON.stringify(doc.data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Document Detail Panel */}
      {showDetail && selectedDoc && (
        <div className="w-96 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 dark:text-white">Document Details</h3>
            <button
              onClick={() => {
                setShowDetail(false);
                setSelectedDoc(null);
              }}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X size={18} className="text-slate-600 dark:text-slate-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              {/* Status History Section */}
              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                  Status History
                </label>
                <div className="mt-2 space-y-2">
                  {(() => {
                    const statusHistory = (selectedDoc.data.statusHistory as Array<{status: string; timestamp: string; note?: string}> | undefined) || [];
                    const currentStatus = selectedDoc.data.status as string | undefined;
                    
                    const formatStatusLabel = (status: string): string => {
                      switch (status) {
                        case 'excel-uploaded': return 'Excel Uploaded';
                        case 'pdf-uploaded': return 'PDF Uploaded';
                        case 'final': return 'Uploaded';
                        default: return status.charAt(0).toUpperCase() + status.slice(1);
                      }
                    };
                    
                    if (statusHistory.length === 0) {
                      // Fallback: show current status only
                      const fallbackStatus = formatStatusLabel(currentStatus || 'generated');
                      return (
                        <div className="flex items-center gap-3 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
                          <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                              {fallbackStatus}
                            </p>
                            {selectedDoc.data.generatedAt && (
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {format(new Date(String(selectedDoc.data.generatedAt)), 'MMM d, yyyy HH:mm')}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    }
                    
                    return statusHistory.map((entry, index) => {
                      const isLatest = index === statusHistory.length - 1;
                      const statusColors: Record<string, string> = {
                        generated: 'bg-blue-500',
                        'excel-uploaded': 'bg-purple-500',
                        'pdf-uploaded': 'bg-indigo-500',
                        sent: 'bg-green-500',
                        paid: 'bg-emerald-500',
                      };
                      const color = statusColors[entry.status] || 'bg-slate-500';
                      const displayStatus = formatStatusLabel(entry.status);
                      
                      return (
                        <div key={index} className={`flex items-start gap-3 p-2 rounded-lg ${isLatest ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800' : 'bg-slate-50 dark:bg-slate-800'}`}>
                          <div className={`w-2 h-2 rounded-full ${color} mt-2 shrink-0`}></div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                              {displayStatus}
                              {isLatest && <span className="ml-2 text-xs text-blue-600 dark:text-blue-400 font-normal">(current)</span>}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {format(new Date(entry.timestamp), 'MMM d, yyyy HH:mm')}
                            </p>
                            {entry.note && (
                              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 italic">
                                {entry.note}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Final Documents Section */}
              {(() => {
                const finalDocs = (selectedDoc.data.finalDocuments as Array<{fileName: string; uploadedAt: string; fileExtension: string}> | undefined) || [];
                if (finalDocs.length === 0) return null;
                
                return (
                  <div>
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                      Uploaded Files
                    </label>
                    <div className="mt-2 space-y-2">
                      {finalDocs.map((doc, index) => (
                        <div key={index} className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
                          <div className="w-8 h-8 rounded bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-medium text-slate-600 dark:text-slate-400 uppercase">
                            {doc.fileExtension}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-800 dark:text-slate-200 truncate">
                              {doc.fileName}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Uploaded {format(new Date(doc.uploadedAt), 'MMM d, yyyy')}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                  Document Details
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">ID:</span>
                    <span className="ml-2 font-mono text-slate-700 dark:text-slate-300">{selectedDoc.id.slice(0, 8)}...</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Type:</span>
                    <span className="ml-2 text-slate-700 dark:text-slate-300 capitalize">{selectedDoc.data.type || 'document'}</span>
                  </div>
                  {selectedDoc.data.documentNumber && (
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Number:</span>
                      <span className="ml-2 text-slate-700 dark:text-slate-300">{selectedDoc.data.documentNumber}</span>
                    </div>
                  )}
                  {selectedDoc.data.month && (
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Month:</span>
                      <span className="ml-2 text-slate-700 dark:text-slate-300">{selectedDoc.data.month}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Debug: Raw Data (collapsible) */}
              <details className="mt-4">
                <summary className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase cursor-pointer hover:text-slate-700 dark:hover:text-slate-300">
                  Raw Data (Debug)
                </summary>
                <pre className="mt-2 text-xs bg-slate-100 dark:bg-slate-800 p-3 rounded-lg overflow-x-auto text-slate-700 dark:text-slate-300">
                  {JSON.stringify(selectedDoc.data, null, 2)}
                </pre>
              </details>
            </div>
          </div>

          <div className="p-4 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setShowDeleteConfirm(selectedDoc.id)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
            >
              <Trash2 size={18} />
              Delete Document
            </button>
          </div>
        </div>
      )}

      {/* Template Detail Panel */}
      {selectedTemplate && (
        <div className="w-96 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
              <LayoutTemplate size={18} />
              Template Details
            </h3>
            <button
              onClick={() => setSelectedTemplate(null)}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X size={18} className="text-slate-600 dark:text-slate-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                  Template Name
                </label>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {selectedTemplate.name}
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                  Type
                </label>
                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${selectedTemplate.type === 'invoice'
                  ? 'bg-red-200 text-red-900 dark:bg-red-500/30 dark:text-red-200'
                  : 'bg-sky-200 text-sky-900 dark:bg-sky-500/30 dark:text-sky-200'
                  }`}>
                  {selectedTemplate.type === 'invoice' ? 'Invoice Template' : 'Timesheet Template'}
                </span>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                  Client
                </label>
                <p className="text-sm text-slate-800 dark:text-slate-200">
                  {selectedTemplate.clientName}
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                  Client ID
                </label>
                <p className="text-sm font-mono text-slate-800 dark:text-slate-200 break-all">
                  {selectedTemplate.clientId}
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                  File Name
                </label>
                <p className="text-sm text-slate-800 dark:text-slate-200">
                  {selectedTemplate.fileName}
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                  File Size
                </label>
                <p className="text-sm text-slate-800 dark:text-slate-200">
                  {selectedTemplate.size}
                </p>
              </div>

              {selectedTemplate.createdAt && (
                <div>
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                    Created
                  </label>
                  <p className="text-sm text-slate-800 dark:text-slate-200">
                    {format(new Date(selectedTemplate.createdAt), 'MMM d, yyyy HH:mm')}
                  </p>
                </div>
              )}

              {selectedTemplate.updatedAt && (
                <div>
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                    Updated
                  </label>
                  <p className="text-sm text-slate-800 dark:text-slate-200">
                    {format(new Date(selectedTemplate.updatedAt), 'MMM d, yyyy HH:mm')}
                  </p>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                  Template Data Preview
                </label>
                <div className="mt-1 text-xs bg-slate-100 dark:bg-slate-800 p-3 rounded-lg overflow-x-auto text-slate-700 dark:text-slate-300">
                  {selectedTemplate.data ? (
                    <>
                      <p className="font-mono break-all">
                        {selectedTemplate.data.substring(0, 200)}...
                      </p>
                      <p className="mt-2 text-slate-500 italic">
                        ({selectedTemplate.data.length} characters total)
                      </p>
                    </>
                  ) : (
                    <p className="text-slate-500 italic">No template data available</p>
                  )}
                </div>
              </div>

              <div className="pt-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  <AlertCircle size={14} className="inline mr-1" />
                  Templates are stored as separate documents in the templates collection.
                  {selectedTemplate.id.includes('legacy') && ' This is a legacy template stored within a client document.'}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setSelectedTemplate(null)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <X size={18} />
              Close
            </button>
          </div>
        </div>
      )}

      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 print:hidden">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                <Upload size={20} className="text-sky-500" />
                Upload PDF Document
              </h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                disabled={uploading}
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form id="upload-pdf-form" onSubmit={handleUploadSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Client
                  </label>
                  <select
                    value={uploadClient}
                    onChange={(e) => setUploadClient(e.target.value)}
                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    required
                  >
                    <option value="" disabled>Select a client</option>
                    {uploadClientsList.map(client => (
                      <option key={client.id} value={client.id}>{client.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Month
                  </label>
                  <input
                    type="month"
                    value={uploadMonth}
                    onChange={(e) => setUploadMonth(e.target.value)}
                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Document Type
                  </label>
                  <select
                    value={uploadType}
                    onChange={(e) => setUploadType(e.target.value as 'invoice' | 'timesheet')}
                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    required
                  >
                    <option value="invoice">Invoice</option>
                    <option value="timesheet">Timesheet</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    PDF File
                  </label>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="w-full p-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                    required
                  />
                </div>
                {/* Upload Progress Bar */}
                {uploading && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600 dark:text-slate-400">Uploading...</span>
                      <span className="text-slate-800 dark:text-slate-200 font-medium">{Math.round(uploadProgress)}%</span>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-sky-500 h-2.5 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </form>
            </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-800/50">
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                type="submit"
                form="upload-pdf-form"
                disabled={!uploadFile || !uploadClient || uploading}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg transition-colors flex items-center justify-center min-w-[100px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Migration Modal */}
      {showMigrationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-lg">
                  <FolderSync size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                    Migrate Storage Structure
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Move documents to the new folder structure
                  </p>
                </div>
              </div>
              <button
                onClick={() => !isMigrating && setShowMigrationModal(false)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors text-slate-500 dark:text-slate-400 disabled:opacity-50"
                disabled={isMigrating}
              >
                <X size={24} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6 space-y-6">
              {/* Stats Overview */}
              {migrationStats && !migrationResult && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-slate-900 dark:text-white">{migrationStats.total}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Total Documents</div>
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{migrationStats.migrated}</div>
                    <div className="text-xs text-emerald-600 dark:text-emerald-400">Already Migrated</div>
                  </div>
                  <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{migrationStats.needsMigration}</div>
                    <div className="text-xs text-amber-600 dark:text-amber-400">Need Migration</div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-slate-600 dark:text-slate-400">{migrationStats.withBase64Data + migrationStats.withOldPath}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Legacy Files</div>
                  </div>
                </div>
              )}

              {/* Migration Progress */}
              {isMigrating && migrationProgress && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Migrating documents...
                    </span>
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                      {migrationProgress.current} / {migrationProgress.total}
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-amber-500 h-3 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${(migrationProgress.current / migrationProgress.total) * 100}%` }}
                    />
                  </div>
                  {migrationProgress.currentDocument && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                      Current: {migrationProgress.currentDocument}
                    </p>
                  )}
                  <div className="flex gap-4 text-sm">
                    <span className="text-emerald-600 dark:text-emerald-400">
                      <CheckCircle size={14} className="inline mr-1" />
                      {migrationProgress.migrated} migrated
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      <RefreshCw size={14} className="inline mr-1" />
                      {migrationProgress.skipped} skipped
                    </span>
                    {migrationProgress.failed > 0 && (
                      <span className="text-red-600 dark:text-red-400">
                        <XCircle size={14} className="inline mr-1" />
                        {migrationProgress.failed} failed
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Migration Result */}
              {migrationResult && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    {migrationResult.failed === 0 ? (
                      <>
                        <div className="p-3 bg-emerald-100 dark:bg-emerald-900/30 rounded-full">
                          <CheckCircle size={24} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-emerald-700 dark:text-emerald-400">Migration Complete!</h3>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            All documents have been successfully migrated.
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-full">
                          <AlertTriangle size={24} className="text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-amber-700 dark:text-amber-400">Migration Completed with Issues</h3>
                          <p className="text-sm text-slate-600 dark:text-slate-400">
                            {migrationResult.failed} document(s) failed to migrate.
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{migrationResult.migrated}</div>
                      <div className="text-xs text-emerald-600 dark:text-emerald-400">Migrated</div>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
                      <div className="text-xl font-bold text-slate-600 dark:text-slate-400">{migrationResult.skipped}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Skipped</div>
                    </div>
                    {migrationResult.failed > 0 && (
                      <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
                        <div className="text-xl font-bold text-red-600 dark:text-red-400">{migrationResult.failed}</div>
                        <div className="text-xs text-red-600 dark:text-red-400">Failed</div>
                      </div>
                    )}
                    {migrationResult.deleted > 0 && (
                      <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-center">
                        <div className="text-xl font-bold text-slate-600 dark:text-slate-400">{migrationResult.deleted}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">Old Files Deleted</div>
                      </div>
                    )}
                  </div>

                  {/* Errors List */}
                  {migrationResult.errors.length > 0 && (
                    <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg p-4">
                      <h4 className="font-medium text-red-700 dark:text-red-400 mb-2">Errors:</h4>
                      <ul className="space-y-1 text-sm text-red-600 dark:text-red-400 max-h-32 overflow-y-auto">
                        {migrationResult.errors.map((err, idx) => (
                          <li key={idx} className="truncate" title={err.error}>
                            {err.documentId}: {err.error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Info Box */}
              {!isMigrating && !migrationResult && (
                <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <h4 className="font-medium text-blue-700 dark:text-blue-400 mb-2">What will be migrated?</h4>
                  <ul className="space-y-1 text-sm text-blue-600 dark:text-blue-400">
                    <li>• Documents missing storagePath (base64 data)</li>
                    <li>• Documents in old folder paths</li>
                    <li>• Documents without type subfolders (invoice/timesheet)</li>
                    <li>• Final documents in legacy locations</li>
                  </ul>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-900/50">
              {!migrationResult ? (
                <>
                  <button
                    onClick={() => setShowMigrationModal(false)}
                    disabled={isMigrating}
                    className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      setIsMigrating(true);
                      try {
                        const result = await migrateDocuments({
                          userEmail,
                          deleteOldFiles: false, // Keep old files for safety
                          onProgress: (progress) => setMigrationProgress(progress),
                        });
                        setMigrationResult(result);
                        // Refresh the stats
                        const newStats = await getMigrationStats(userEmail);
                        setMigrationStats(newStats);
                      } catch (error) {
                        console.error('Migration failed:', error);
                      } finally {
                        setIsMigrating(false);
                      }
                    }}
                    disabled={isMigrating || (migrationStats && migrationStats.needsMigration === 0)}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isMigrating ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <FolderSync size={16} />
                    )}
                    {isMigrating ? 'Migrating...' : 'Start Migration'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowMigrationModal(false)}
                  className="px-4 py-2 bg-slate-500 hover:bg-slate-600 text-white rounded-lg transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Deduplication Modal */}
      {showDeduplicateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg">
                  <Copy size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                    Deduplicate Documents
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Remove duplicate Firestore documents
                  </p>
                </div>
              </div>
              <button
                onClick={() => !isDeduplicating && setShowDeduplicateModal(false)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors text-slate-500 dark:text-slate-400 disabled:opacity-50"
                disabled={isDeduplicating}
              >
                <X size={24} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {!deduplicatePreview && !deduplicateResult && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={32} className="animate-spin text-indigo-600" />
                  <span className="ml-3 text-slate-600 dark:text-slate-400">Analyzing documents...</span>
                </div>
              )}

              {deduplicatePreview && !deduplicateResult && (
                <>
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4 text-center">
                      <div className="text-2xl font-bold text-slate-700 dark:text-slate-300">{deduplicatePreview.totalDocuments}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Total Documents</div>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 text-center">
                      <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{deduplicatePreview.duplicateGroups.length}</div>
                      <div className="text-xs text-amber-600 dark:text-amber-400">Duplicate Groups</div>
                    </div>
                    <div className="bg-rose-50 dark:bg-rose-900/20 rounded-xl p-4 text-center">
                      <div className="text-2xl font-bold text-rose-600 dark:text-rose-400">{deduplicatePreview.totalDuplicates}</div>
                      <div className="text-xs text-rose-600 dark:text-rose-400">To Delete</div>
                    </div>
                  </div>

                  {/* Duplicate Groups */}
                  {deduplicatePreview.duplicateGroups.length > 0 ? (
                    <div className="space-y-4">
                      <h3 className="font-semibold text-slate-700 dark:text-slate-300">Duplicate Groups Found:</h3>
                      {deduplicatePreview.duplicateGroups.map((group, idx) => (
                        <div key={group.key} className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {idx + 1}. {group.key}
                            </span>
                            <span className="text-sm text-slate-500 dark:text-slate-400">
                              {group.delete.length} duplicate{group.delete.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="space-y-2 text-sm">
                            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                              <CheckCircle size={14} />
                              <span>Keep: {group.keep.id} ({new Date(group.keep.generatedAt || 0).toLocaleString()})</span>
                            </div>
                            {group.delete.map((dup, i) => (
                              <div key={dup.id} className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                                <XCircle size={14} />
                                <span>Delete: {dup.id} ({new Date(dup.generatedAt || 0).toLocaleString()})</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <CheckCircle size={48} className="mx-auto mb-4 text-emerald-500" />
                      <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300">No Duplicates Found!</h3>
                      <p className="text-slate-500 dark:text-slate-400">All documents are unique.</p>
                    </div>
                  )}
                </>
              )}

              {/* Progress */}
              {isDeduplicating && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={32} className="animate-spin text-indigo-600" />
                  <span className="ml-3 text-slate-600 dark:text-slate-400">Removing duplicates...</span>
                </div>
              )}

              {/* Result */}
              {deduplicateResult && (
                <div className="text-center py-6">
                  {deduplicateResult.failedCount === 0 ? (
                    <>
                      <CheckCircle size={64} className="mx-auto mb-4 text-emerald-500" />
                      <h3 className="text-xl font-semibold text-emerald-700 dark:text-emerald-400 mb-2">
                        Deduplication Complete!
                      </h3>
                    </>
                  ) : (
                    <>
                      <AlertTriangle size={64} className="mx-auto mb-4 text-amber-500" />
                      <h3 className="text-xl font-semibold text-amber-700 dark:text-amber-400 mb-2">
                        Completed with Issues
                      </h3>
                    </>
                  )}
                  <p className="text-slate-600 dark:text-slate-400 mb-4">
                    Deleted {deduplicateResult.deletedCount} of {deduplicateResult.totalDuplicates} duplicates
                    {deduplicateResult.failedCount > 0 && ` (${deduplicateResult.failedCount} failed)`}
                  </p>
                  {deduplicateLogs.length > 0 && (
                    <div className="text-left bg-slate-100 dark:bg-slate-800 rounded-lg p-4 max-h-48 overflow-y-auto text-sm font-mono">
                      {deduplicateLogs.map((log, i) => (
                        <div key={i} className="text-slate-600 dark:text-slate-400">{log}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3 bg-white dark:bg-slate-950">
              {!deduplicateResult ? (
                <>
                  <button
                    onClick={() => setShowDeduplicateModal(false)}
                    disabled={isDeduplicating}
                    className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      setIsDeduplicating(true);
                      setDeduplicateLogs([]);
                      try {
                        const result = await runDeduplication((message) => {
                          setDeduplicateLogs(prev => [...prev, message]);
                        });
                        setDeduplicateResult(result);
                        // Refresh documents
                        if (selectedCollection === 'documents') {
                          loadCollection('documents');
                        }
                      } catch (error) {
                        console.error('Deduplication failed:', error);
                      } finally {
                        setIsDeduplicating(false);
                      }
                    }}
                    disabled={isDeduplicating || !deduplicatePreview || deduplicatePreview.totalDuplicates === 0}
                    className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isDeduplicating ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                    {isDeduplicating ? 'Removing...' : `Remove ${deduplicatePreview?.totalDuplicates || 0} Duplicates`}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setShowDeduplicateModal(false)}
                  className="px-4 py-2 bg-slate-500 hover:bg-slate-600 text-white rounded-lg transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Excel Preview Modal */}
      <ExcelPreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        data={previewData}
        fileName={previewFileName}
        merges={previewMerges}
        cols={previewCols}
      />
    </div>
  );
};
