
import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Briefcase
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { format, getDaysInMonth, startOfMonth, endOfMonth, eachDayOfInterval, isWeekend, isSameDay, parseISO, addMonths, subMonths } from 'date-fns';
import { Auth } from './Auth';

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
}

interface InvoiceRecord {
  id: string;
  userId: string; // Owner of this invoice
  clientId: string;
  month: string; // YYYY-MM
  excludedDates: string[]; // ISO strings
  includedDates?: string[]; // ISO strings - Days forced to be working (e.g. working weekends)
  useGreekHolidays: boolean;
  manualAdjustment: number; // +/- amount
  status: 'draft' | 'generated';
  // History fields
  invoiceNumber?: string;
  savedAmount?: number;
  savedDays?: number;
  generatedDate?: string;
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
  getInvoices: async (userId: string, clientId: string): Promise<InvoiceRecord[]> => {
    try {
      const q = query(
        collection(db, 'invoices'),
        where('userId', '==', userId),
        where('clientId', '==', clientId)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as InvoiceRecord));
    } catch (e) {
      console.error('Error fetching invoices:', e);
      return [];
    }
  },
  saveInvoice: async (invoice: InvoiceRecord) => {
    try {
      const invoiceRef = doc(db, 'invoices', invoice.id);
      await setDoc(invoiceRef, invoice, { merge: true });
    } catch (e) {
      console.error('Error saving invoice:', e);
      throw e;
    }
  },
  deleteInvoice: async (id: string) => {
    try {
      await deleteDoc(doc(db, 'invoices', id));
    } catch (e) {
      console.error('Error deleting invoice:', e);
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
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'dashboard' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}`}
          >
            <Briefcase size={20} />
            <span>Clients</span>
          </button>
          <button 
             onClick={() => setActiveTab('generator')}
             className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'generator' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}`}
          >
            <CalendarIcon size={20} />
            <span>Invoice Generator</span>
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
      <main className="flex-1 overflow-auto">
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
    if(confirm('Are you sure you want to delete this client?')) {
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
            onClick={() => onSelectClient(client)}
            className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:shadow-md transition cursor-pointer group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Building2 size={24} />
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                  onClick={(e) => { e.stopPropagation(); onEditClient(client); }}
                  className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  <Edit3 size={18} />
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
              <span>Rate: {client.currency}{client.dailyRate}/day</span>
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
    defaultUseGreekHolidays: false
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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
      
      for(let R = range.s.r; R <= maxRow; ++R) {
        for(let C = range.s.c; C <= range.e.c; ++C) {
          const cellAddress = XLSX.utils.encode_cell({r:R, c:C});
          const cell = ws[cellAddress];
          if(cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
            cellDump += `[${cellAddress}]: ${cell.v}\n`;
          }
        }
      }

      const base64 = btoa(bstr);

      setFormData(prev => ({ ...prev, templateName: file.name, templateBase64: base64 }));
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
                  onChange={e => setFormData({...formData, name: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Daily Rate</label>
                  <input 
                    type="number" 
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.dailyRate}
                    onChange={e => setFormData({...formData, dailyRate: Number(e.target.value)})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Currency</label>
                  <input 
                    type="text"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.currency}
                    placeholder="$ or €"
                    onChange={e => setFormData({...formData, currency: e.target.value})}
                  />
                </div>
              </div>

              {/* Greek Holidays Toggle */}
              <div className="flex items-center justify-between mt-4 pt-2 border-t border-slate-100 dark:border-slate-700">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Exclude Greek Holidays by default</span>
                <button 
                  onClick={() => setFormData({...formData, defaultUseGreekHolidays: !formData.defaultUseGreekHolidays})}
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
                  onChange={e => setFormData({...formData, issuerName: e.target.value})}
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
                  onChange={e => setFormData({...formData, issuerDetails: e.target.value})}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
              <FileSpreadsheet className="text-green-600 dark:text-green-500" size={20} />
              Excel Template Configuration
            </h3>
            
            <div className="flex items-center gap-4 mb-6">
              <label className="cursor-pointer bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 transition flex items-center gap-2">
                <Plus size={16} /> Upload Client's Template (.xlsx)
                <input type="file" accept=".xlsx" className="hidden" onChange={handleFileChange} />
              </label>
              {formData.templateName && (
                <span className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
                  {isAnalyzing ? <Loader2 className="animate-spin text-indigo-600 dark:text-indigo-400" size={16}/> : <Check size={16} className="text-green-500 dark:text-green-400" />}
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
        </div>

        <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
          <button 
            onClick={() => onSave(formData)}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
          >
            Save Client
          </button>
        </div>
      </div>
    </div>
  );
};

const InvoiceGenerator = ({ userId, clientId }: { userId: string; clientId?: string }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadClients = async () => {
      const data = await DB.getClients(userId);
      setClients(data);
      if (!clientId && data.length > 0) {
        setSelectedClientId(data[0].id);
      } else if (clientId) {
        setSelectedClientId(clientId);
      }
      setLoading(false);
    };
    loadClients();
  }, [clientId, userId]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [subTab, setSubTab] = useState<'new' | 'history'>('new');
  
  // Invoice State
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [invoiceNumberInput, setInvoiceNumberInput] = useState('');
  
  // Holidays State
  const [holidaysMap, setHolidaysMap] = useState<Record<string, Record<string, string>>>({});

  const selectedClient = useMemo(() => clients.find(c => c.id === selectedClientId), [clients, selectedClientId]);
  const historyInvoices = useMemo(() => invoices.filter(i => i.status === 'generated').sort((a,b) => b.month.localeCompare(a.month)), [invoices]);

  // Load invoices when client changes
  useEffect(() => {
    if (selectedClient) {
      const loadInvoices = async () => {
        const data = await DB.getInvoices(userId, selectedClient.id);
        setInvoices(data);
      };
      loadInvoices();
    } else {
      setInvoices([]);
    }
  }, [selectedClient, userId]);

  // Handle clientId prop change
  useEffect(() => {
    if (clientId) setSelectedClientId(clientId);
  }, [clientId]);

  // Calendar Logic
  const daysInMonth = useMemo(() => {
    return eachDayOfInterval({
      start: startOfMonth(currentDate),
      end: endOfMonth(currentDate)
    });
  }, [currentDate]);

  // Fetch Greek Holidays
  useEffect(() => {
    const year = currentDate.getFullYear();
    // Fetch for current, previous and next year to be safe, but primarily current displayed year
    if (!holidaysMap[year]) {
       fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/GR`)
         .then(res => res.ok ? res.json() : [])
         .then(data => {
            const map: Record<string, string> = {};
            if (Array.isArray(data)) {
                data.forEach((h: any) => { map[h.date] = h.localName || h.name; });
            }
            setHolidaysMap(prev => ({...prev, [year]: map}));
         })
         .catch(err => {
             console.error("Failed to fetch holidays", err);
             // Prevent infinite retries for failure by setting empty array
             setHolidaysMap(prev => ({...prev, [year]: {}}));
         });
    }
  }, [currentDate.getFullYear()]); // Only re-run if year changes

  const getHolidayName = (date: Date): string | undefined => {
      const y = date.getFullYear();
      const d = format(date, 'yyyy-MM-dd');
      return holidaysMap[y]?.[d];
  };

  const checkIsHoliday = (date: Date) => !!getHolidayName(date);

  // Load or Create Invoice Record for this month
  useEffect(() => {
    if (!selectedClient) return;
    
    const monthStr = format(currentDate, 'yyyy-MM');
    const existing = invoices.find(i => i.month === monthStr && i.clientId === selectedClient.id);
    
    if (existing) {
      setInvoice({
        ...existing,
        includedDates: existing.includedDates || []
      });
      setInvoiceNumberInput(existing.invoiceNumber || `INV-${format(currentDate, 'yyyyMM')}-${Math.floor(Math.random()*100)}`);
    } else {
      const newInvoice: InvoiceRecord = {
        id: crypto.randomUUID(),
        userId: userId,
        clientId: selectedClient.id,
        month: monthStr,
        excludedDates: [],
        includedDates: [],
        useGreekHolidays: selectedClient.defaultUseGreekHolidays || false,
        manualAdjustment: 0,
        status: 'draft'
      };
      setInvoice(newInvoice);
      setInvoiceNumberInput(`INV-${format(currentDate, 'yyyyMM')}-${Math.floor(Math.random()*100)}`);
      // Save new invoice to Firebase
      DB.saveInvoice(newInvoice);
    }
  }, [selectedClientId, currentDate]);

  const toggleDayStatus = async (date: Date) => {
    if (!invoice) return;
    const dateStr = date.toISOString();
    
    const isWknd = isWeekend(date);
    const isHol = invoice.useGreekHolidays && checkIsHoliday(date);
    const isDefaultNonWorking = isWknd || isHol;
    
    const isExcluded = invoice.excludedDates.includes(dateStr);
    const isIncluded = invoice.includedDates?.includes(dateStr);
    
    // Determine effective status: A day is working if it's NOT default non-working AND not excluded, OR if it is specifically included.
    const isWorking = (!isDefaultNonWorking && !isExcluded) || isIncluded;

    let newExcluded = [...invoice.excludedDates];
    let newIncluded = [...(invoice.includedDates || [])];

    if (isWorking) {
        // Toggle to Non-Working
        if (isIncluded) {
            // It was manually included (e.g. working weekend), so we remove the inclusion to revert to default (non-working)
            newIncluded = newIncluded.filter(d => d !== dateStr);
        } else {
            // It was default working (normal weekday), so we explicitly exclude it
            newExcluded.push(dateStr);
        }
    } else {
        // Toggle to Working
        if (isExcluded) {
            // It was manually excluded, so we remove the exclusion to revert to default (working)
            newExcluded = newExcluded.filter(d => d !== dateStr);
        } else {
            // It was default non-working (weekend/holiday), so we explicitly include it
            newIncluded.push(dateStr);
        }
    }
    
    const updated: InvoiceRecord = { 
        ...invoice, 
        excludedDates: newExcluded, 
        includedDates: newIncluded 
    };
    
    setInvoice(updated);
    await DB.saveInvoice({ ...updated, userId });
    // Refresh invoices list
    const refreshedInvoices = await DB.getInvoices(userId, selectedClient.id);
    setInvoices(refreshedInvoices);
  };

  const toggleGreekHolidays = async () => {
    if (!invoice) return;
    
    // Maintain existing status to keep history visible until explicit re-generation
    const updated: InvoiceRecord = {
      ...invoice,
      useGreekHolidays: !invoice.useGreekHolidays,
      // status: 'draft' // REMOVED: Do not reset to draft
    };
    
    setInvoice(updated);
    await DB.saveInvoice({ ...updated, userId });
    // Refresh invoices list
    const refreshedInvoices = await DB.getInvoices(userId, selectedClient.id);
    setInvoices(refreshedInvoices);
  };

  const calculateStats = (inv = invoice, client = selectedClient, useSaved = false) => {
    if (!inv || !client) return { days: 0, amount: 0, excludedCount: 0 };
    
    // If we want to use saved data (e.g., for history list), check if it exists
    if(useSaved && inv.status === 'generated' && inv.savedAmount !== undefined) {
      return { days: inv.savedDays || 0, amount: inv.savedAmount, excludedCount: 0 };
    }

    // Otherwise calculate dynamically
    let validDays = 0;
    let excludedCount = 0;
    
    // To ensure exact match with calendar display, if the invoice month is same as current view, reuse the memoized days.
    // Otherwise regenerate.
    let daysToIterate;
    const invDateStr = inv.month + '-01';
    
    if (format(currentDate, 'yyyy-MM') === inv.month) {
       daysToIterate = daysInMonth; // Use the same objects as calendar
    } else {
       const date = parseISO(invDateStr);
       daysToIterate = eachDayOfInterval({ start: startOfMonth(date), end: endOfMonth(date) });
    }

    daysToIterate.forEach(day => {
      const isWknd = isWeekend(day);
      const isHol = inv.useGreekHolidays && checkIsHoliday(day);
      const isDefaultNonWorking = isWknd || isHol;
      const isExcluded = inv.excludedDates.some(d => isSameDay(parseISO(d), day));
      const isIncluded = inv.includedDates?.some(d => isSameDay(parseISO(d), day));

      // Hierarchy: Included > Excluded > Default
      if (isIncluded) {
         validDays++;
      } else if (isExcluded) {
         excludedCount++;
      } else if (isDefaultNonWorking) {
         excludedCount++;
      } else {
         validDays++;
      }
    });

    return {
      days: validDays,
      amount: validDays * client.dailyRate,
      excludedCount
    };
  };

  // Editor always uses dynamic stats
  const stats = calculateStats(invoice, selectedClient, false);

  const handleGenerateExcel = async (targetInvoice = invoice, targetStats: any = null) => {
    console.log("Generating Excel...", { targetInvoice, targetStats, selectedClient });
    
    // 1. Validation
    if (!selectedClient) {
      alert("Error: No client selected.");
      return;
    }
    if (!targetInvoice) {
      alert("Error: No invoice record found.");
      return;
    }
    if (!selectedClient.templateBase64) {
      alert("Error: No template uploaded for this client.");
      return;
    }

    try {
      // 2. Prepare Stats & Data
      const isCurrentEditorInvoice = targetInvoice.id === invoice?.id;
      const finalStats = targetStats || calculateStats(targetInvoice, selectedClient, !isCurrentEditorInvoice);
      const invNum = isCurrentEditorInvoice ? invoiceNumberInput : (targetInvoice.invoiceNumber || "");
      
      if (!invNum || !invNum.trim()) {
        alert("Please enter an Invoice Number.");
        return;
      }

      console.log("Loading ExcelJS...");
      // Check ExcelJS
      if (!ExcelJS || !ExcelJS.Workbook) {
          throw new Error("ExcelJS library is not loaded correctly.");
      }

      // 3. Decode Template
      const binaryString = window.atob(selectedClient.templateBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const buffer = bytes.buffer;

      // 4. Load Workbook
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0]; 
      
      // Force Excel to recalculate formulas when opened
      workbook.calcProperties.fullCalcOnLoad = true; 

      const mapping = selectedClient.mapping;
      const setCell = (cellAddr: string, val: any) => {
        if (!cellAddr) return;
        try {
            const cell = worksheet.getCell(cellAddr);
            cell.value = val;
        } catch(e) { console.warn("Invalid cell address:", cellAddr); }
      };

      // Set date to always be the end of the month
      const invDate = format(endOfMonth(parseISO(`${targetInvoice.month}-01`)), 'dd/MM/yyyy');
      
      // Description Logic: Only overwrite if the template cell is empty OR contains numbers (variables)
      if (mapping.description) {
        try {
           const descCell = worksheet.getCell(mapping.description);
           // Check if formula - if so, leave it alone
           const isFormula = descCell.value && typeof descCell.value === 'object' && 'formula' in descCell.value;
           
           if (!isFormula) {
             const currentDescVal = descCell.value ? descCell.value.toString() : '';
             
             if (!currentDescVal.trim()) {
               // Case 1: Empty Description -> Generate standard string
               const monthName = format(parseISO(`${targetInvoice.month}-01`), 'MMMM');
               const year = format(parseISO(`${targetInvoice.month}-01`), 'yyyy');
               
               let newDesc = `Consulting Services for ${monthName} ${year}`;
               // If there is no specific 'daysWorked' column mapped, we usually want the days count in description
               if (!mapping.daysWorked) {
                  newDesc += ` (${finalStats.days} days)`;
               }
               descCell.value = newDesc;
             } else {
               // Case 2: Existing Description -> Preserve text, replace day count number if pattern exists
               // Look for "X days", "X units/working days", etc.
               // We look for a number, followed by up to 50 non-digit characters (to allow text like " units/working "), then "days".
               // This prevents matching years (e.g. 2024) unless they are immediately followed by "days" without intervening digits.
               const daysPattern = /(\d+)(\D{0,50}days?)/i;
               if (daysPattern.test(currentDescVal)) {
                  descCell.value = currentDescVal.replace(daysPattern, `${finalStats.days}$2`);
               }
               // If no pattern is found, we assume the user's template text is static or doesn't include days count.
             }
           }
        } catch(e) { console.warn("Invalid description cell address", e); }
      }

      setCell(mapping.date, invDate);
      setCell(mapping.invoiceNumber, invNum);
      setCell(mapping.daysWorked, finalStats.days);
      setCell(mapping.dailyRate, selectedClient.dailyRate);
      setCell(mapping.totalAmount, finalStats.amount);
      // Description handled above to respect template content

      const outBuffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([outBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      
      // Construct filename: <invoice-number>-<client_name_with_underscores>-Invoice-<MONTH>-<YEAR>
      const dateObj = parseISO(`${targetInvoice.month}-01`);
      const monthName = format(dateObj, 'MMMM').toUpperCase();
      const year = format(dateObj, 'yyyy');
      const safeClientName = (selectedClient.name || 'Client').replace(/\s+/g, '_');
      const fileName = `${invNum}-${safeClientName}-Invoice-${monthName}-${year}.xlsx`;
      
      anchor.download = fileName;
      anchor.click();
      window.URL.revokeObjectURL(url);
      
      // Update status if it's the current one (effectively "deletes" the old history record by overwriting it with new generation data)
      if (isCurrentEditorInvoice) {
        const updated = {
          ...targetInvoice,
          status: 'generated' as const,
          invoiceNumber: invNum,
          savedAmount: finalStats.amount,
          savedDays: finalStats.days,
          generatedDate: invDate
        };
        setInvoice(updated);
        await DB.saveInvoice({ ...updated, userId });
        // Refresh invoices list
        const refreshedInvoices = await DB.getInvoices(userId, selectedClient.id);
        setInvoices(refreshedInvoices);
      }

    } catch (e: any) {
      console.error("Generate Error:", e);
      alert(`Failed to generate Excel: ${e.message || e}`);
    }
  };

  if (clients.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500 dark:text-slate-400">
        <p>Please create a client first.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left Panel: Configuration */}
      <div className="w-80 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 p-6 overflow-y-auto flex flex-col h-full">
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Select Client</label>
          <select 
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
          >
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Sub Tabs */}
        <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg mb-6">
          <button 
            onClick={() => setSubTab('new')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${subTab === 'new' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            New Invoice
          </button>
          <button 
            onClick={() => setSubTab('history')}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${subTab === 'history' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            History
          </button>
        </div>

        {subTab === 'new' && (
          <>
            <div className="mb-6 flex items-center justify-between">
                <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-600 dark:text-slate-300">
                  <ChevronLeft size={20}/>
                </button>
                <span className="font-bold text-lg text-slate-800 dark:text-white">{format(currentDate, 'MMMM yyyy')}</span>
                <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-600 dark:text-slate-300">
                  <ChevronRight size={20}/>
                </button>
            </div>

            <div className="space-y-4 mb-8">
               <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Exclude Greek Holidays</span>
                  <button 
                    onClick={toggleGreekHolidays}
                    className={`w-10 h-6 rounded-full transition-colors relative ${invoice?.useGreekHolidays ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${invoice?.useGreekHolidays ? 'left-5' : 'left-1'}`} />
                  </button>
               </div>
               {invoice?.useGreekHolidays && (
                 <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                   Fetching data from Public Holidays API (similar to argies.gr)
                 </p>
               )}
            </div>

            <div className="mt-auto bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
               <h3 className="font-semibold text-slate-800 dark:text-slate-200 mb-3">Summary</h3>
               <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4">
                 <div className="flex justify-between">
                   <span className="">Working Days</span>
                   <span className="font-medium text-slate-900 dark:text-white">{stats.days}</span>
                 </div>
                 <div className="flex justify-between">
                   <span className="">Rate</span>
                   <span className="font-medium text-slate-900 dark:text-white">{selectedClient?.currency}{selectedClient?.dailyRate}</span>
                 </div>
                 <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between text-lg font-bold text-indigo-600 dark:text-indigo-400">
                   <span>Total</span>
                   <span>{selectedClient?.currency}{stats.amount.toLocaleString()}</span>
                 </div>
               </div>

               {/* Prominent Invoice Number Input */}
               <div className="mb-4">
                 <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-1">Invoice Number <span className="text-red-500">*</span></label>
                 <input 
                    type="text" 
                    value={invoiceNumberInput}
                    placeholder="e.g. INV-2024-001"
                    onChange={(e) => setInvoiceNumberInput(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-medium focus:border-indigo-500 outline-none"
                 />
               </div>

               <div className="grid grid-cols-1 gap-2 mt-4">
                 <button 
                   onClick={() => handleGenerateExcel(invoice, stats)}
                   disabled={!selectedClient?.templateBase64}
                   className="flex items-center justify-center gap-2 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 disabled:opacity-50 text-base font-medium"
                 >
                   <Download size={18} /> Generate Invoice (Excel)
                 </button>
               </div>
               {!selectedClient?.templateBase64 && (
                 <p className="text-xs text-red-500 mt-2 text-center">No template uploaded.</p>
               )}
            </div>
          </>
        )}
        
        {subTab === 'history' && (
          <div className="space-y-3 h-full overflow-y-auto">
            <h3 className="font-bold text-slate-800 dark:text-white mb-2">Generated Invoices</h3>
            {historyInvoices.length === 0 ? (
               <p className="text-sm text-slate-500 italic">No invoices generated yet.</p>
            ) : (
               historyInvoices.map(rec => (
                 <div key={rec.id} className="bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                   <div className="flex justify-between items-start mb-2">
                     <span className="font-bold text-slate-800 dark:text-white">{rec.month}</span>
                     <div className="flex items-center gap-2">
                       <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">Generated</span>
                       <button
                         onClick={async () => {
                           if (confirm('Are you sure you want to delete this invoice?')) {
                             await DB.deleteInvoice(rec.id);
                             const refreshedInvoices = await DB.getInvoices(userId, selectedClient.id);
                             setInvoices(refreshedInvoices);
                           }
                         }}
                         className="text-slate-400 hover:text-red-500 transition-colors"
                         title="Delete invoice"
                       >
                         <Trash2 size={14} />
                       </button>
                     </div>
                   </div>
                   <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 mb-3">
                     <p>Inv #: {rec.invoiceNumber}</p>
                     <p>Amount: {selectedClient?.currency}{rec.savedAmount?.toLocaleString()}</p>
                   </div>
                   <div className="flex gap-2">
                     <button
                       onClick={() => handleGenerateExcel(rec, calculateStats(rec, selectedClient, true))}
                       className="flex-1 flex items-center justify-center gap-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 py-1.5 rounded text-xs font-medium text-slate-700 dark:text-slate-300"
                     >
                       <FileSpreadsheet size={14} /> Download Again
                     </button>
                   </div>
                 </div>
               ))
            )}
          </div>
        )}
      </div>

      {/* Right Panel: Calendar */}
      <div className="flex-1 p-8 overflow-y-auto bg-slate-50/50 dark:bg-slate-950">
        <h2 className="text-xl font-bold mb-6 text-slate-800 dark:text-white">
          {subTab === 'new' ? 'Working Days Calendar' : `Viewing: ${selectedClient?.name} History`}
        </h2>
        
        {subTab === 'new' ? (
        <>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Click on any day to toggle it as a non-working day (adhoc leave) or a working day (overtime).</p>
            <div className="grid grid-cols-7 gap-4">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                <div key={d} className="text-center text-sm font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">{d}</div>
            ))}
            
            {/* Pad start of month - Start on Monday */}
            {Array.from({ length: (startOfMonth(currentDate).getDay() + 6) % 7 }).map((_, i) => (
                <div key={`pad-${i}`} />
            ))}

            {daysInMonth.map(day => {
                const isWknd = isWeekend(day);
                const holidayName = invoice?.useGreekHolidays ? getHolidayName(day) : undefined;
                const isHol = !!holidayName;
                const isDefaultNonWorking = isWknd || isHol;
                
                const isExcluded = invoice?.excludedDates.some(d => isSameDay(parseISO(d), day));
                const isIncluded = invoice?.includedDates?.some(d => isSameDay(parseISO(d), day));
                
                // Effective Status
                // If Included: Working (On)
                // If Excluded: Not Working (Off)
                // If Default NonWorking: Not Working (Off) unless Included
                const isOff = (isDefaultNonWorking && !isIncluded) || isExcluded;
                
                return (
                <button
                    key={day.toISOString()}
                    onClick={() => toggleDayStatus(day)}
                    className={`
                    h-24 rounded-xl border flex flex-col items-start p-3 transition-all relative
                    ${isOff 
                        ? 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-600' 
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-md text-slate-800 dark:text-white'}
                    ${isExcluded ? 'ring-2 ring-red-200 dark:ring-red-900/50 bg-red-50 dark:bg-red-900/10' : ''}
                    ${isIncluded ? 'ring-2 ring-green-200 dark:ring-green-900/50 bg-green-50 dark:bg-green-900/10' : ''}
                    `}
                >
                    <span className={`font-medium text-lg ${isOff ? 'text-slate-400 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200'}`}>{format(day, 'd')}</span>
                    
                    <div className="mt-auto flex flex-col items-start gap-1 w-full">
                    {isWknd && <span className="text-xs px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-slate-500 dark:text-slate-400">Weekend</span>}
                    {isHol && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded leading-tight text-left w-full break-words">
                            {holidayName}
                        </span>
                    )}
                    {isExcluded && <span className="text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded">Off</span>}
                    {isIncluded && <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded">Extra</span>}
                    </div>
                </button>
                );
            })}
            </div>
        </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <History size={48} className="mb-4 text-slate-300 dark:text-slate-700" />
            <p className="text-lg">Select an invoice from the history list on the left to re-download.</p>
            <p className="text-sm mt-2">Historical data is preserved.</p>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard'); // dashboard | generator
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [viewState, setViewState] = useState<'list' | 'edit'>('list');
  const [targetClientId, setTargetClientId] = useState<string | undefined>();
  
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
      }}
      theme={theme}
      toggleTheme={toggleTheme}
      authComponent={<Auth user={user} onAuthChange={() => {}} />}
    >
      {!user ? (
        <div className="flex flex-col items-center justify-center h-full p-8">
          <div className="text-center max-w-md">
            <FileText className="mx-auto mb-4 text-indigo-600" size={64} />
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Welcome to SmartInvoice</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-6">Please sign in or create an account to manage your invoices.</p>
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
              <Auth user={user} onAuthChange={() => {}} />
            </div>
          </div>
        </div>
      ) : (
        <>
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

          {activeTab === 'generator' && (
            <InvoiceGenerator userId={user.uid} clientId={targetClientId} />
          )}
        </>
      )}
    </Layout>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
