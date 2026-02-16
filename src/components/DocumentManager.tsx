/**
 * DocumentManager Component
 *
 * Central page for managing all generated documents (invoices, timesheets).
 * Allows users to:
 * - View all documents with filtering and sorting
 * - See outdated/paid status at a glance
 * - Regenerate documents
 * - Delete documents
 * - Navigate to related work records
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  FileSpreadsheet,
  Trash2,
  RefreshCw,
  Loader2,
  Search,
  Building2,
  Calendar,
  AlertTriangle,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Filter,
  Download,
  Edit3,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import type { Client, Document } from '../types';
import { getClients, getDocuments, deleteDocument } from '../services/db';

interface DocumentManagerProps {
  userId: string;
  onRegenerateDocument?: (clientId: string, month: string, documentNumber: string) => void;
  onViewWorkRecord?: (clientId: string, month: string) => void;
}

export const DocumentManager: React.FC<DocumentManagerProps> = ({
  userId,
  onRegenerateDocument,
  onViewWorkRecord,
}) => {
  // ============================================
  // State
  // ============================================

  const [clients, setClients] = useState<Client[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Sorting
  const [sortField, setSortField] = useState<'date' | 'amount' | 'client'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  // ============================================
  // Data Loading
  // ============================================

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [clientsData, documentsData] = await Promise.all([
          getClients(userId),
          getDocuments(userId),
        ]);
        setClients(clientsData);
        setDocuments(documentsData);
      } catch (err) {
        console.error('Error loading documents:', err);
        setError('Failed to load documents');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [userId]);

  // ============================================
  // Helpers
  // ============================================

  const getClient = (clientId: string): Client | undefined => {
    return clients.find((c) => c.id === clientId);
  };

  const handleDelete = async (documentId: string) => {
    try {
      setDeletingId(documentId);
      await deleteDocument(documentId);
      setDocuments((prev) => prev.filter((d) => d.id !== documentId));
      setShowDeleteConfirm(null);
    } catch (err) {
      console.error('Error deleting document:', err);
      setError('Failed to delete document');
    } finally {
      setDeletingId(null);
    }
  };

  const handleRegenerate = (doc: Document) => {
    onRegenerateDocument?.(doc.clientId, doc.month, doc.documentNumber);
  };

  const handleViewWorkRecord = (doc: Document) => {
    onViewWorkRecord?.(doc.clientId, doc.month);
  };

  // ============================================
  // Filtering & Sorting
  // ============================================

  const filteredDocuments = useMemo(() => {
    let filtered = [...documents];

    // Search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((doc) => {
        const client = getClient(doc.clientId);
        return (
          doc.documentNumber.toLowerCase().includes(query) ||
          client?.name.toLowerCase().includes(query) ||
          doc.month.includes(query)
        );
      });
    }

    // Client filter
    if (clientFilter !== 'all') {
      filtered = filtered.filter((doc) => doc.clientId === clientFilter);
    }

    // Type filter
    if (typeFilter !== 'all') {
      filtered = filtered.filter((doc) => doc.type === typeFilter);
    }

    // Status filter
    if (statusFilter !== 'all') {
      switch (statusFilter) {
        case 'outdated':
          filtered = filtered.filter((doc) => doc.isOutdated);
          break;
        case 'paid':
          filtered = filtered.filter((doc) => doc.isPaid);
          break;
        case 'pending':
          filtered = filtered.filter((doc) => !doc.isPaid && !doc.isOutdated);
          break;
      }
    }

    // Sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'date':
          comparison = new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime();
          break;
        case 'amount':
          comparison = a.totalAmount - b.totalAmount;
          break;
        case 'client':
          const clientA = getClient(a.clientId)?.name || '';
          const clientB = getClient(b.clientId)?.name || '';
          comparison = clientA.localeCompare(clientB);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [documents, searchQuery, clientFilter, typeFilter, statusFilter, sortField, sortDirection]);

  // ============================================
  // Stats
  // ============================================

  const stats = useMemo(() => {
    const total = documents.length;
    const outdated = documents.filter((d) => d.isOutdated).length;
    const paid = documents.filter((d) => d.isPaid).length;
    const totalAmount = documents.reduce((sum, d) => sum + d.totalAmount, 0);
    return { total, outdated, paid, totalAmount };
  }, [documents]);

  // ============================================
  // Render
  // ============================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={32} className="animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-slate-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <FileText size={28} className="text-indigo-600" />
              Document Manager
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-1">
              Manage all your generated invoices and timesheets
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
            <p className="text-sm text-slate-500 dark:text-slate-400">Total Documents</p>
            <p className="text-2xl font-bold text-slate-800 dark:text-white">{stats.total}</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
            <p className="text-sm text-slate-500 dark:text-slate-400">Outdated</p>
            <p className="text-2xl font-bold text-amber-600">{stats.outdated}</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
            <p className="text-sm text-slate-500 dark:text-slate-400">Paid</p>
            <p className="text-2xl font-bold text-green-600">{stats.paid}</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
            <p className="text-sm text-slate-500 dark:text-slate-400">Total Value</p>
            <p className="text-2xl font-bold text-indigo-600">
              {stats.totalAmount.toLocaleString()} €
            </p>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="p-6">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Search by number, client, or month..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <Filter size={18} />
              Filters
              {showFilters ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>

          {/* Expanded Filters */}
          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Client
                </label>
                <select
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                >
                  <option value="all">All Clients</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Type
                </label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                >
                  <option value="all">All Types</option>
                  <option value="invoice">Invoice</option>
                  <option value="timesheet">Timesheet</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                >
                  <option value="all">All Status</option>
                  <option value="outdated">Outdated</option>
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Results Count */}
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Showing {filteredDocuments.length} of {documents.length} documents
        </p>

        {/* Documents List */}
        {filteredDocuments.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
            <FileText size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
            <h3 className="text-lg font-medium text-slate-800 dark:text-white mb-2">
              No documents found
            </h3>
            <p className="text-slate-500 dark:text-slate-400">
              {documents.length === 0
                ? 'Generate your first invoice to get started'
                : 'Try adjusting your filters'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredDocuments.map((doc) => {
              const client = getClient(doc.clientId);
              const isDeleting = deletingId === doc.id;
              const isConfirmingDelete = showDeleteConfirm === doc.id;

              return (
                <div
                  key={doc.id}
                  className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    {/* Left: Document Info */}
                    <div className="flex items-start gap-4">
                      <div
                        className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                          doc.type === 'invoice'
                            ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'
                            : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {doc.type === 'invoice' ? <FileSpreadsheet size={24} /> : <FileText size={24} />}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-slate-800 dark:text-white">
                            {doc.type === 'invoice' ? 'Invoice' : 'Timesheet'} #{doc.documentNumber}
                          </h3>
                          {doc.isOutdated && (
                            <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-medium rounded-full flex items-center gap-1">
                              <AlertTriangle size={12} />
                              Outdated
                            </span>
                          )}
                          {doc.isPaid && (
                            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-medium rounded-full flex items-center gap-1">
                              <Check size={12} />
                              Paid
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                          <span className="flex items-center gap-1">
                            <Building2 size={14} />
                            {client?.name || 'Unknown Client'}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar size={14} />
                            {format(parseISO(doc.month + '-01'), 'MMMM yyyy')}
                          </span>
                          <span>
                            {doc.workingDays} days × {doc.dailyRate} {client?.currency || 'EUR'} = {' '}
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              {doc.totalAmount.toLocaleString()} {client?.currency || 'EUR'}
                            </span>
                          </span>
                          <span>
                            Generated {format(parseISO(doc.generatedAt), 'dd/MM/yyyy')}
                          </span>
                        </div>

                        {doc.fileName && (
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                            {doc.fileName}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2">
                      {isConfirmingDelete ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-red-600 dark:text-red-400">Delete?</span>
                          <button
                            onClick={() => handleDelete(doc.id)}
                            disabled={isDeleting}
                            className="p-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                            title="Confirm delete"
                          >
                            {isDeleting ? (
                              <Loader2 size={18} className="animate-spin" />
                            ) : (
                              <Check size={18} />
                            )}
                          </button>
                          <button
                            onClick={() => setShowDeleteConfirm(null)}
                            className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                            title="Cancel"
                          >
                            <X size={18} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => handleViewWorkRecord(doc)}
                            className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                            title="View work record"
                          >
                            <Edit3 size={18} />
                          </button>
                          <button
                            onClick={() => handleRegenerate(doc)}
                            className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                            title="Regenerate"
                          >
                            <RefreshCw size={18} />
                          </button>
                          <button
                            onClick={() => setShowDeleteConfirm(doc.id)}
                            className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
