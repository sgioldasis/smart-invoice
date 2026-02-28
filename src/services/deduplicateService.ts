/**
 * Document Deduplication Service
 * 
 * This service provides deduplication functionality that can be used
 * both by the CLI script and the UI components.
 */

import {
  collection,
  query,
  getDocs,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { db } from '../../firebase';

export interface DocumentData {
  id: string;
  workRecordId?: string;
  type?: 'invoice' | 'timesheet';
  generatedAt?: string;
  storagePath?: string;
  finalStoragePath?: string;
  finalDocuments?: Array<{ storagePath: string }>;
  fileName?: string;
  documentNumber?: string;
  clientName?: string;
  month?: string;
  userEmail?: string;
}

export interface DuplicateGroup {
  key: string;
  documents: DocumentData[];
  keep: DocumentData;
  delete: DocumentData[];
}

export interface DeduplicationResult {
  totalDocuments: number;
  duplicateGroups: DuplicateGroup[];
  totalDuplicates: number;
  deletedCount: number;
  failedCount: number;
  errors: string[];
}

/**
 * Fetch all documents from Firestore
 */
export async function fetchAllDocuments(): Promise<DocumentData[]> {
  const q = query(collection(db, 'documents'));
  const snapshot = await getDocs(q);
  
  return snapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data(),
  } as DocumentData));
}

/**
 * Find duplicate documents grouped by workRecordId + type
 */
export function findDuplicates(documents: DocumentData[]): DuplicateGroup[] {
  // Group documents by workRecordId + type
  const groups = new Map<string, DocumentData[]>();
  
  documents.forEach(doc => {
    // Only consider documents with workRecordId and type (invoices/timesheets from work records)
    if (!doc.workRecordId || !doc.type) {
      return;
    }
    
    const key = `${doc.workRecordId}-${doc.type}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(doc);
  });
  
  // Find groups with duplicates
  const duplicates: DuplicateGroup[] = [];
  
  groups.forEach((docs, key) => {
    if (docs.length > 1) {
      // Sort by generatedAt descending (newest first)
      const sorted = docs.sort((a, b) => {
        const dateA = new Date(a.generatedAt || 0).getTime();
        const dateB = new Date(b.generatedAt || 0).getTime();
        return dateB - dateA;
      });
      
      duplicates.push({
        key,
        documents: sorted,
        keep: sorted[0],
        delete: sorted.slice(1),
      });
    }
  });
  
  return duplicates;
}

/**
 * Delete a single Firestore document (does NOT delete storage files)
 */
export async function deleteDuplicateDocument(docData: DocumentData): Promise<{ success: boolean; error?: string }> {
  try {
    // Delete only the Firestore document (NOT storage files)
    await deleteDoc(doc(db, 'documents', docData.id));
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Run the full deduplication process
 * @param onProgress - Callback for progress updates
 * @returns DeduplicationResult with full statistics
 */
export async function runDeduplication(
  onProgress?: (message: string) => void
): Promise<DeduplicationResult> {
  const result: DeduplicationResult = {
    totalDocuments: 0,
    duplicateGroups: [],
    totalDuplicates: 0,
    deletedCount: 0,
    failedCount: 0,
    errors: [],
  };

  try {
    onProgress?.('Fetching all documents...');
    const documents = await fetchAllDocuments();
    result.totalDocuments = documents.length;

    if (documents.length === 0) {
      onProgress?.('No documents found.');
      return result;
    }

    onProgress?.('Analyzing for duplicates...');
    const duplicates = findDuplicates(documents);
    result.duplicateGroups = duplicates;
    result.totalDuplicates = duplicates.reduce((sum, group) => sum + group.delete.length, 0);

    if (duplicates.length === 0) {
      onProgress?.('No duplicates found!');
      return result;
    }

    onProgress?.(`Found ${duplicates.length} groups with ${result.totalDuplicates} duplicates`);

    // Delete duplicates
    for (const group of duplicates) {
      onProgress?.(`Processing: ${group.key}`);
      
      for (const docToDelete of group.delete) {
        const deleteResult = await deleteDuplicateDocument(docToDelete);
        
        if (deleteResult.success) {
          result.deletedCount++;
          onProgress?.(`  Deleted: ${docToDelete.id}`);
        } else {
          result.failedCount++;
          result.errors.push(`Failed to delete ${docToDelete.id}: ${deleteResult.error}`);
          onProgress?.(`  Failed: ${docToDelete.id} - ${deleteResult.error}`);
        }
      }
    }

    onProgress?.('Deduplication complete!');
    return result;

  } catch (error: any) {
    result.errors.push(`Fatal error: ${error.message}`);
    onProgress?.(`Error: ${error.message}`);
    return result;
  }
}

/**
 * Preview duplicates without deleting (dry run)
 */
export async function previewDuplicates(): Promise<DeduplicationResult> {
  const result: DeduplicationResult = {
    totalDocuments: 0,
    duplicateGroups: [],
    totalDuplicates: 0,
    deletedCount: 0,
    failedCount: 0,
    errors: [],
  };

  try {
    const documents = await fetchAllDocuments();
    result.totalDocuments = documents.length;

    if (documents.length === 0) {
      return result;
    }

    const duplicates = findDuplicates(documents);
    result.duplicateGroups = duplicates;
    result.totalDuplicates = duplicates.reduce((sum, group) => sum + group.delete.length, 0);

    return result;

  } catch (error: any) {
    result.errors.push(`Error: ${error.message}`);
    return result;
  }
}
