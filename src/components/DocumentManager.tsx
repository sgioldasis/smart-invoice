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
} from 'lucide-react';
import { format } from 'date-fns';
import {
  getCollectionData,
  deleteDocumentById,
  getTemplates,
  type CollectionType,
  type FirestoreDocument,
} from '../services/db';
import type { Template } from '../types';

interface DocumentManagerProps {
  userId: string;
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
  data?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const DocumentManager: React.FC<DocumentManagerProps> = ({ userId }) => {
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

  // Client name cache for displaying client names instead of IDs
  const [clientNames, setClientNames] = useState<Map<string, string>>(new Map());

  // ============================================
  // Data Loading
  // ============================================

  const loadCollection = async (collectionName: CollectionType | 'templates') => {
    try {
      setLoading(true);
      setError(null);

      if (collectionName === 'templates') {
        // Fetch templates from the templates collection
        const templatesData = await getTemplates(userId);
        const clientsData = await getCollectionData('clients', userId);
        const clientMap = new Map(clientsData.map(c => [c.id, String(c.data.name || 'Unknown')]));

        const extractedTemplates: TemplateDoc[] = templatesData.map((template: Template) => {
          const size = estimateBase64Size(template.base64Data);
          return {
            id: template.id,
            clientId: template.clientId,
            clientName: clientMap.get(template.clientId) || 'Unknown',
            type: template.type,
            name: template.name,
            fileName: template.fileName,
            hasTemplate: true,
            size,
            data: template.base64Data,
            createdAt: template.createdAt,
            updatedAt: template.updatedAt,
          };
        });

        setTemplates(extractedTemplates);
        setDocuments([]);
      } else {
        const data = await getCollectionData(collectionName, userId);
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
          const clients = await getClients(userId);
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
  }, [selectedCollection, userId]);

  // Helper to estimate base64 size
  const estimateBase64Size = (base64: string): string => {
    const bytes = (base64.length * 3) / 4;
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  const downloadDocument = (doc: FirestoreDocument) => {
    const data = doc.data;
    
    // Check if document has file data
    if (data.fileData && typeof data.fileData === 'string') {
      // fileData might be a data URL or just base64
      const fileName = String(data.fileName || `${data.documentNumber || doc.id}.xlsx`);
      
      // Create proper data URL if it's just base64
      const fileData = data.fileData.startsWith('data:')
        ? data.fileData
        : `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${data.fileData}`;
      
      // Create download link
      const link = document.createElement('a');
      link.href = fileData;
      link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (data.excelBase64 && typeof data.excelBase64 === 'string') {
      // Legacy support for excelBase64 field
      const fileName = String(data.fileName || `${data.documentNumber || doc.id}.xlsx`);
      
      // Create proper data URL if it's just base64
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

  // ============================================
  // Filtering
  // ============================================

  const filteredDocuments = useMemo(() => {
    if (!searchQuery.trim()) return documents;

    const query = searchQuery.toLowerCase();
    return documents.filter((doc) => {
      // Search in ID
      if (doc.id.toLowerCase().includes(query)) return true;
      // Search in data values
      const dataStr = JSON.stringify(doc.data).toLowerCase();
      return dataStr.includes(query);
    });
  }, [documents, searchQuery]);

  // ============================================
  // Stats
  // ============================================

  const stats = useMemo(() => {
    return {
      total: documents.length,
      filtered: filteredDocuments.length,
    };
  }, [documents, filteredDocuments]);

  // ============================================
  // Render Helpers
  // ============================================

  const getDocumentTitle = (doc: FirestoreDocument): string => {
    const data = doc.data;
    // Try to find a meaningful name/identifier
    if (data.name) return String(data.name);
    if (data.documentNumber) return String(data.documentNumber);
    if (data.month) return String(data.month);
    if (data.invoiceNumber) return String(data.invoiceNumber);
    return doc.id.slice(0, 8) + '...';
  };

  const getDocumentSubtitle = (doc: FirestoreDocument): string => {
    const data = doc.data;
    const parts: string[] = [];
    
    if (data.month) parts.push(String(data.month));
    if (data.clientId) {
      const clientId = String(data.clientId);
      const clientName = clientNames.get(clientId);
      parts.push(`Client: ${clientName || clientId.slice(0, 8) + '...'}`);
    }
    if (data.generatedAt) {
      try {
        parts.push(format(new Date(String(data.generatedAt)), 'MMM d, yyyy'));
      } catch {
        parts.push(String(data.generatedAt));
      }
    }
    if (data.createdAt) {
      try {
        parts.push(format(new Date(String(data.createdAt)), 'MMM d, yyyy'));
      } catch {
        parts.push(String(data.createdAt));
      }
    }
    
    return parts.join(' • ') || 'No additional info';
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
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg mb-1 text-left transition-colors ${
                  isActive
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
            <button
              onClick={() => loadCollection(selectedCollection)}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw size={20} className="text-slate-600 dark:text-slate-400" />
            </button>
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
            templates.length === 0 ? (
              <div className="text-center py-12">
                <LayoutTemplate size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                <p className="text-slate-500 dark:text-slate-400">
                  No templates found. Upload templates in client settings.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map((template) => {
                  // Excel icon component for Excel files
                  const ExcelIcon = () => (
                    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                      <rect width="32" height="32" rx="4" fill="#217346"/>
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
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                              template.type === 'invoice'
                                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            }`}>
                              {template.type === 'invoice' ? 'Invoice' : 'Timesheet'}
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
                            onClick={() => {
                              // Download template - create proper Excel data URL
                              if (template.data) {
                                const base64Data = template.data;
                                const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                                const dataUrl = `data:${mimeType};base64,${base64Data}`;
                                const link = document.createElement('a');
                                link.href = dataUrl;
                                link.download = template.name.endsWith('.xlsx') ? template.name : `${template.name}.xlsx`;
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                              }
                            }}
                            disabled={!template.data}
                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            title={template.data ? "Download template" : "No download available"}
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

                return (
                  <div
                    key={doc.id}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden"
                  >
                    {/* Document Header */}
                    <div className="p-4 flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        {(() => {
                          // Determine document type from various fields
                          const type = doc.data.type ||
                            (doc.data.documentNumber?.toString().startsWith('INV') ? 'invoice' :
                             doc.data.documentNumber?.toString().startsWith('TMS') ? 'timesheet' :
                             doc.data.invoiceNumber ? 'invoice' :
                             doc.data.fileName?.includes('Timesheet') ? 'timesheet' :
                             doc.data.excelBase64 || doc.data.fileData ? 'file' : 'document');
                          
                          // Get file icon based on type
                          const FileIcon = type === 'invoice' ? FileText :
                                           type === 'timesheet' ? FileSpreadsheet :
                                           type === 'file' ? FileText : FileText;
                          
                          // Excel icon component for Excel files - Official Excel logo style
                          const ExcelIcon = () => (
                            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                              {/* Excel green rounded rectangle */}
                              <rect width="32" height="32" rx="4" fill="#217346"/>
                              {/* White X shape - stylized like Excel */}
                              <path
                                d="M10 8 L16 14 L22 8 L24 10 L18 16 L24 22 L22 24 L16 18 L10 24 L8 22 L14 16 L8 10 Z"
                                fill="white"
                              />
                            </svg>
                          );
                          
                          // Determine if it's an Excel file
                          const isExcel = type === 'timesheet' ||
                                          doc.data.fileName?.toLowerCase().endsWith('.xlsx') ||
                                          doc.data.fileName?.toLowerCase().endsWith('.xls') ||
                                          doc.data.fileData?.includes('spreadsheet') ||
                                          doc.data.excelBase64;
                          
                          // Get file name
                          const fileName = doc.data.fileName ||
                                           doc.data.documentNumber ||
                                           doc.data.invoiceNumber ||
                                           `${doc.id.slice(0, 8)}...`;
                          
                          const typeColors: Record<string, string> = {
                            invoice: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
                            timesheet: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                            file: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
                            document: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400',
                          };
                          
                          return (
                            <>
                              <div className="flex items-center gap-2">
                                {isExcel ? <ExcelIcon /> : <FileIcon size={20} className="text-slate-500 dark:text-slate-400 shrink-0" />}
                                <h3 className="font-semibold text-slate-800 dark:text-white truncate">
                                  {String(fileName)}
                                </h3>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${typeColors[type] || typeColors.document}`}>
                                  {type.charAt(0).toUpperCase() + type.slice(1)}
                                </span>
                              </div>
                              <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-1">
                                {getDocumentSubtitle(doc)}
                              </p>
                              <p className="text-xs text-slate-400 dark:text-slate-500 font-mono mt-1">
                                ID: {doc.id}
                              </p>
                            </>
                          );
                        })()}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => viewDocument(doc)}
                          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          title="View details"
                        >
                          <Eye size={18} className="text-slate-600 dark:text-slate-400" />
                        </button>

                        {(doc.data.fileData || doc.data.excelBase64) && (
                          <button
                            onClick={() => downloadDocument(doc)}
                            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                            title="Download file"
                          >
                            <Download size={18} className="text-slate-600 dark:text-slate-400" />
                          </button>
                        )}

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
              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                  Document ID
                </label>
                <p className="text-sm font-mono text-slate-800 dark:text-slate-200 break-all">
                  {selectedDoc.id}
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                  Collection
                </label>
                <p className="text-sm text-slate-800 dark:text-slate-200">
                  {selectedDoc.collection}
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase">
                  Full Data
                </label>
                <pre className="mt-1 text-xs bg-slate-100 dark:bg-slate-800 p-3 rounded-lg overflow-x-auto text-slate-700 dark:text-slate-300">
                  {JSON.stringify(selectedDoc.data, null, 2)}
                </pre>
              </div>
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
                <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                  selectedTemplate.type === 'invoice'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
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
    </div>
  );
};
