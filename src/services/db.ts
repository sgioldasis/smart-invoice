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
  DocumentStatus,
  StatusHistoryEntry,
  FinalDocumentInfo,
} from '../types';
import {
  uploadTemplate as uploadTemplateToStorage,
  deleteTemplateFile,
  uploadDocument as uploadDocumentToStorage,
  uploadFinalDocument as uploadFinalDocumentToStorage,
  deleteDocumentFile,
  deleteFinalDocument,
  getFileExtension,
  getContentType,
} from './storage';
import {
  createStatusHistoryEntry,
  addStatusToHistory,
  isValidStatusTransition,
} from '../utils/documentStatus';

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

export async function getClients(userEmail: string): Promise<Client[]> {
  try {
    console.log('[getClients] Querying for userEmail:', userEmail);
    // Try userEmail first (new structure)
    const q = query(
      collection(db, COLLECTIONS.CLIENTS),
      where('userEmail', '==', userEmail)
    );
    const snapshot = await getDocs(q);
    
    // If no results, try userId (legacy structure - for backward compatibility)
    if (snapshot.empty) {
      console.log('[getClients] No clients with userEmail, trying userId...');
      const qLegacy = query(
        collection(db, COLLECTIONS.CLIENTS),
        where('userId', '==', userEmail)
      );
      const legacySnapshot = await getDocs(qLegacy);
      console.log('[getClients] Found', legacySnapshot.docs.length, 'clients with userId');
      return legacySnapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Client));
    }
    
    console.log('[getClients] Found', snapshot.docs.length, 'clients');
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

export async function getTemplates(userEmail: string): Promise<Template[]> {
  try {
    const q = query(
      collection(db, COLLECTIONS.TEMPLATES),
      where('userEmail', '==', userEmail)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Template));
  } catch (e) {
    console.error('Error fetching templates:', e);
    return [];
  }
}

