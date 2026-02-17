
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Building2,
  Calendar as CalendarIcon,
  FileSpreadsheet,
  Settings,
  LogOut,
  Plus,
  Save,
  Download,
  Check,
  X,
  Bot,
  Loader2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Trash2,
  Sun,
  Moon,
  History,
  Printer,
  Edit3,
  Landmark,
  UserSquare,
  Info,
  Briefcase,
  Eye,
  BarChart3,
  TrendingUp,
  Users,
  ClipboardList,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, AreaChart } from 'recharts';
import { motion } from 'framer-motion';
import { GoogleGenAI, Type } from "@google/genai";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { format, getDaysInMonth, startOfMonth, endOfMonth, eachDayOfInterval, isWeekend, isSameDay, parseISO, addMonths, subMonths, addDays } from 'date-fns';
import { Auth } from './Auth';

// NEW: Work Record Components
import { WorkRecordManager } from './src/components/WorkRecordManager';
import { WorkRecordList } from './src/components/WorkRecordList';
import { deleteAllClientTimesheets, saveTemplate } from './src/services/db';

// NEW: Refactored Invoice Generator
import { InvoiceGenerator as NewInvoiceGenerator } from './src/components/InvoiceGenerator';

// NEW: Document Manager
import { DocumentManager } from './src/components/DocumentManager';

// NEW: Import WorkRecord types
import type { WorkRecord, Document, Template } from './src/types';

// --- Types ---

interface CellMapping {
  date: string;
  invoiceNumber: string;
  description: string;
  daysWorked: string;
  dailyRate: string;
  totalAmount: string;
}

interface Client {
  id: string;
  userId: string; // Owner of this client
  name: string; // The Client's Name (Bill To)
  issuerName?: string; // The User's Name (From)
  issuerDetails?: string; // Address/Tax/Bank for PDF Header/Footer
  dailyRate: number;
  currency: string;
  templateName?: string;
  templateBase64?: string;
  mapping: CellMapping;
  defaultUseGreekHolidays?: boolean;
  // Timesheet template fields
  timesheetTemplateName?: string;
  timesheetTemplateBase64?: string;
  timesheetPrompt?: string;
}


interface AnalysisResult {
  mapping: Partial<CellMapping>;
  metadata: {
    clientName?: string;
    issuerName?: string;
    currency?: string;
    dailyRate?: number;
  };
}

// --- Shared Holiday Utilities ---

// Store holidays in a module-level cache that can be accessed by any component
const holidaysCache: Record<number, Record<string, string>> = {};

