/**
 * Database Service
 * 
 * Firestore operations for:
 * - Clients (existing)
 * - Work Records (new)
 * - Documents (new - replaces invoices)
 * - Invoices (legacy, for migration)
 */

import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  Timestamp,
  DocumentReference,
  DocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type {
  Client,
  WorkRecord,
  WorkRecordInput,
  Document,
  DocumentInput,
  InvoiceRecord,
} from '../types';

// ============================================
// Collection References
// ============================================

const COLLECTIONS = {
  CLIENTS: 'clients',
  WORK_RECORDS: 'workRecords',
  DOCUMENTS: 'documents',
  INVOICES: 'invoices', // Legacy
} as const;

// ============================================
// Client Operations (Existing)
// ============================================

export async function getClients(userId: string): Promise<Client[]> {
  try {
    const q = query(
      collection(db, COLLECTIONS.CLIENTS),
      where('userId', '==', userId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Client));
  } catch (e) {
    console.error('Error fetching clients:', e);
    return [];
  }
}

export async function saveClient(client: Client): Promise<void> {
  try {
    const clientRef = doc(db, COLLECTIONS.CLIENTS, client.id);
    await setDoc(clientRef, client, { merge: true });
  } catch (e) {
    console.error('Error saving client:', e);
    throw e;
  }
}

export async function deleteClient(id: string): Promise<void> {
  try {
    // Delete the client
    await deleteDoc(doc(db, COLLECTIONS.CLIENTS, id));
    
    // Delete all associated work records (and their documents)
    const workRecordsSnapshot = await getDocs(
      query(collection(db, COLLECTIONS.WORK_RECORDS), where('clientId', '==', id))
    );
    
    for (const wrDoc of workRecordsSnapshot.docs) {
      // Delete documents associated with this work record
      const documentsSnapshot = await getDocs(
        query(collection(db, COLLECTIONS.DOCUMENTS), where('workRecordId', '==', wrDoc.id))
      );
      await Promise.all(documentsSnapshot.docs.map(d => deleteDoc(d.ref)));
      
      // Delete the work record
      await deleteDoc(wrDoc.ref);
    }
    
    // Also delete legacy invoices
    const invoicesSnapshot = await getDocs(
      query(collection(db, COLLECTIONS.INVOICES), where('clientId', '==', id))
    );
    await Promise.all(invoicesSnapshot.docs.map(d => deleteDoc(d.ref)));
  } catch (e) {
    console.error('Error deleting client:', e);
    throw e;
  }
}

// ============================================
// Work Record Operations (NEW)
// ============================================

export async function getWorkRecords(
  userId: string,
  clientId?: string
): Promise<WorkRecord[]> {
  try {
    const constraints: any[] = [where('userId', '==', userId)];
    if (clientId) {
      constraints.push(where('clientId', '==', clientId));
    }
    
    const q = query(collection(db, COLLECTIONS.WORK_RECORDS), ...constraints);
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map((doc) => ({
      ...doc.data(),
      id: doc.id,
    } as WorkRecord));
  } catch (e) {
    console.error('Error fetching work records:', e);
    return [];
  }
}

export async function getWorkRecordById(id: string): Promise<WorkRecord | null> {
  try {
    const docRef = doc(db, COLLECTIONS.WORK_RECORDS, id);
    const snapshot = await getDoc(docRef);
    
    if (!snapshot.exists()) return null;
    
    return { ...snapshot.data(), id: snapshot.id } as WorkRecord;
  } catch (e) {
    console.error('Error fetching work record:', e);
    return null;
  }
}

export async function getWorkRecordByMonth(
  userId: string,
  clientId: string,
  month: string
): Promise<WorkRecord | null> {
  try {
    const q = query(
      collection(db, COLLECTIONS.WORK_RECORDS),
      where('userId', '==', userId),
      where('clientId', '==', clientId),
      where('month', '==', month)
    );
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) return null;
    
    // Return the first match (should only be one per client/month)
    const doc = snapshot.docs[0];
    return { ...doc.data(), id: doc.id } as WorkRecord;
  } catch (e) {
    console.error('Error fetching work record by month:', e);
    return null;
  }
}