export async function getTemplatesByClient(userEmail: string, clientId: string): Promise<Template[]> {
  try {
    const q = query(
      collection(db, COLLECTIONS.TEMPLATES),
      where('userEmail', '==', userEmail),
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
    // Templates are stored at client level (not month-specific)
    if (fileData) {
      const uploadResult = await uploadTemplateToStorage(
        template.userEmail!,
        template.clientName,
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
      clientName: template.clientName,
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
  userEmail: string,
  clientId?: string
): Promise<WorkRecord[]> {
  try {
    console.log('[getWorkRecords] Querying for userEmail:', userEmail);
    const constraints: any[] = [where('userEmail', '==', userEmail)];
    if (clientId) {
      constraints.push(where('clientId', '==', clientId));
    }

    const q = query(collection(db, COLLECTIONS.WORK_RECORDS), ...constraints);
    const snapshot = await getDocs(q);
    console.log('[getWorkRecords] Found', snapshot.docs.length, 'work records');

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
  userEmail: string,
  clientId: string,
  month: string
): Promise<WorkRecord | null> {
  try {
    const q = query(
      collection(db, COLLECTIONS.WORK_RECORDS),
      where('userEmail', '==', userEmail),
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
  userEmail: string,
  workRecord: WorkRecordInput,
  existingId?: string
): Promise<WorkRecord> {
  try {
    const id = existingId || crypto.randomUUID();
    const now = new Date().toISOString();

    console.log('DB: Saving work record', { id, userEmail, existingId });

    // Clean undefined values for Firestore
    const cleanWorkRecord: WorkRecordInput = {
      ...workRecord,
      notes: workRecord.notes || null,
      holidayNames: workRecord.holidayNames || null,
    };

    const workRecordData: Omit<WorkRecord, 'id'> = {
      ...cleanWorkRecord,
      userEmail,
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
    const safeDeleteDoc = async (ref: DocumentReference, context: string): Promise<boolean> => {
      try {
        await deleteDoc(ref);
        return true;
      } catch (err: any) {
        // Legacy/mixed-ownership data can cause permission-denied on related docs.
        // Keep deleting what we can, and only fail hard on the primary work record.
        if (err?.code === 'permission-denied') {
          console.warn(`[deleteWorkRecord] Skipping ${context} due to permission-denied`, err);
          return false;
        }
        throw err;
      }
    };

    // First delete all associated documents and their storage files
    const documentsSnapshot = await getDocs(
      query(collection(db, COLLECTIONS.DOCUMENTS), where('workRecordId', '==', id))
    );
    
    // Delete all storage files associated with documents
    for (const docSnapshot of documentsSnapshot.docs) {
      const docData = docSnapshot.data() as Document;
      
      // 1. Delete generated document file (storagePath)
      if (docData.storagePath) {
        try {
          await deleteDocumentFile(docData.storagePath);
          console.log(`Deleted storage file: ${docData.storagePath}`);
        } catch (storageError) {
          console.warn(`Failed to delete storage file ${docData.storagePath}:`, storageError);
          // Continue even if storage deletion fails
        }
      }
      
      // 2. Delete legacy final document (finalStoragePath)
      if (docData.finalStoragePath) {
        try {
          await deleteFinalDocument(docData.finalStoragePath);
          console.log(`Deleted legacy final document: ${docData.finalStoragePath}`);
        } catch (storageError) {
          console.warn(`Failed to delete legacy final document ${docData.finalStoragePath}:`, storageError);
        }
      }
      
      // 3. Delete all final documents in the finalDocuments array
      if (docData.finalDocuments && Array.isArray(docData.finalDocuments)) {
        for (const finalDoc of docData.finalDocuments) {
          if (finalDoc.storagePath) {
            try {
              await deleteFinalDocument(finalDoc.storagePath);
              console.log(`Deleted final document: ${finalDoc.storagePath}`);
            } catch (storageError) {
              console.warn(`Failed to delete final document ${finalDoc.storagePath}:`, storageError);
            }
          }
        }
      }
    }
    
    // Then delete the Firestore document records (best-effort)
    await Promise.all(
      documentsSnapshot.docs.map((d) => safeDeleteDoc(d.ref, `document ${d.id}`))
    );
    
    // Delete associated timesheet configuration
    const timesheetSnapshot = await getDocs(
      query(collection(db, COLLECTIONS.TIMESHEETS), where('workRecordId', '==', id))
    );
    await Promise.all(
      timesheetSnapshot.docs.map((d) => safeDeleteDoc(d.ref, `timesheet ${d.id}`))
    );

    // Finally delete the work record
    const deletedMain = await safeDeleteDoc(
      doc(db, COLLECTIONS.WORK_RECORDS, id),
      `workRecord ${id}`
    );

    if (!deletedMain) {
      throw new Error('Permission denied while deleting the work record');
    }
    
    console.log(`Successfully deleted work record ${id} and all associated documents/files`);
  } catch (e) {
    console.error('Error deleting work record:', e);
    throw e;
  }
}

// ============================================
// Document Operations (NEW)
// ============================================

export async function getDocuments(
  userEmail: string,
  filters?: {
    clientId?: string;
    workRecordId?: string;
    type?: 'invoice' | 'timesheet';
  }
): Promise<Document[]> {
  try {
    // Query by userEmail (new field)
    const constraints: any[] = [where('userEmail', '==', userEmail)];

    if (filters?.clientId) {
      constraints.push(where('clientId', '==', filters.clientId));
    }
    if (filters?.workRecordId) {
      constraints.push(where('workRecordId', '==', filters.workRecordId));
    }
    if (filters?.type) {
      constraints.push(where('type', '==', filters.type));
    }

    // Fetch documents by userEmail
    console.log('[getDocuments] Fetching documents with constraints:', constraints);
    console.log('[getDocuments] Querying for userEmail:', userEmail);
    const q = query(collection(db, COLLECTIONS.DOCUMENTS), ...constraints);
    const snapshot = await getDocs(q);
    console.log('[getDocuments] Found', snapshot.docs.length, 'documents');
    
    // Debug: log first doc to see its fields
    if (snapshot.docs.length > 0) {
      const firstDoc = snapshot.docs[0].data();
      console.log('[getDocuments] First doc fields:', Object.keys(firstDoc));
      console.log('[getDocuments] First doc userEmail:', firstDoc.userEmail);
      console.log('[getDocuments] First doc userId:', firstDoc.userId);
    }
    
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
  userEmail: string,
  document: DocumentInput,
  existingId?: string,
  fileBlob?: Blob
): Promise<Document> {
  try {
    const id = existingId || crypto.randomUUID();
    const now = new Date().toISOString();

    let storagePath = document.storagePath;
    let downloadUrl = document.downloadUrl;

    // Upload file to Firebase Storage if fileBlob is provided
    // Documents are stored in type-specific folders: {clientName}/{month}/{type}/{filename}
    if (fileBlob && document.fileName) {
      const uploadResult = await uploadDocumentToStorage(
        userEmail,
        document.clientName,
        document.month, // YYYY-MM format
        document.fileName,
        fileBlob,
        undefined, // contentType - use default
        undefined, // onProgress - no progress tracking for generated docs
        document.type // Pass document type to organize into invoice/timesheet folders
      );
      storagePath = uploadResult.storagePath;
      downloadUrl = uploadResult.downloadUrl;
    }

    // storagePath and downloadUrl are required
    if (!storagePath || !downloadUrl) {
      throw new Error('storagePath and downloadUrl are required. Please upload a file.');
    }

    // Build document data with status tracking
    const { outdatedAt, ...otherFields } = document;

    const documentData: any = {
      ...otherFields,
      userEmail: userEmail,
      generatedAt: document.generatedAt || now,
      storagePath,
      downloadUrl,
    };

    // Handle status: only set status for new documents, preserve for existing
    if (!existingId) {
      // New document - set initial status
      documentData.status = 'generated';
      documentData.statusHistory = [
        createStatusHistoryEntry('generated', 'Document generated from template'),
      ];
    }
    // For existing documents, don't overwrite status - let merge: true preserve existing fields

    // Add final document fields if provided
    if (document.finalStoragePath) {
      documentData.finalStoragePath = document.finalStoragePath;
    }
    if (document.finalDownloadUrl) {
      documentData.finalDownloadUrl = document.finalDownloadUrl;
    }
    if (document.finalFileName) {
      documentData.finalFileName = document.finalFileName;
    }

    // Add status date fields if provided
    if (document.finalizedAt) {
      documentData.finalizedAt = document.finalizedAt;
    }
    if (document.sentAt) {
      documentData.sentAt = document.sentAt;
    }
    if (document.paidAt) {
      documentData.paidAt = document.paidAt;
    }

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

    // Fetch the updated document to return complete data
    const updatedDoc = await getDoc(documentRef);
    const finalData = updatedDoc.data() as Document;

    return {
      ...finalData,
      id,
    };
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

// ============================================
// Document Status Operations (NEW)
// ============================================

/**
 * Update document status with history tracking
 * Validates the transition and adds entry to status history
 */
export async function updateDocumentStatus(
  userEmail: string,
  documentId: string,
  newStatus: DocumentStatus,
  note?: string
): Promise<void> {
  try {
    // Get current document
    const documentRef = doc(db, COLLECTIONS.DOCUMENTS, documentId);
    const documentSnap = await getDoc(documentRef);

    if (!documentSnap.exists()) {
      throw new Error('Document not found');
    }

    const document = documentSnap.data() as Document;

    // Verify ownership
    if (document.userEmail !== userEmail) {
      throw new Error('Not authorized to update this document');
    }

    // Validate status transition
    if (!isValidStatusTransition(document.status, newStatus, document.type)) {
      throw new Error(
        `Invalid status transition from ${document.status} to ${newStatus} for ${document.type}`
      );
    }

    const now = new Date().toISOString();

    // Build update data
    const updateData: any = {
      status: newStatus,
      updatedAt: now,
    };

    // Add status-specific date field
    switch (newStatus) {
      case 'excel-uploaded':
      case 'pdf-uploaded':
        updateData.finalizedAt = now;
        break;
      case 'sent':
        updateData.sentAt = now;
        break;
      case 'paid':
        updateData.paidAt = now;
        // Also update legacy fields
        updateData.isPaid = true;
        break;
    }

    // Add to status history
    updateData.statusHistory = addStatusToHistory(
      document.statusHistory || [],
      newStatus,
      note
    );

    await setDoc(documentRef, updateData, { merge: true });
  } catch (e) {
    console.error('Error updating document status:', e);
    throw e;
  }
}

/**
 * Upload a final version of a document and update status to 'final'
 * Files are stored with their exact filename - same filename will overwrite
 */
export async function uploadFinalDocument(
  userEmail: string,
  documentId: string,
  file: File,
  clientName: string,
  note?: string,
  onProgress?: (progress: number) => void
): Promise<{ finalStoragePath: string; finalDownloadUrl: string }> {
  try {
    // Get current document
    const documentRef = doc(db, COLLECTIONS.DOCUMENTS, documentId);
    const documentSnap = await getDoc(documentRef);

    if (!documentSnap.exists()) {
      throw new Error('Document not found');
    }

    const document = documentSnap.data() as Document;

    // Verify ownership
    if (document.userEmail !== userEmail) {
      throw new Error('Not authorized to update this document');
    }

    // Validate that we can transition to uploaded status
    const currentStatus = document.status;
    const canTransition =
      currentStatus === 'generated' ||
      currentStatus === 'excel-uploaded' ||
      currentStatus === 'pdf-uploaded' ||
      currentStatus === 'sent';

    if (!canTransition) {
      throw new Error(
        `Cannot upload final version when document is in ${currentStatus} status`
      );
    }

    // Check if there's an existing final document with the SAME filename (same file type)
    // Different filenames = different files (e.g., PDF vs Excel), keep both in finalDocuments array
    const existingFinalDocIndex = document.finalDocuments?.findIndex(
      (fd) => fd.fileName === file.name
    );

    // Also check legacy final document
    const hasLegacyFinalWithSameName = document.finalFileName === file.name;

    // Delete existing file from storage only if same filename (same file type)
    if (existingFinalDocIndex !== undefined && existingFinalDocIndex >= 0) {
      const existingDoc = document.finalDocuments![existingFinalDocIndex];
      try {
        await deleteFinalDocument(existingDoc.storagePath);
      } catch (e) {
        console.warn('Failed to delete existing final file:', e);
      }
    } else if (hasLegacyFinalWithSameName && document.finalStoragePath) {
      try {
        await deleteFinalDocument(document.finalStoragePath);
      } catch (e) {
        console.warn('Failed to delete existing final file:', e);
      }
    }

    // Upload new final file with progress tracking
    // Include document type in the path to separate invoices and timesheets
    const uploadResult = await uploadFinalDocumentToStorage(
      userEmail,
      clientName,
      document.month,
      file.name,
      file,
      undefined,
      onProgress,
      document.type
    );

    const now = new Date().toISOString();

    // Get file extension for the new final document entry
    const fileExt = file.name.toLowerCase().split('.').pop() || '';

    // Create the new final document info
    const newFinalDoc: FinalDocumentInfo = {
      id: crypto.randomUUID(),
      fileName: file.name,
      storagePath: uploadResult.finalStoragePath,
      downloadUrl: uploadResult.finalDownloadUrl,
      contentType: file.type || getContentType(file.name),
      fileExtension: fileExt,
      uploadedAt: now,
      note: note || 'Final version uploaded',
    };

    // Build the updated finalDocuments array
    // Preserve existing documents with different filenames (e.g., PDF when uploading Excel)
    let updatedFinalDocuments: FinalDocumentInfo[] = [];

    if (document.finalDocuments && document.finalDocuments.length > 0) {
      // Filter out any document with the same filename (we're replacing it)
      updatedFinalDocuments = document.finalDocuments.filter(
        (fd) => fd.fileName !== file.name
      );
    }

    // Add the new final document
    updatedFinalDocuments.push(newFinalDoc);

    // Also migrate legacy final document if it exists and has different filename
    if (
      document.finalFileName &&
      document.finalStoragePath &&
      document.finalDownloadUrl &&
      document.finalFileName !== file.name &&
      !updatedFinalDocuments.some((fd) => fd.fileName === document.finalFileName)
    ) {
      const legacyExt = document.finalFileName.toLowerCase().split('.').pop() || '';
      const legacyContentType = getContentType(document.finalFileName);
      updatedFinalDocuments.push({
        id: crypto.randomUUID(),
        fileName: document.finalFileName,
        storagePath: document.finalStoragePath,
        downloadUrl: document.finalDownloadUrl,
        contentType: legacyContentType,
        fileExtension: legacyExt,
        uploadedAt: document.finalizedAt || now,
        note: 'Migrated from legacy final document',
      });
    }

    // Update document with final version info and status
    const updateData: any = {
      // Legacy fields for backward compatibility (set to the most recently uploaded)
      finalStoragePath: uploadResult.finalStoragePath,
      finalDownloadUrl: uploadResult.finalDownloadUrl,
      finalFileName: file.name,
      // New array-based storage
      finalDocuments: updatedFinalDocuments,
      updatedAt: now,
    };

    // Determine file type for status
    const fileExtension = file.name.toLowerCase().split('.').pop() || '';
    const isPdf = fileExtension === 'pdf';
    const newStatus: DocumentStatus = isPdf ? 'pdf-uploaded' : 'excel-uploaded';
    const statusNote = note || (isPdf ? 'PDF uploaded' : 'Excel uploaded');

    // Update status if transitioning from generated
    if (currentStatus === 'generated') {
      updateData.status = newStatus;
      updateData.finalizedAt = now;
      updateData.statusHistory = addStatusToHistory(
        document.statusHistory || [],
        newStatus,
        statusNote
      );
    } else {
      // Just add to history for re-uploads
      updateData.statusHistory = addStatusToHistory(
        document.statusHistory || [],
        newStatus,
        statusNote
      );
    }

    await setDoc(documentRef, updateData, { merge: true });

    return uploadResult;
  } catch (e) {
    console.error('Error uploading final document:', e);
    throw e;
  }
}

/**
 * Mark document as sent to client
 * Optionally accepts a custom date for the sent timestamp
 */
export async function markDocumentSent(
  userEmail: string,
  documentId: string,
  note?: string,
  sentAt?: string
): Promise<void> {
  try {
    // Get current document
    const documentRef = doc(db, COLLECTIONS.DOCUMENTS, documentId);
    const documentSnap = await getDoc(documentRef);

    if (!documentSnap.exists()) {
      throw new Error('Document not found');
    }

    const document = documentSnap.data() as Document;

    // Verify ownership
    if (document.userEmail !== userEmail) {
      throw new Error('Not authorized to update this document');
    }

    // Validate status transition
    if (!isValidStatusTransition(document.status, 'sent', document.type)) {
      throw new Error(
        `Invalid status transition from ${document.status} to sent for ${document.type}`
      );
    }

    const timestamp = sentAt || new Date().toISOString();

    // Build update data
    const updateData: any = {
      status: 'sent',
      sentAt: timestamp,
      updatedAt: new Date().toISOString(),
    };

    // Add to status history
    updateData.statusHistory = addStatusToHistory(
      document.statusHistory || [],
      'sent',
      note || 'Sent to client'
    );

    await setDoc(documentRef, updateData, { merge: true });
  } catch (e) {
    console.error('Error marking document as sent:', e);
    throw e;
  }
}

/**
 * Mark invoice as paid
 * Only valid for invoice documents
 * Optionally accepts a custom date for the paid timestamp
 */
export async function markInvoicePaid(
  userEmail: string,
  documentId: string,
  note?: string,
  paidAt?: string
): Promise<void> {
  try {
    // Get current document
    const documentRef = doc(db, COLLECTIONS.DOCUMENTS, documentId);
    const documentSnap = await getDoc(documentRef);

    if (!documentSnap.exists()) {
      throw new Error('Document not found');
    }

    const document = documentSnap.data() as Document;

    // Verify ownership
    if (document.userEmail !== userEmail) {
      throw new Error('Not authorized to update this document');
    }

    // Validate status transition
    if (!isValidStatusTransition(document.status, 'paid', document.type)) {
      throw new Error(
        `Invalid status transition from ${document.status} to paid for ${document.type}`
      );
    }

    const timestamp = paidAt || new Date().toISOString();

    // Build update data
    const updateData: any = {
      status: 'paid',
      paidAt: timestamp,
      isPaid: true,
      updatedAt: new Date().toISOString(),
    };

    // Add to status history
    updateData.statusHistory = addStatusToHistory(
      document.statusHistory || [],
      'paid',
      note || 'Invoice paid'
    );

    await setDoc(documentRef, updateData, { merge: true });
  } catch (e) {
    console.error('Error marking invoice as paid:', e);
    throw e;
  }
}

/**
 * Get status history for a document
 */
export async function getDocumentStatusHistory(
  userEmail: string,
  documentId: string
): Promise<StatusHistoryEntry[]> {
  try {
    const document = await getDocumentById(documentId);

    if (!document) {
      throw new Error('Document not found');
    }

    if (document.userEmail !== userEmail) {
      throw new Error('Not authorized to view this document');
    }

    return document.statusHistory || [];
  } catch (e) {
    console.error('Error fetching document status history:', e);
    throw e;
  }
}

/**
 * Delete a final version of a document
 * Removes the final file and clears final version fields
 */
export async function deleteFinalDocumentVersion(
  userEmail: string,
  documentId: string
): Promise<void> {
  try {
    const documentRef = doc(db, COLLECTIONS.DOCUMENTS, documentId);
    const documentSnap = await getDoc(documentRef);

    if (!documentSnap.exists()) {
      throw new Error('Document not found');
    }

    const document = documentSnap.data() as Document;

    if (document.userEmail !== userEmail) {
      throw new Error('Not authorized to update this document');
    }

    // Delete the final file from storage
    if (document.finalStoragePath) {
      try {
        await deleteFinalDocument(document.finalStoragePath);
      } catch (e) {
        console.warn('Failed to delete final file from storage:', e);
      }
    }

    // Clear final version fields and revert status to generated
    const updateData: any = {
      finalStoragePath: deleteField(),
      finalDownloadUrl: deleteField(),
      finalFileName: deleteField(),
      finalizedAt: deleteField(),
      status: 'generated',
      updatedAt: new Date().toISOString(),
    };

    // Add history entry
    updateData.statusHistory = addStatusToHistory(
      document.statusHistory || [],
      'generated',
      'Final version deleted, reverted to generated'
    );

      // Clear ALL final version fields and revert status to generated
      updateData.finalStoragePath = deleteField();
      updateData.finalDownloadUrl = deleteField();
      updateData.finalFileName = deleteField();
      updateData.finalPdfStoragePath = deleteField();
      updateData.finalPdfDownloadUrl = deleteField();
      updateData.finalPdfFileName = deleteField();
      updateData.finalExcelStoragePath = deleteField();
      updateData.finalExcelDownloadUrl = deleteField();
      updateData.finalExcelFileName = deleteField();
      updateData.finalizedAt = deleteField();
      updateData.status = 'generated';

    await setDoc(documentRef, updateData, { merge: true });
  } catch (e) {
    console.error('Error deleting final document version:', e);
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
  userEmail: string,
  clientId: string
): Promise<WorkRecordTimesheet[]> {
  try {
    const q = query(
      collection(db, COLLECTIONS.TIMESHEETS),
      where('userEmail', '==', userEmail),
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
  userEmail: string,
  timesheet: WorkRecordTimesheetInput,
  existingId?: string
): Promise<WorkRecordTimesheet> {
  try {
    let id = existingId || crypto.randomUUID();
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
      userEmail,
      createdAt: existingId ? (await getDoc(doc(db, COLLECTIONS.TIMESHEETS, existingId))).data()?.createdAt || now : now,
      updatedAt: now,
    };

    const timesheetRef = doc(db, COLLECTIONS.TIMESHEETS, id);

    try {
      await setDoc(timesheetRef, timesheetData, { merge: true });
    } catch (err: any) {
      // Legacy fallback:
      // If updating an existing doc fails due to permission issues
      // (e.g. legacy/malformed ownership fields), create a fresh doc.
      if (existingId && err?.code === 'permission-denied') {
        console.warn(
          '[saveTimesheet] Permission denied updating existing timesheet. Creating a new timesheet document instead.',
          { existingId }
        );

        id = crypto.randomUUID();
        const fallbackRef = doc(db, COLLECTIONS.TIMESHEETS, id);
        await setDoc(fallbackRef, {
          ...timesheetData,
          createdAt: now,
        }, { merge: true });
      } else {
        throw err;
      }
    }

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

export async function deleteAllClientTimesheets(userEmail: string, clientId: string): Promise<number> {
  try {
    const q = query(
      collection(db, COLLECTIONS.TIMESHEETS),
      where('userEmail', '==', userEmail),
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
  userEmail: string
): Promise<FirestoreDocument[]> {
  try {
    console.log(`[getCollectionData] Fetching ${collectionName} for userEmail:`, userEmail);
    const q = query(collection(db, collectionName), where('userEmail', '==', userEmail));
    const snapshot = await getDocs(q);
    console.log(`[getCollectionData] Found ${snapshot.docs.length} documents in ${collectionName}`);

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
    // First, fetch the document to get storage paths
    const docRef = doc(db, collectionName, id);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      throw new Error(`Document ${id} not found in ${collectionName}`);
    }
    
    const docData = docSnap.data();
    
    // Delete associated files from storage
    const storageDeletionErrors: Error[] = [];
    
    // 1. Delete generated document file (storagePath)
    if (docData.storagePath) {
      try {
        await deleteDocumentFile(docData.storagePath);
        console.log(`Deleted storage file: ${docData.storagePath}`);
      } catch (error) {
        console.warn(`Error deleting storage file ${docData.storagePath}:`, error);
        storageDeletionErrors.push(error as Error);
      }
    }
    
    // 2. Delete legacy final document (finalStoragePath)
    if (docData.finalStoragePath) {
      try {
        await deleteFinalDocument(docData.finalStoragePath);
        console.log(`Deleted legacy final document: ${docData.finalStoragePath}`);
      } catch (error) {
        console.warn(`Error deleting legacy final document ${docData.finalStoragePath}:`, error);
        storageDeletionErrors.push(error as Error);
      }
    }
    
    // 3. Delete all final documents in the finalDocuments array
    if (docData.finalDocuments && Array.isArray(docData.finalDocuments)) {
      for (const finalDoc of docData.finalDocuments) {
        if (finalDoc.storagePath) {
          try {
            await deleteFinalDocument(finalDoc.storagePath);
            console.log(`Deleted final document: ${finalDoc.storagePath}`);
          } catch (error) {
            console.warn(`Error deleting final document ${finalDoc.storagePath}:`, error);
            storageDeletionErrors.push(error as Error);
          }
        }
      }
    }
    
    // Finally, delete the Firestore document
    await deleteDoc(docRef);
    
    // Log if there were any storage deletion errors, but don't fail the operation
    if (storageDeletionErrors.length > 0) {
      console.warn(`Document deleted but ${storageDeletionErrors.length} storage file(s) could not be deleted`);
    }
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