const fetchGreekHolidays = async (year: number): Promise<Record<string, string>> => {
  if (holidaysCache[year]) return holidaysCache[year];

  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/GR`);
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    const map: Record<string, string> = {};
    if (Array.isArray(data)) {
      data.forEach((h: any) => { map[h.date] = h.localName || h.name; });
    }
    holidaysCache[year] = map;
    return map;
  } catch (err) {
    console.error("Failed to fetch holidays", err);
    holidaysCache[year] = {};
    return {};
  }
};

const getHolidayName = (date: Date): string | undefined => {
  const y = date.getFullYear();
  const d = format(date, 'yyyy-MM-dd');
  return holidaysCache[y]?.[d];
};

// --- Services ---

import { db, signUp, logIn, logOut, onAuthChange } from './firebase';
import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  Timestamp
} from 'firebase/firestore';

// 1. Firestore Storage Service
const DB = {
  getClients: async (userId: string): Promise<Client[]> => {
    try {
      const q = query(collection(db, 'clients'), where('userId', '==', userId));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Client));
    } catch (e) {
      console.error('Error fetching clients:', e);
      return [];
    }
  },
  saveClient: async (client: Client) => {
    try {
      const clientRef = doc(db, 'clients', client.id);
      await setDoc(clientRef, client, { merge: true });
    } catch (e) {
      console.error('Error saving client:', e);
      throw e;
    }
  },
  deleteClient: async (id: string) => {
    try {
      await deleteDoc(doc(db, 'clients', id));
      // Also delete all invoices for this client
      const invoicesSnapshot = await getDocs(
        query(collection(db, 'invoices'), where('clientId', '==', id))
      );
      const deletePromises = invoicesSnapshot.docs.map(invDoc => deleteDoc(invDoc.ref));
      await Promise.all(deletePromises);
    } catch (e) {
      console.error('Error deleting client:', e);
      throw e;
    }
  },
  getDocuments: async (userId: string, clientId?: string, type?: 'invoice' | 'timesheet'): Promise<Document[]> => {
    try {
      const constraints: any[] = [where('userId', '==', userId)];
      if (clientId) {
        constraints.push(where('clientId', '==', clientId));
      }
      if (type) {
        constraints.push(where('type', '==', type));
      }
      const q = query(collection(db, 'documents'), ...constraints);
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Document));
    } catch (e) {
      console.error('Error fetching documents:', e);
      return [];
    }
  },
  // NEW: Work Record methods
  getWorkRecordByMonth: async (userId: string, clientId: string, month: string): Promise<WorkRecord | null> => {
    try {
      const q = query(
        collection(db, 'workRecords'),
        where('userId', '==', userId),
        where('clientId', '==', clientId),
        where('month', '==', month)
      );
      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;
      const doc = snapshot.docs[0];
      return { ...doc.data(), id: doc.id } as WorkRecord;
    } catch (e) {
      console.error('Error fetching work record:', e);
      return null;
    }
  },
  saveDocument: async (document: Document) => {
    try {
      const docRef = doc(db, 'documents', document.id);
      await setDoc(docRef, document, { merge: true });
    } catch (e) {
      console.error('Error saving document:', e);
      throw e;
    }
  }
};

// 2. AI Service
const AIService = {
  analyzeTemplate: async (cellData: string): Promise<AnalysisResult> => {
    if (!process.env.API_KEY) {
      alert("API Key not found in environment.");
      return { mapping: {}, metadata: {} };
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const prompt = `
      I am analyzing an Excel Invoice Template. 
      I have a list of non-empty cells with their exact coordinates in the format: [CellAddress]: Value.

      Data:
      ${cellData.substring(0, 8000)} ... (truncated if too long)

      Your Task:
      1. **Metadata Extraction**:
         - **Issuer Name** (From): The company sending the invoice. Usually at the top left or center with a logo.
         - **Client Name** (Bill To): The company receiving the invoice. Look for "Bill To:", "Client:", "To:".
         - **Currency**: Look for symbols ($, €, £) or codes.
         - **Daily Rate**: If hardcoded.

      2. **Cell Mapping** (Find Target Cells for Dynamic Data):
         - **date**: Issue Date cell.
         - **invoiceNumber**: Invoice ID cell.
         - **description**: Description row/column.
         - **daysWorked**: Quantity/Days column in the main table.
         - **dailyRate**: Rate/Price column.
         - **totalAmount**: Line Item Amount (Qty * Rate). NOT the Grand Total.

      Return JSON.
    `;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              mapping: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING, nullable: true },
                  invoiceNumber: { type: Type.STRING, nullable: true },
                  description: { type: Type.STRING, nullable: true },
                  daysWorked: { type: Type.STRING, nullable: true },
                  dailyRate: { type: Type.STRING, nullable: true },
                  totalAmount: { type: Type.STRING, nullable: true },
                }
              },
              metadata: {
                type: Type.OBJECT,
                properties: {
                  issuerName: { type: Type.STRING, nullable: true },
                  clientName: { type: Type.STRING, nullable: true },
                  currency: { type: Type.STRING, nullable: true },
                  dailyRate: { type: Type.NUMBER, nullable: true },
                }
              }
            }
          }
        }
      });
      return JSON.parse(response.text) as AnalysisResult;
    } catch (e) {
      console.error("AI Analysis failed", e);
      return { mapping: {}, metadata: {} };
    }
  }
};

// --- Components ---

const Layout = ({ children, activeTab, setActiveTab, theme, toggleTheme, authComponent }: any) => {
  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 dark:bg-slate-950 border-r border-slate-800 text-slate-300 flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FileText className="text-indigo-400" />
            SmartInvoice
          </h1>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab('workrecords')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'workrecords' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}`}
          >
            <ClipboardList size={20} />
            <span>Work Records</span>
          </button>
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'dashboard' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}`}
          >
            <Briefcase size={20} />
            <span>Clients</span>
          </button>
          <button
            onClick={() => setActiveTab('documents')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'documents' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}`}
          >
            <FileText size={20} />
            <span>Documents</span>
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'analytics' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}`}
          >
            <BarChart3 size={20} />
            <span>Analytics</span>
          </button>
        </nav>
        <div className="p-4 border-t border-slate-800 space-y-4">
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
          </button>

          {authComponent}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto min-w-0">
        {children}
      </main>
    </div>
  );
};

const Dashboard = ({ userId, onEditClient, onSelectClient }: any) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const loadClients = async () => {
    setLoading(true);
    const data = await DB.getClients(userId);
    setClients(data);
    setLoading(false);
  };

  useEffect(() => {
    loadClients();
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this client?')) {
      await DB.deleteClient(id);
      await loadClients();
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Clients</h2>
          <p className="text-slate-500 dark:text-slate-400">Manage your clients and their invoice templates</p>
        </div>
        <button
          onClick={() => onEditClient(null)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition"
        >
          <Plus size={18} /> Add Client
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {clients.map(client => (
          <div
            key={client.id}
            onClick={() => onEditClient(client)}
            className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:shadow-md transition cursor-pointer group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Building2 size={24} />
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); onSelectClient(client); }}
                  className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                  title="Select for invoice"
                >
                  <FileText size={18} />
                </button>
                <button
                  onClick={(e) => handleDelete(e, client.id)}
                  className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">{client.name}</h3>
            <p className="text-xs text-slate-500 mb-3">Issued by: {client.issuerName || 'Me'}</p>
            <div className="flex justify-between text-sm text-slate-500 dark:text-slate-400 mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
              <span>Rate: {client.dailyRate} {client.currency}/day</span>
              <span className={client.templateBase64 ? "text-green-600 dark:text-green-400 flex items-center gap-1" : "text-amber-500 dark:text-amber-400 flex items-center gap-1"}>
                {client.templateBase64 ? <><Check size={14} /> Template</> : "No Template"}
              </span>
            </div>
          </div>
        ))}

        {clients.length === 0 && (
          <div className="col-span-full text-center py-20 bg-slate-50 dark:bg-slate-900 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700">
            <p className="text-slate-500 dark:text-slate-400">No clients found. Create one to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
};

const ClientEditor = ({ userId, client, onSave, onCancel }: any) => {
  const [formData, setFormData] = useState<Client>(client || {
    id: crypto.randomUUID(),
    userId: userId,
    name: '',
    issuerName: 'My Company',
    issuerDetails: '',
    dailyRate: 500,
    currency: '$',
    mapping: { date: '', invoiceNumber: '', description: '', daysWorked: '', dailyRate: '', totalAmount: '' },
    defaultUseGreekHolidays: false,
    timesheetTemplateName: undefined,
    timesheetTemplateBase64: undefined,
    timesheetPrompt: undefined
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [invoiceTemplateId, setInvoiceTemplateId] = useState<string | null>(client?.invoiceTemplateId || null);
  const [timesheetTemplateId, setTimesheetTemplateId] = useState<string | null>(client?.timesheetTemplateId || null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result as string;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];

      let cellDump = "";
      const range = XLSX.utils.decode_range(ws['!ref'] || "A1:Z100");
      const maxRow = Math.min(range.e.r, 60);

      for (let R = range.s.r; R <= maxRow; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = ws[cellAddress];
          if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
            cellDump += `[${cellAddress}]: ${cell.v}\n`;
          }
        }
      }

      const base64 = btoa(bstr);

      // Create and save template as separate document
      const template: Template = {
        id: crypto.randomUUID(),
        userId: userId,
        clientId: formData.id,
        type: 'invoice',
        name: file.name,
        fileName: file.name,
        base64Data: base64,
        mapping: formData.mapping,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      try {
        const saved = await saveTemplate(template);
        setInvoiceTemplateId(saved.id);
        setFormData(prev => ({ ...prev, templateName: file.name, templateBase64: base64, invoiceTemplateId: saved.id }));
      } catch (error) {
        console.error('Error saving invoice template:', error);
        alert('Failed to save invoice template. Please try again.');
        return;
      }

      setIsAnalyzing(true);
      const result = await AIService.analyzeTemplate(cellDump);
      setIsAnalyzing(false);

      if (result) {
        setFormData(prev => ({
          ...prev,
          name: (!prev.name && result.metadata?.clientName) ? result.metadata.clientName : (prev.name || result.metadata?.clientName || ''),
          issuerName: (prev.issuerName === 'My Company' && result.metadata?.issuerName) ? result.metadata.issuerName : prev.issuerName,
          currency: (!prev.currency || prev.currency === '$') && result.metadata?.currency ? result.metadata.currency : prev.currency,
          dailyRate: (prev.dailyRate === 500 && result.metadata?.dailyRate) ? result.metadata.dailyRate : prev.dailyRate,
          mapping: { ...prev.mapping, ...result.mapping }
        }));
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleTimesheetFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result as string;
      const base64 = btoa(bstr);

      // Create and save timesheet template as separate document
      const template: Template = {
        id: crypto.randomUUID(),
        userId: userId,
        clientId: formData.id,
        type: 'timesheet',
        name: file.name,
        fileName: file.name,
        base64Data: base64,
        timesheetMapping: formData.timesheetMapping,
        timesheetPrompt: formData.timesheetPrompt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      try {
        const saved = await saveTemplate(template);
        setTimesheetTemplateId(saved.id);
        setFormData(prev => ({ ...prev, timesheetTemplateName: file.name, timesheetTemplateBase64: base64, timesheetTemplateId: saved.id }));
      } catch (error) {
        console.error('Error saving timesheet template:', error);
        alert('Failed to save timesheet template. Please try again.');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleClearDefaultTimesheetTemplate = () => {
    const confirmed = window.confirm(
      'Are you sure you want to remove the default timesheet template?\n\nThe client will no longer have a default template for generating timesheets.'
    );

    if (!confirmed) return;

    setTimesheetTemplateId(null);
    setFormData(prev => ({
      ...prev,
      timesheetTemplateName: undefined,
      timesheetTemplateBase64: undefined,
      timesheetTemplateId: undefined
    }));
  };

  const handleClearAllClientTimesheets = async () => {
    if (!client?.id || !userId) {
      alert('Please save the client first before clearing timesheet templates.');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete ALL stored timesheet templates for "${formData.name}"?\n\nThis will remove all month-specific templates from Firebase. This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      const deletedCount = await deleteAllClientTimesheets(userId, client.id);
      alert(`Successfully deleted ${deletedCount} timesheet template(s) for "${formData.name}".`);
    } catch (error: any) {
      console.error('Error clearing timesheet templates:', error);
      alert(`Failed to delete timesheet templates: ${error?.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <button onClick={onCancel} className="mb-6 flex items-center text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400">
        <ChevronLeft size={16} /> Back to Dashboard
      </button>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">
            {client ? `Edit ${client.name}` : 'New Client'}
          </h2>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left Column: Client Info */}
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-700">
                <Building2 size={18} /> Client Details (Bill To)
              </h3>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Client Name
                </label>
                <input
                  type="text"
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.name}
                  placeholder="e.g. Google, ACME Corp"
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Daily Rate</label>
                  <input
                    type="number"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.dailyRate}
                    onChange={e => setFormData({ ...formData, dailyRate: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Currency</label>
                  <input
                    type="text"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.currency}
                    placeholder="$ or €"
                    onChange={e => setFormData({ ...formData, currency: e.target.value })}
                  />
                </div>
              </div>

              {/* Greek Holidays Toggle */}
              <div className="flex items-center justify-between mt-4 pt-2 border-t border-slate-100 dark:border-slate-700">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Exclude Greek Holidays by default</span>
                <button
                  onClick={() => setFormData({ ...formData, defaultUseGreekHolidays: !formData.defaultUseGreekHolidays })}
                  className={`w-10 h-6 rounded-full transition-colors relative ${formData.defaultUseGreekHolidays ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${formData.defaultUseGreekHolidays ? 'left-5' : 'left-1'}`} />
                </button>
              </div>
            </div>

            {/* Right Column: Issuer Info */}
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-700">
                <UserSquare size={18} /> My Details (Issuer)
              </h3>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  My Name / Company
                </label>
                <input
                  type="text"
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={formData.issuerName || ''}
                  placeholder="John Doe / My Inc"
                  onChange={e => setFormData({ ...formData, issuerName: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-2">
                  <Landmark size={16} /> Address & Bank (for Reference)
                </label>
                <textarea
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none text-sm h-24"
                  value={formData.issuerDetails || ''}
                  placeholder="123 Street, City&#10;VAT: 123456&#10;IBAN: GB..."
                  onChange={e => setFormData({ ...formData, issuerDetails: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Invoice Template Section */}
          <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
              <FileSpreadsheet className="text-green-600 dark:text-green-500" size={20} />
              Invoice Excel Template
            </h3>

            <div className="flex items-center gap-4 mb-6">
              <label className="cursor-pointer bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 transition flex items-center gap-2">
                <Plus size={16} /> Upload Invoice Template (.xlsx)
                <input type="file" accept=".xlsx" className="hidden" onChange={handleFileChange} />
              </label>
              {formData.templateName && (
                <span className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  {isAnalyzing ? <Loader2 className="animate-spin text-indigo-600 dark:text-indigo-400" size={16} /> : <Check size={16} className="text-green-500 dark:text-green-400" />}
                  {formData.templateName}
                </span>
              )}
            </div>

            {isAnalyzing && (
              <div className="bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 p-4 rounded-lg mb-6 flex items-center gap-3">
                <Bot size={24} />
                <div>
                  <p className="font-medium">AI Analysis in progress...</p>
                  <p className="text-sm">Gemini is looking for Issuer, Client, and Mapping cells in your template.</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Object.keys(formData.mapping).map((key) => (
                <div key={key}>
                  <label className="block text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-1">
                    {key.replace(/([A-Z])/g, ' $1').trim()} Cell
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. B4"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-slate-900 dark:text-white focus:border-indigo-500 outline-none"
                    value={(formData.mapping as any)[key]}
                    onChange={e => setFormData({
                      ...formData,
                      mapping: { ...formData.mapping, [key]: e.target.value }
                    })}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Timesheet Template Section */}
          <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
              <CalendarIcon className="text-blue-600 dark:text-blue-500" size={20} />
              Timesheet Excel Template
            </h3>

            <div className="space-y-4">
              {/* Timesheet Template Upload */}
              <div className="flex items-center gap-4">
                <label className="cursor-pointer bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 transition flex items-center gap-2">
                  <Plus size={16} /> Upload Timesheet Template (.xlsx)
                  <input
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={handleTimesheetFileChange}
                  />
                </label>
                {formData.timesheetTemplateName && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                      <Check size={16} className="text-green-500 dark:text-green-400" />
                      {formData.timesheetTemplateName}
                    </span>
                    <button
                      onClick={handleClearDefaultTimesheetTemplate}
                      className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                      title="Remove default template"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </div>

              {/* Clear All Timesheet Templates Button */}
              {client?.id && (
                <div className="pt-2">
                  <button
                    onClick={handleClearAllClientTimesheets}
                    className="flex items-center gap-2 px-4 py-2 text-red-600 bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800 rounded-lg transition-colors text-sm"
                  >
                    <Trash2 size={16} />
                    <span>Clear All Stored Timesheet Templates</span>
                  </button>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 ml-1">
                    Delete all month-specific timesheet templates stored for this client in Firebase
                  </p>
                </div>
              )}

              {/* Timesheet Prompt */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-2">
                  <Bot size={16} /> AI Prompt Instructions
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Describe how to fill out the timesheet for each month. The AI will use this prompt to generate the timesheet.
                </p>
                <textarea
                  value={formData.timesheetPrompt || ''}
                  onChange={e => setFormData({ ...formData, timesheetPrompt: e.target.value })}
                  placeholder="e.g., Fill in the Date column with each working day of the month. Set the Project column to 'Main Project'. Calculate Total Hours as 8 hours per working day."
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm h-24 resize-none focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
          <button
            onClick={() => onSave({ ...formData, invoiceTemplateId, timesheetTemplateId })}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
          >
            Save Client
          </button>
        </div>
      </div>
    </div>
  );
};


// --- Main App ---

// --- Analytics Component ---

const Analytics = ({ userId }: { userId: string }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      console.log('Analytics: Loading data for user', userId);
      const [clientsData, docsData] = await Promise.all([
        DB.getClients(userId),
        DB.getDocuments(userId, undefined, 'invoice') // Fetch documents of type 'invoice'
      ]);
      console.log('Analytics: Loaded clients', clientsData.length);
      console.log('Analytics: Loaded documents', docsData.length);
      setClients(clientsData);
      setDocuments(docsData);
      setLoading(false);
    };
    loadData();
  }, [userId]);

  // Prepare chart data
  const chartData = useMemo(() => {
    // Get all unique months sorted
    const months = Array.from(new Set(documents.map(i => i.month))).sort() as string[];

    // Create a map of month -> clientId -> amount
    const dataMap = new Map<string, Map<string, number>>();

    months.forEach((month: string) => {
      dataMap.set(month, new Map());
    });

    documents.forEach(doc => {
      const client = clients.find(c => c.id === doc.clientId);
      if (client) {
        const monthMap = dataMap.get(doc.month);
        if (monthMap) {
          const amount = doc.totalAmount || 0;
          monthMap.set(client.id, (monthMap.get(client.id) || 0) + amount);
        }
      }
    });

    // Convert to array format for recharts
    return months.map((month: string) => {
      const entry: any = {
        month: format(parseISO(`${month}-01`), 'MMM yyyy'),
        rawMonth: month
      };
      let monthTotal = 0;
      clients.forEach(client => {
        const amount = dataMap.get(month)?.get(client.id) || 0;
        entry[client.name] = amount;
        monthTotal += amount;
      });
      entry['Total'] = monthTotal;
      return entry;
    });
  }, [documents, clients]);

  // Generate colors for each client
  const clientColors = useMemo(() => {
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    return clients.reduce((acc, client, index) => {
      acc[client.id] = colors[index % colors.length];
      return acc;
    }, {} as Record<string, string>);
  }, [clients]);

  // Custom tooltip with glassmorphic design
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      // Sort payload: Total first, then by value descending
      const sortedPayload = [...payload].sort((a: any, b: any) => {
        if (a.name === 'Total') return -1;
        if (b.name === 'Total') return 1;
        return b.value - a.value;
      });

      return (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-xl p-4 shadow-2xl"
          style={{
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)'
          }}
        >
          <p className="text-white font-semibold mb-2">{label}</p>
          {sortedPayload.map((entry: any, index: number) => (
            <motion.div
              key={entry.name}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="flex items-center gap-2 mb-1"
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: entry.color, boxShadow: `0 0 10px ${entry.color}` }}
              />
              <span className="text-slate-300 text-sm">{entry.name}:</span>
              <span className="text-white font-mono font-semibold">
                {entry.value.toLocaleString()}
              </span>
            </motion.div>
          ))}
        </motion.div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="p-8">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-4">Analytics</h2>
        <p className="text-slate-500 dark:text-slate-400">Please create a client first to see analytics.</p>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="p-8">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-4">Analytics</h2>
        <p className="text-slate-500 dark:text-slate-400">No generated invoices yet. Generate some invoices to see analytics.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-8">
      <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">Analytics</h2>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative p-6 rounded-2xl min-w-0"
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.9))',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 1px 0 0 rgba(255, 255, 255, 0.05)'
        }}
      >
        {/* Glossy top highlight */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />

        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Revenue by Client</h3>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-slate-400">Live Data</span>
          </div>
        </div>

        <div className="relative h-96 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 40, left: 10, bottom: 20 }}>
              <defs>
                {/* Gradient definitions for each client */}
                {clients.map(client => (
                  <linearGradient key={client.id} id={`gradient-${client.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={clientColors[client.id]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={clientColors[client.id]} stopOpacity={0.05} />
                  </linearGradient>
                ))}
                {/* Total gradient */}
                <linearGradient id="gradient-total" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255, 255, 255, 0.05)"
                vertical={false}
              />
              <XAxis
                dataKey="month"
                stroke="rgba(255, 255, 255, 0.3)"
                style={{ fontSize: '12px' }}
                tick={{ fill: 'rgba(255, 255, 255, 0.6)' }}
                axisLine={{ stroke: 'rgba(255, 255, 255, 0.1)' }}
              />
              <YAxis
                stroke="rgba(255, 255, 255, 0.3)"
                style={{ fontSize: '12px' }}
                tick={{ fill: 'rgba(255, 255, 255, 0.6)' }}
                tickFormatter={(value) => `${value.toLocaleString()}`}
                axisLine={{ stroke: 'rgba(255, 255, 255, 0.1)' }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ paddingTop: '20px' }}
                iconType="circle"
                formatter={(value: string, entry: any) => (
                  <span style={{ color: entry.color }}>{value}</span>
                )}
              />

              {/* Total Income Line - rendered first for tooltip/legend order */}
              <Area
                type="monotone"
                dataKey="Total"
                stroke="#f59e0b"
                strokeWidth={3}
                strokeDasharray="5 5"
                fill={`url(#gradient-total)`}
                fillOpacity={1}
                animationDuration={2000}
                animationBegin={0}
                dot={{
                  fill: '#f59e0b',
                  r: 5,
                  strokeWidth: 2,
                  stroke: 'rgba(15, 23, 42, 0.8)'
                }}
                activeDot={{
                  r: 7,
                  strokeWidth: 3,
                  stroke: '#fff',
                  fill: '#f59e0b'
                }}
              />

              {/* Client areas - sorted by total revenue descending */}
              {clients
                .map(client => ({
                  client,
                  totalRevenue: documents
                    .filter(doc => doc.clientId === client.id)
                    .reduce((sum, doc) => sum + (doc.totalAmount || 0), 0)
                }))
                .sort((a, b) => b.totalRevenue - a.totalRevenue)
                .map(({ client }, index) => (
                  <Area
                    key={client.id}
                    type="monotone"
                    dataKey={client.name}
                    stroke={clientColors[client.id]}
                    strokeWidth={2}
                    fill={`url(#gradient-${client.id})`}
                    fillOpacity={1}
                    stackId="1"
                    animationDuration={1500}
                    animationBegin={(index + 1) * 200}
                    dot={{
                      fill: clientColors[client.id],
                      r: 4,
                      strokeWidth: 2,
                      stroke: 'rgba(15, 23, 42, 0.8)'
                    }}
                    activeDot={{
                      r: 6,
                      strokeWidth: 3,
                      stroke: '#fff',
                      fill: clientColors[client.id]
                    }}
                  />
                ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative p-6 rounded-2xl overflow-hidden group cursor-pointer"
          style={{
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(99, 102, 241, 0.05))',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            boxShadow: '0 25px 50px -12px rgba(99, 102, 241, 0.25), inset 0 1px 0 0 rgba(255, 255, 255, 0.1)'
          }}
          whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
        >
          {/* Glossy top highlight */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-400/30 to-transparent pointer-events-none" />
          {/* Soft glow on hover */}
          <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

          <h4 className="text-sm font-medium text-slate-400 mb-1">Total Revenue</h4>
          <p className="text-3xl font-bold text-white tracking-tight">
            {documents.reduce((sum, doc) => sum + (doc.totalAmount || 0), 0).toLocaleString()} EUR
          </p>
          <div className="mt-2 flex items-center gap-1 text-xs text-emerald-400">
            <TrendingUp size={14} />
            <span>Lifetime earnings</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative p-6 rounded-2xl overflow-hidden group cursor-pointer"
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.05))',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            boxShadow: '0 25px 50px -12px rgba(16, 185, 129, 0.25), inset 0 1px 0 0 rgba(255, 255, 255, 0.1)'
          }}
          whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
        >
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400/30 to-transparent pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

          <h4 className="text-sm font-medium text-slate-400 mb-1">Total Invoices</h4>
          <p className="text-3xl font-bold text-white tracking-tight">{documents.length}</p>
          <div className="mt-2 flex items-center gap-1 text-xs text-emerald-400">
            <FileText size={14} />
            <span>Generated invoices</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="relative p-6 rounded-2xl overflow-hidden group cursor-pointer"
          style={{
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(245, 158, 11, 0.05))',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(245, 158, 11, 0.2)',
            boxShadow: '0 25px 50px -12px rgba(245, 158, 11, 0.25), inset 0 1px 0 0 rgba(255, 255, 255, 0.1)'
          }}
          whileHover={{ scale: 1.02, transition: { duration: 0.2 } }}
        >
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/30 to-transparent pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

          <h4 className="text-sm font-medium text-slate-400 mb-1">Active Clients</h4>
          <p className="text-3xl font-bold text-white tracking-tight">
            {new Set(documents.map(i => i.clientId)).size}
          </p>
          <div className="mt-2 flex items-center gap-1 text-xs text-emerald-400">
            <Users size={14} />
            <span>With invoices</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState('workrecords'); // workrecords | dashboard | generator | analytics

  // Client state
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [viewState, setViewState] = useState<'list' | 'edit'>('list');
  const [targetClientId, setTargetClientId] = useState<string | undefined>();

  // Work Record state
  const [workRecordView, setWorkRecordView] = useState<'list' | 'edit'>('list');
  const [editingWorkRecordClientId, setEditingWorkRecordClientId] = useState<string | undefined>();
  const [editingWorkRecordMonth, setEditingWorkRecordMonth] = useState<string | undefined>();
  const [workRecordListKey, setWorkRecordListKey] = useState(0);

  // Invoice Generator state (for regeneration)
  const [invoiceGenInvoiceNumber, setInvoiceGenInvoiceNumber] = useState<string | undefined>();

  // Auth State
  const [user, setUser] = useState<{ uid: string; email: string | null } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Theme State
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') || 'light';
    }
    return 'light';
  });

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthChange((firebaseUser) => {
      if (firebaseUser) {
        setUser({ uid: firebaseUser.uid, email: firebaseUser.email });
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  const handleEditClient = (client: Client | null) => {
    setEditingClient(client);
    setViewState('edit');
  };

  const handleSaveClient = async (client: Client) => {
    if (!user) return;
    await DB.saveClient({ ...client, userId: user.uid });
    setViewState('list');
    setEditingClient(null);
  };

  const handleSelectClientForInvoice = (client: Client) => {
    setTargetClientId(client.id);
    setActiveTab('generator');
  };

  // Work Record handlers
  const handleCreateWorkRecord = () => {
    setEditingWorkRecordClientId(undefined);
    setEditingWorkRecordMonth(undefined);
    setWorkRecordView('edit');
  };

  const handleEditWorkRecord = (clientId: string, month: string) => {
    setEditingWorkRecordClientId(clientId);
    setEditingWorkRecordMonth(month);
    setWorkRecordView('edit');
  };

  const handleWorkRecordSaved = () => {
    setWorkRecordView('list');
    setEditingWorkRecordClientId(undefined);
    setEditingWorkRecordMonth(undefined);
    // Force WorkRecordList to refresh by updating the key
    setWorkRecordListKey(prev => prev + 1);
  };

  const handleGenerateInvoiceFromWorkRecord = (clientId: string, month: string, existingInvoiceNumber?: string) => {
    // Navigate to generator tab with pre-selected client and month
    setActiveTab('generator');
    // Store the client/month for the invoice generator to use
    setEditingWorkRecordClientId(clientId);
    setEditingWorkRecordMonth(month);
    // If regenerating, store the existing invoice number to reuse
    setInvoiceGenInvoiceNumber(existingInvoiceNumber);
  };

  if (authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="animate-spin text-indigo-600">
          <Loader2 size={48} />
        </div>
      </div>
    );
  }

  return (
    <Layout
      activeTab={activeTab}
      setActiveTab={(tab: string) => {
        setActiveTab(tab);
        setViewState('list');
        setWorkRecordView('list');
      }}
      theme={theme}
      toggleTheme={toggleTheme}
      authComponent={<Auth user={user} onAuthChange={() => { }} />}
    >
      {!user ? (
        <div className="flex flex-col items-center justify-center h-full p-8">
          <div className="text-center max-w-md">
            <FileText className="mx-auto mb-4 text-indigo-600" size={64} />
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Welcome to SmartInvoice</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-6">Please sign in or create an account to manage your invoices.</p>
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
              <Auth user={user} onAuthChange={() => { }} />
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Work Records Tab */}
          {activeTab === 'workrecords' && workRecordView === 'list' && (
            <WorkRecordList
              key={workRecordListKey}
              userId={user.uid}
              onEditWorkRecord={handleEditWorkRecord}
              onCreateWorkRecord={handleCreateWorkRecord}
              onGenerateInvoice={handleGenerateInvoiceFromWorkRecord}
            />
          )}

          {activeTab === 'workrecords' && workRecordView === 'edit' && (
            <WorkRecordManager
              userId={user.uid}
              initialClientId={editingWorkRecordClientId}
              initialMonth={editingWorkRecordMonth}
              onSave={handleWorkRecordSaved}
            />
          )}

          {/* Clients/Dashboard Tab */}
          {activeTab === 'dashboard' && viewState === 'list' && (
            <Dashboard
              userId={user.uid}
              onEditClient={handleEditClient}
              onSelectClient={handleSelectClientForInvoice}
            />
          )}

          {activeTab === 'dashboard' && viewState === 'edit' && (
            <ClientEditor
              userId={user.uid}
              client={editingClient}
              onSave={handleSaveClient}
              onCancel={() => setViewState('list')}
            />
          )}

          {/* Invoice Generator Tab */}
          {activeTab === 'generator' && (
            <NewInvoiceGenerator
              userId={user.uid}
              initialClientId={editingWorkRecordClientId || targetClientId}
              initialMonth={editingWorkRecordMonth}
              existingInvoiceNumber={invoiceGenInvoiceNumber}
            />
          )}

          {/* Document Manager Tab */}
          {activeTab === 'documents' && (
            <DocumentManager
              userId={user.uid}
              onRegenerateDocument={(clientId, month, documentNumber) => {
                setTargetClientId(clientId);
                setEditingWorkRecordMonth(month);
                setInvoiceGenInvoiceNumber(documentNumber);
                setActiveTab('generator');
              }}
              onViewWorkRecord={(clientId, month) => {
                setEditingWorkRecordClientId(clientId);
                setEditingWorkRecordMonth(month);
                setWorkRecordView('edit');
                setActiveTab('workrecords');
              }}
            />
          )}

          {/* Analytics Tab */}
          {activeTab === 'analytics' && (
            <Analytics userId={user.uid} />
          )}
        </>
      )}
    </Layout>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
