/**
 * Database Service
 *
 * Firestore operations for:
 * - Clients
 * - Work Records
 * - Documents (invoices & timesheets)
 * - Timesheets (configuration)
 * - Templates
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
  deleteField,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type {
  Client,
  WorkRecord,
  WorkRecordInput,
  Document,
  DocumentInput,
  WorkRecordTimesheet,
  WorkRecordTimesheetInput,
  Template,
} from '../types';
import {
  uploadTemplate as uploadTemplateToStorage,
  deleteTemplateFile,
  uploadDocument as uploadDocumentToStorage,
  deleteDocumentFile,
} from './storage';

// ============================================
// Collection References
// ============================================

const COLLECTIONS = {
  CLIENTS: 'clients',
  WORK_RECORDS: 'workRecords',
  DOCUMENTS: 'documents',
  TIMESHEETS: 'timesheets',
  TEMPLATES: 'templates',
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

    // Sanitize client object to remove undefined values which Firestore doesn't support
    // We convert undefined to null to ensure fields are properly reset if needed
    const clientData = {
      ...client,
      issuerName: client.issuerName ?? null,
      issuerDetails: client.issuerDetails ?? null,
      mapping: client.mapping ?? null,
      defaultUseGreekHolidays: client.defaultUseGreekHolidays ?? null,
      // Template references (new structure)
      invoiceTemplateId: client.invoiceTemplateId ?? null,
      timesheetTemplateId: client.timesheetTemplateId ?? null,
      // Template metadata (for display purposes only)
      invoiceTemplateFileName: client.invoiceTemplateFileName ?? null,
      timesheetTemplateFileName: client.timesheetTemplateFileName ?? null,
      timesheetPrompt: client.timesheetPrompt ?? null,
      timesheetMapping: client.timesheetMapping ?? null,
    };

    await setDoc(clientRef, clientData, { merge: true });
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
    } catch (e) {
    console.error('Error deleting client:', e);
    throw e;
  }
}

// ============================================
// Template Operations (NEW)
// ============================================

export async function getTemplates(userId: string): Promise<Template[]> {
  try {
    const q = query(
      collection(db, COLLECTIONS.TEMPLATES),
      where('userId', '==', userId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Template));
  } catch (e) {
    console.error('Error fetching templates:', e);
    return [];
  }
}

export async function getTemplatesByClient(userId: string, clientId: string): Promise<Template[]> {
  try {
    const q = query(
      collection(db, COLLECTIONS.TEMPLATES),
      where('userId', '==', userId),
      where('clientId', '==', clientId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Template));
  } catch (e) {
    console.error('Error fetching templates by client:', e);
    return [];
  }
}

export async function getTemplateById(id: string): Promise<Template | null> {
  try {
    const docRef = doc(db, COLLECTIONS.TEMPLATES, id);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) return null;

    return { ...snapshot.data(), id: snapshot.id } as Template;
  } catch (e) {
    console.error('Error fetching template:', e);
    return null;
  }
}

export async function saveTemplate(
  template: Template,
  fileData?: File
): Promise<Template> {
  try {
    const now = new Date().toISOString();
    const isNew = !template.id || template.id === '';
    const id = isNew ? crypto.randomUUID() : template.id;

    let storagePath = template.storagePath;
    let downloadUrl = template.downloadUrl;

    // Upload file to Firebase Storage if fileData is provided
    if (fileData) {
      const uploadResult = await uploadTemplateToStorage(
        template.userId,
        template.clientId,
        id,
        template.fileName,
        fileData
      );
      storagePath = uploadResult.storagePath;
      downloadUrl = uploadResult.downloadUrl;
    }

    // storagePath and downloadUrl are required
    if (!storagePath || !downloadUrl) {
      throw new Error('storagePath and downloadUrl are required. Please upload a file.');
    }

    const templateData = {
      userId: template.userId,
      clientId: template.clientId,
      type: template.type,
      name: template.name,
      fileName: template.fileName,
      storagePath,
      downloadUrl,
      mapping: template.mapping ?? null,
      timesheetMapping: template.timesheetMapping ?? null,
      timesheetPrompt: template.timesheetPrompt ?? null,
      createdAt: isNew ? now : (template.createdAt || now),
      updatedAt: now,
    };

    const templateRef = doc(db, COLLECTIONS.TEMPLATES, id);
    await setDoc(templateRef, templateData, { merge: true });

    return { ...templateData, id };
  } catch (e) {
    console.error('Error saving template:', e);
    throw e;
  }
}

export async function deleteTemplate(id: string, storagePath?: string): Promise<void> {
  try {
    // Delete file from Firebase Storage if path exists
    if (storagePath) {
      try {
        await deleteTemplateFile(storagePath);
      } catch (storageError) {
        // Log but don't fail if storage file doesn't exist
        console.warn('Error deleting template file from storage:', storageError);
      }
    }

    // Delete template metadata from Firestore
    await deleteDoc(doc(db, COLLECTIONS.TEMPLATES, id));
  } catch (e) {
    console.error('Error deleting template:', e);
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

    // Fetch from new documents collection
    console.log('[getDocuments] Fetching documents with constraints:', constraints);
    const q = query(collection(db, COLLECTIONS.DOCUMENTS), ...constraints);
    const snapshot = await getDocs(q);
    const documents = snapshot.docs.map((doc) => ({
      ...doc.data(),
      id: doc.id,
    } as Document));

    return documents.sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
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
  existingId?: string,
  fileBlob?: Blob
): Promise<Document> {
  try {
    const id = existingId || crypto.randomUUID();

    let storagePath = document.storagePath;
    let downloadUrl = document.downloadUrl;

    // Upload file to Firebase Storage if fileBlob is provided
    if (fileBlob && document.fileName) {
      const uploadResult = await uploadDocumentToStorage(
        userId,
        document.clientId,
        id,
        document.fileName,
        fileBlob
      );
      storagePath = uploadResult.storagePath;
      downloadUrl = uploadResult.downloadUrl;
    }

    // storagePath and downloadUrl are required
    if (!storagePath || !downloadUrl) {
      throw new Error('storagePath and downloadUrl are required. Please upload a file.');
    }

    // Build document data, handling null values for outdatedAt to properly clear them
    const { outdatedAt, ...otherFields } = document;

    const documentData: any = {
      ...otherFields,
      userId,
      generatedAt: new Date().toISOString(),
      storagePath,
      downloadUrl,
    };

    // Handle outdatedAt specially - if explicitly set to null, use deleteField()
    // Otherwise include the value
    if (outdatedAt === null) {
      // When outdatedAt is null, we want to delete the field from Firestore
      documentData.outdatedAt = deleteField();
    } else if (outdatedAt !== undefined) {
      documentData.outdatedAt = outdatedAt;
    }

    const documentRef = doc(db, COLLECTIONS.DOCUMENTS, id);
    await setDoc(documentRef, documentData, { merge: true });

    return { ...document, userId, generatedAt: documentData.generatedAt, id, storagePath, downloadUrl };
  } catch (e) {
    console.error('Error saving document:', e);
    throw e;
  }
}

export async function deleteDocument(
  id: string,
  storagePath?: string,
  sourceCollection?: 'documents' | 'invoices'
): Promise<void> {
  try {
    // Delete file from Firebase Storage if path exists
    if (storagePath) {
      try {
        await deleteDocumentFile(storagePath);
      } catch (storageError) {
        // Log but don't fail if storage file doesn't exist
        console.warn('Error deleting document file from storage:', storageError);
      }
    }

    // If source collection is specified (for legacy invoices), use it
    // Otherwise default to documents collection
    const collectionName = sourceCollection || COLLECTIONS.DOCUMENTS;
    await deleteDoc(doc(db, collectionName, id));
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
  currentWorkingDays: string[],
  currentWeekendDates?: string[]
): Promise<void> {
  try {
    const q = query(
      collection(db, COLLECTIONS.DOCUMENTS),
      where('workRecordId', '==', workRecordId)
    );

    const snapshot = await getDocs(q);
    const now = new Date().toISOString();

    // Sort current arrays for comparison
    const sortedCurrentWorkingDays = [...currentWorkingDays].sort();
    const sortedCurrentWeekendDates = currentWeekendDates ? [...currentWeekendDates].sort() : null;

    const updatePromises = snapshot.docs.map((docSnapshot) => {
      const docData = docSnapshot.data() as Document;
      const savedDays = docData.workingDaysArray || [];
      const savedWeekendDates = docData.weekendDatesArray || [];

      // Skip if already marked as outdated
      if (docData.isOutdated) {
        return Promise.resolve();
      }

      // Compare working days arrays
      // If savedDays is empty (migrated document), mark as outdated to be safe
      let isOutdated = savedDays.length === 0 ||
        savedDays.length !== sortedCurrentWorkingDays.length ||
        savedDays.slice().sort().some((day, index) => day !== sortedCurrentWorkingDays[index]);

      // Also compare weekend dates if provided
      if (!isOutdated && sortedCurrentWeekendDates) {
        const sortedSavedWeekendDates = [...savedWeekendDates].sort();
        isOutdated = savedWeekendDates.length !== sortedCurrentWeekendDates.length ||
          sortedSavedWeekendDates.some((day, index) => day !== sortedCurrentWeekendDates![index]);
      }

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
        outdatedAt: deleteField(),
      },
      { merge: true }
    );
  } catch (e) {
    console.error('Error clearing document outdated flag:', e);
    throw e;
  }
}

// ============================================
// Timesheet Operations (NEW)
// ============================================

export async function getTimesheetByWorkRecord(
  workRecordId: string
): Promise<WorkRecordTimesheet | null> {
  try {
    const q = query(
      collection(db, COLLECTIONS.TIMESHEETS),
      where('workRecordId', '==', workRecordId)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    return { ...doc.data(), id: doc.id } as WorkRecordTimesheet;
  } catch (e) {
    console.error('Error fetching timesheet:', e);
    return null;
  }
}

export async function getTimesheetsByClient(
  userId: string,
  clientId: string
): Promise<WorkRecordTimesheet[]> {
  try {
    const q = query(
      collection(db, COLLECTIONS.TIMESHEETS),
      where('userId', '==', userId),
      where('clientId', '==', clientId)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({
      ...doc.data(),
      id: doc.id,
    } as WorkRecordTimesheet));
  } catch (e) {
    console.error('Error fetching timesheets:', e);
    return [];
  }
}

export async function saveTimesheet(
  userId: string,
  timesheet: WorkRecordTimesheetInput,
  existingId?: string
): Promise<WorkRecordTimesheet> {
  try {
    const id = existingId || crypto.randomUUID();
    const now = new Date().toISOString();

    // Clean undefined values for Firestore
    const cleanTimesheet: WorkRecordTimesheetInput = {
      ...timesheet,
      templateName: timesheet.templateName || null,
      templateStoragePath: timesheet.templateStoragePath || null,
      prompt: timesheet.prompt || null,
    };

    const timesheetData: Omit<WorkRecordTimesheet, 'id'> = {
      ...cleanTimesheet,
      userId,
      createdAt: existingId ? (await getDoc(doc(db, COLLECTIONS.TIMESHEETS, existingId))).data()?.createdAt || now : now,
      updatedAt: now,
    };

    const timesheetRef = doc(db, COLLECTIONS.TIMESHEETS, id);
    await setDoc(timesheetRef, timesheetData, { merge: true });

    return { ...timesheetData, id };
  } catch (e) {
    console.error('Error saving timesheet:', e);
    throw e;
  }
}

export async function deleteTimesheet(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTIONS.TIMESHEETS, id));
  } catch (e) {
    console.error('Error deleting timesheet:', e);
    throw e;
  }
}

export async function deleteAllClientTimesheets(userId: string, clientId: string): Promise<number> {
  try {
    const q = query(
      collection(db, COLLECTIONS.TIMESHEETS),
      where('userId', '==', userId),
      where('clientId', '==', clientId)
    );

    const snapshot = await getDocs(q);
    const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);

    return snapshot.docs.length;
  } catch (e) {
    console.error('Error deleting all client timesheets:', e);
    throw e;
  }
}

// ============================================
// Firestore Browser - Raw Collection Access
// ============================================

export type CollectionType = 'clients' | 'workRecords' | 'documents' | 'timesheets' | 'templates';

export interface FirestoreDocument {
  id: string;
  collection: CollectionType;
  data: Record<string, unknown>;
}

/**
 * Get all documents from a specific collection (for Firestore browser)
 */
export async function getCollectionData(
  collectionName: CollectionType,
  userId: string
): Promise<FirestoreDocument[]> {
  try {
    const q = query(collection(db, collectionName), where('userId', '==', userId));
    const snapshot = await getDocs(q);

    return snapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      collection: collectionName,
      data: docSnapshot.data() as Record<string, unknown>,
    }));
  } catch (e) {
    console.error(`Error fetching ${collectionName}:`, e);
    return [];
  }
}

/**
 * Delete a document from any collection by ID
 */
export async function deleteDocumentById(
  collectionName: CollectionType,
  id: string
): Promise<void> {
  try {
    await deleteDoc(doc(db, collectionName, id));
  } catch (e) {
    console.error(`Error deleting document from ${collectionName}:`, e);
    throw e;
  }
}

/**
 * Get a single document from any collection
 */
export async function getDocumentByCollectionAndId(
  collectionName: CollectionType,
  id: string
): Promise<FirestoreDocument | null> {
  try {
    const docRef = doc(db, collectionName, id);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) return null;

    return {
      id: snapshot.id,
      collection: collectionName,
      data: snapshot.data() as Record<string, unknown>,
    };
  } catch (e) {
    console.error(`Error fetching document from ${collectionName}:`, e);
    return null;
  }
}