export async function saveWorkRecord(
  userId: string,
  workRecord: WorkRecordInput,
  existingId?: string
): Promise<WorkRecord> {
  try {
    const id = existingId || crypto.randomUUID();
    const now = new Date().toISOString();
    
    console.log('DB: Saving work record', { id, userId, existingId });
    
    // Clean undefined values for Firestore
    const cleanWorkRecord: WorkRecordInput = {
      ...workRecord,
      notes: workRecord.notes || null,
      holidayNames: workRecord.holidayNames || null,
    };
    
    const workRecordData: Omit<WorkRecord, 'id'> = {
      ...cleanWorkRecord,
      userId,
      createdAt: existingId ? (await getWorkRecordById(existingId))?.createdAt || now : now,
      updatedAt: now,
    };
    
    console.log('DB: Work record data prepared', workRecordData);
    
    const workRecordRef = doc(db, COLLECTIONS.WORK_RECORDS, id);
    await setDoc(workRecordRef, workRecordData, { merge: true });
    
    console.log('DB: Work record saved successfully');
    
    return { ...workRecordData, id };
  } catch (e: any) {
    console.error('DB: Error saving work record:', e);
    console.error('DB: Error code:', e?.code);
    console.error('DB: Error message:', e?.message);
    throw e;
  }
}

export async function deleteWorkRecord(id: string): Promise<void> {
  try {
    // First delete all associated documents
    const documentsSnapshot = await getDocs(
      query(collection(db, COLLECTIONS.DOCUMENTS), where('workRecordId', '==', id))
    );
    await Promise.all(documentsSnapshot.docs.map(d => deleteDoc(d.ref)));
    
    // Then delete the work record
    await deleteDoc(doc(db, COLLECTIONS.WORK_RECORDS, id));
  } catch (e) {
    console.error('Error deleting work record:', e);
    throw e;
  }
}

// ============================================
// Document Operations (NEW)
// ============================================

export async function getDocuments(
  userId: string,
  filters?: {
    clientId?: string;
    workRecordId?: string;
    type?: 'invoice' | 'timesheet';
  }
): Promise<Document[]> {
  try {
    const constraints: any[] = [where('userId', '==', userId)];
    
    if (filters?.clientId) {
      constraints.push(where('clientId', '==', filters.clientId));
    }
    if (filters?.workRecordId) {
      constraints.push(where('workRecordId', '==', filters.workRecordId));
    }
    if (filters?.type) {
      constraints.push(where('type', '==', filters.type));
    }
    
    const q = query(collection(db, COLLECTIONS.DOCUMENTS), ...constraints);
    const snapshot = await getDocs(q);
    
    return snapshot.docs
      .map((doc) => ({ ...doc.data(), id: doc.id } as Document))
      .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
  } catch (e) {
    console.error('Error fetching documents:', e);
    return [];
  }
}

export async function getDocumentById(id: string): Promise<Document | null> {
  try {
    const docRef = doc(db, COLLECTIONS.DOCUMENTS, id);
    const snapshot = await getDoc(docRef);
    
    if (!snapshot.exists()) return null;
    
    return { ...snapshot.data(), id: snapshot.id } as Document;
  } catch (e) {
    console.error('Error fetching document:', e);
    return null;
  }
}

export async function saveDocument(
  userId: string,
  document: DocumentInput,
  existingId?: string
): Promise<Document> {
  try {
    const id = existingId || crypto.randomUUID();
    
    const documentData: Omit<Document, 'id'> = {
      ...document,
      userId,
      generatedAt: new Date().toISOString(),
    };
    
    const documentRef = doc(db, COLLECTIONS.DOCUMENTS, id);
    await setDoc(documentRef, documentData, { merge: true });
    
    return { ...documentData, id };
  } catch (e) {
    console.error('Error saving document:', e);
    throw e;
  }
}

export async function deleteDocument(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTIONS.DOCUMENTS, id));
  } catch (e) {
    console.error('Error deleting document:', e);
    throw e;
  }
}

export async function markDocumentAsPaid(
  id: string,
  paid: boolean = true
): Promise<void> {
  try {
    const documentRef = doc(db, COLLECTIONS.DOCUMENTS, id);
    await setDoc(
      documentRef,
      {
        isPaid: paid,
        paidAt: paid ? new Date().toISOString() : null,
      },
      { merge: true }
    );
  } catch (e) {
    console.error('Error marking document as paid:', e);
    throw e;
  }
}

/**
 * Check and mark documents as outdated if their saved working days differ from current
 * Called when a work record is updated
 */
export async function markDocumentsAsOutdated(
  workRecordId: string,
  currentWorkingDays: string[]
): Promise<void> {
  try {
    const q = query(
      collection(db, COLLECTIONS.DOCUMENTS),
      where('workRecordId', '==', workRecordId)
    );
    
    const snapshot = await getDocs(q);
    const now = new Date().toISOString();
    
    // Sort current working days for comparison
    const sortedCurrent = [...currentWorkingDays].sort();
    
    const updatePromises = snapshot.docs.map((docSnapshot) => {
      const docData = docSnapshot.data() as Document;
      const savedDays = docData.workingDaysArray || [];
      
      // Skip if already marked as outdated
      if (docData.isOutdated) {
        return Promise.resolve();
      }
      
      // Compare working days arrays
      // If savedDays is empty (migrated document), mark as outdated to be safe
      const isOutdated = savedDays.length === 0 ||
        savedDays.length !== sortedCurrent.length ||
        savedDays.slice().sort().some((day, index) => day !== sortedCurrent[index]);
      
      if (isOutdated) {
        return setDoc(
          docSnapshot.ref,
          {
            isOutdated: true,
            outdatedAt: now,
          },
          { merge: true }
        );
      }
      
      return Promise.resolve();
    });
    
    await Promise.all(updatePromises);
    console.log(`Checked documents for work record ${workRecordId}, marked as outdated where needed`);
  } catch (e) {
    console.error('Error marking documents as outdated:', e);
    throw e;
  }
}

/**
 * Clear the outdated flag from a document
 * Called when a new document is generated to replace an outdated one
 */
export async function clearDocumentOutdatedFlag(id: string): Promise<void> {
  try {
    const documentRef = doc(db, COLLECTIONS.DOCUMENTS, id);
    await setDoc(
      documentRef,
      {
        isOutdated: false,
        outdatedAt: null,
      },
      { merge: true }
    );
  } catch (e) {
    console.error('Error clearing document outdated flag:', e);
    throw e;
  }
}

// ============================================
// Legacy Invoice Operations (for migration)
// ============================================

/**
 * @deprecated Use getDocuments instead
 */
export async function getInvoices(
  userId: string,
  clientId?: string
): Promise<InvoiceRecord[]> {
  try {
    const constraints: any[] = [where('userId', '==', userId)];
    if (clientId) {
      constraints.push(where('clientId', '==', clientId));
    }
    
    const q = query(collection(db, COLLECTIONS.INVOICES), ...constraints);
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as InvoiceRecord));
  } catch (e) {
    console.error('Error fetching invoices:', e);
    return [];
  }
}

/**
 * @deprecated Use saveDocument instead
 */
export async function saveInvoice(invoice: InvoiceRecord): Promise<void> {
  try {
    const invoiceRef = doc(db, COLLECTIONS.INVOICES, invoice.id);
    await setDoc(invoiceRef, invoice, { merge: true });
  } catch (e) {
    console.error('Error saving invoice:', e);
    throw e;
  }
}

/**
 * @deprecated Use deleteDocument instead
 */
export async function deleteInvoice(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTIONS.INVOICES, id));
  } catch (e) {
    console.error('Error deleting invoice:', e);
    throw e;
  }
}