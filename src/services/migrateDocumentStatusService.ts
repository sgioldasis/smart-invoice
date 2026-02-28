/**
 * Document Status Migration Service
 *
 * This service updates the status field of all documents in Firestore
 * based on their finalDocuments array or file data.
 *
 * Enhanced with:
 * - Firebase Storage file existence verification
 * - Batch processing with progress reporting
 * - Detailed file status tracking
 */

import {
  collection,
  query,
  getDocs,
  updateDoc,
  doc,
} from 'firebase/firestore';
import {
  ref,
  getMetadata,
} from 'firebase/storage';
import { db, storage } from '../../firebase';
import type { FinalDocumentInfo } from '../types';

// Configuration
const BATCH_SIZE = 50;

export interface DocumentData {
  id: string;
  status?: string;
  finalDocuments?: FinalDocumentInfo[];
  finalStoragePath?: string;
  finalDownloadUrl?: string;
  finalFileName?: string;
  // Main storage fields (some documents store files here instead of final fields)
  fileName?: string;
  storagePath?: string;
  downloadUrl?: string;
  excelBase64?: string;
  fileData?: string;
  documentNumber?: string;
  clientName?: string;
  type?: string;
}

export interface FileExistenceResult {
  exists: boolean;
  path: string;
  error?: string;
}

export interface DocumentFileStatus {
  docId: string;
  documentNumber?: string;
  clientName?: string;
  currentStatus: string;
  files: Array<{
    path: string;
    fileName: string;
    exists: boolean;
    error?: string;
  }>;
  missingFiles: string[];
  hasExistingFiles: boolean;
}

export interface StatusChange {
  id: string;
  documentNumber?: string;
  clientName?: string;
  oldStatus: string;
  newStatus: string;
  reason: string;
  files?: string[];
  fileStatus?: DocumentFileStatus;
}

export interface MigrationResult {
  totalDocuments: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: string[];
  changes: StatusChange[];
  fileVerification?: {
    checked: number;
    exists: number;
    missing: number;
    missingFiles: Array<{ docId: string; path: string; fileName: string }>;
  };
}

/**
 * Determine the effective status based on document files
 * Can optionally consider file existence verification results
 */
export function determineEffectiveStatus(
  doc: DocumentData,
  fileStatus?: DocumentFileStatus
): { status: string; reason: string } {
  // If file verification was done, use the verified file information
  if (fileStatus) {
    // No files exist - downgrade to generated
    if (fileStatus.files.length > 0 && !fileStatus.hasExistingFiles) {
      return { status: 'generated', reason: 'No files exist in storage (all missing)' };
    }
    
    // Files exist - determine status from ACTUAL existing files
    if (fileStatus.hasExistingFiles) {
      const existingFiles = fileStatus.files.filter(f => f.exists);
      const hasPdf = existingFiles.some(f =>
        f.fileName.toLowerCase().endsWith('.pdf')
      );
      const hasExcel = existingFiles.some(f =>
        f.fileName.toLowerCase().endsWith('.xlsx') ||
        f.fileName.toLowerCase().endsWith('.xls')
      );
      
      if (hasPdf) {
        return { status: 'pdf-uploaded', reason: `Verified PDF exists in storage (${existingFiles.length} files)` };
      } else if (hasExcel) {
        return { status: 'excel-uploaded', reason: 'Verified Excel exists in storage (no PDF)' };
      }
    }
    
    // File verification done but no files referenced - continue to check metadata
  }

  // Preserve paid status
  if (doc.status === 'paid') {
    return { status: 'paid', reason: 'Already marked as paid' };
  }
  
  // Preserve sent status
  if (doc.status === 'sent') {
    return { status: 'sent', reason: 'Already marked as sent' };
  }

  // Check BOTH finalDocuments array AND legacy fields
  let hasPdf = false;
  let hasExcel = false;
  
  // Check finalDocuments array
  if (doc.finalDocuments && doc.finalDocuments.length > 0) {
    hasPdf = doc.finalDocuments.some(fd =>
      fd.fileExtension?.toLowerCase() === 'pdf' ||
      fd.fileName?.toLowerCase().endsWith('.pdf')
    );
    hasExcel = doc.finalDocuments.some(fd =>
      fd.fileExtension?.toLowerCase() === 'xlsx' ||
      fd.fileExtension?.toLowerCase() === 'xls' ||
      fd.fileName?.toLowerCase().endsWith('.xlsx') ||
      fd.fileName?.toLowerCase().endsWith('.xls')
    );
  }

  // ALSO check legacy fields (in case finalDocuments has wrong files like timesheets instead of invoices)
  const legacyFileName = doc.finalFileName || '';
  const legacyStoragePath = doc.finalStoragePath || '';
  const legacyDownloadUrl = doc.finalDownloadUrl || '';
  
  // Extract extension from legacy fileName
  const legacyExtFromFileName = legacyFileName.toLowerCase().split('.').pop();
  if (legacyExtFromFileName === 'pdf') hasPdf = true;
  if (legacyExtFromFileName === 'xlsx' || legacyExtFromFileName === 'xls') hasExcel = true;
  
  // Check legacy storage path
  if (legacyStoragePath.toLowerCase().endsWith('.pdf')) hasPdf = true;
  if (legacyStoragePath.toLowerCase().endsWith('.xlsx') || legacyStoragePath.toLowerCase().endsWith('.xls')) hasExcel = true;
  
  // Check legacy download URL
  if (legacyDownloadUrl.toLowerCase().includes('.pdf')) hasPdf = true;
  if (legacyDownloadUrl.toLowerCase().includes('.xlsx') || legacyDownloadUrl.toLowerCase().includes('.xls')) hasExcel = true;

  // ALSO check MAIN storage fields (fileName, storagePath, downloadUrl)
  // Some documents have files stored here instead of final fields
  const mainFileName = doc.fileName || '';
  const mainStoragePath = doc.storagePath || '';
  const mainDownloadUrl = doc.downloadUrl || '';
  
  // Check main fileName
  const mainExtFromFileName = mainFileName.toLowerCase().split('.').pop();
  if (mainExtFromFileName === 'pdf') hasPdf = true;
  if (mainExtFromFileName === 'xlsx' || mainExtFromFileName === 'xls') hasExcel = true;
  
  // Check main storage path
  if (mainStoragePath.toLowerCase().endsWith('.pdf')) hasPdf = true;
  if (mainStoragePath.toLowerCase().endsWith('.xlsx') || mainStoragePath.toLowerCase().endsWith('.xls')) hasExcel = true;
  
  // Check main download URL
  if (mainDownloadUrl.toLowerCase().includes('.pdf')) hasPdf = true;
  if (mainDownloadUrl.toLowerCase().includes('.xlsx') || mainDownloadUrl.toLowerCase().includes('.xls')) hasExcel = true;
  
  // Return status based on what we found
  if (hasPdf) {
    return { status: 'pdf-uploaded', reason: `Found PDF file` };
  } else if (hasExcel) {
    return { status: 'excel-uploaded', reason: `Found Excel file` };
  }

  // Check for excel base64 data (very old documents)
  if (doc.excelBase64 || doc.fileData) {
    return { status: 'excel-uploaded', reason: 'Found embedded Excel data' };
  }

  // Default to generated
  return { status: 'generated', reason: 'No files found' };
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
 * Update a single document's status
 */
export async function updateDocumentStatus(docId: string, newStatus: string): Promise<boolean> {
  try {
    const docRef = doc(db, 'documents', docId);
    await updateDoc(docRef, { status: newStatus });
    return true;
  } catch (error: any) {
    console.error(`Error updating ${docId}:`, error.message);
    return false;
  }
}

/**
 * Get download URL for a storage path
 */
export async function getStorageDownloadUrl(storagePath: string): Promise<string | undefined> {
  try {
    const { getDocumentDownloadUrl } = await import('./storage');
    return await getDocumentDownloadUrl(storagePath);
  } catch (error) {
    console.error(`Error getting download URL for ${storagePath}:`, error);
    return undefined;
  }
}

/**
 * Update document to include both PDF and Excel files in finalDocuments array
 */
export async function updateDocumentWithBothFiles(
  docId: string,
  pdfPath: string,
  pdfFileName: string,
  excelPath: string,
  excelFileName: string
): Promise<boolean> {
  try {
    const docRef = doc(db, 'documents', docId);
    
    // Get download URLs for both files
    const [pdfDownloadUrl, excelDownloadUrl] = await Promise.all([
      getStorageDownloadUrl(pdfPath),
      getStorageDownloadUrl(excelPath),
    ]);
    
    if (!pdfDownloadUrl || !excelDownloadUrl) {
      console.error(`Failed to get download URLs for ${docId}`);
      return false;
    }
    
    const finalDocuments = [
      {
        fileName: pdfFileName,
        fileExtension: 'pdf',
        storagePath: pdfPath,
        downloadUrl: pdfDownloadUrl,
        uploadedAt: new Date().toISOString(),
      },
      {
        fileName: excelFileName,
        fileExtension: 'xlsx',
        storagePath: excelPath,
        downloadUrl: excelDownloadUrl,
        uploadedAt: new Date().toISOString(),
      },
    ];
    
    await updateDoc(docRef, {
      finalDocuments,
      status: 'pdf-uploaded',
    });
    
    console.log(`Updated ${docId} with both PDF and Excel files`);
    return true;
  } catch (error: any) {
    console.error(`Error updating document ${docId}:`, error.message);
    return false;
  }
}

/**
 * Check if a file exists in Firebase Storage
 */
export async function checkFileExists(storagePath: string): Promise<FileExistenceResult> {
  try {
    const fileRef = ref(storage, storagePath);
    await getMetadata(fileRef);
    return { exists: true, path: storagePath };
  } catch (error: any) {
    if (error.code === 'storage/object-not-found') {
      return { exists: false, path: storagePath };
    }
    return { exists: false, path: storagePath, error: error.message };
  }
}

/**
 * Verify file existence for a single document
 * Also checks for sibling files (e.g., if PDF exists, check for Excel with same name)
 */
export async function verifyDocumentFiles(doc: DocumentData): Promise<DocumentFileStatus> {
  const result: DocumentFileStatus = {
    docId: doc.id,
    documentNumber: doc.documentNumber,
    clientName: doc.clientName,
    currentStatus: doc.status || 'generated',
    files: [],
    missingFiles: [],
    hasExistingFiles: false,
  };

  const pathsToCheck: Array<{ path: string; fileName: string }> = [];

  // Check finalDocuments array
  if (doc.finalDocuments && doc.finalDocuments.length > 0) {
    for (const fd of doc.finalDocuments) {
      if (fd.storagePath) {
        pathsToCheck.push({ path: fd.storagePath, fileName: fd.fileName || 'unknown' });
      }
    }
  }

  // Check legacy finalStoragePath
  if (doc.finalStoragePath) {
    pathsToCheck.push({ path: doc.finalStoragePath, fileName: doc.finalFileName || 'unknown' });
  }

  // Check MAIN storage fields (fileName, storagePath)
  // Some documents have files stored here instead of final fields
  if (doc.storagePath) {
    pathsToCheck.push({ path: doc.storagePath, fileName: doc.fileName || 'unknown' });
    
    // Also check for Excel sibling file if we have a PDF
    if (doc.storagePath.toLowerCase().endsWith('.pdf')) {
      const excelPath = doc.storagePath.replace(/\.pdf$/i, '.xlsx');
      const excelFileName = doc.fileName ? doc.fileName.replace(/\.pdf$/i, '.xlsx') : 'unknown.xlsx';
      pathsToCheck.push({ path: excelPath, fileName: excelFileName });
    }
  }

  // Check all paths
  if (pathsToCheck.length > 0) {
    const checkPromises = pathsToCheck.map(p => checkFileExists(p.path));
    const checkResults = await Promise.all(checkPromises);

    for (let i = 0; i < checkResults.length; i++) {
      const check = checkResults[i];
      const fileInfo = pathsToCheck[i];
      
      result.files.push({
        path: check.path,
        fileName: fileInfo.fileName,
        exists: check.exists,
        error: check.error,
      });

      if (!check.exists) {
        result.missingFiles.push(fileInfo.fileName);
      } else {
        result.hasExistingFiles = true;
      }
    }
  }

  return result;
}

/**
 * Verify files for multiple documents in batches
 */
export async function verifyFilesBatch(
  documents: DocumentData[],
  onProgress?: (checked: number, total: number) => void
): Promise<DocumentFileStatus[]> {
  const results: DocumentFileStatus[] = [];
  
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(doc => verifyDocumentFiles(doc));
    const batchResults = await Promise.all(batchPromises);
    
    results.push(...batchResults);
    onProgress?.(Math.min(i + BATCH_SIZE, documents.length), documents.length);
  }
  
  return results;
}

/**
 * Preview status changes without applying them
 */
export async function previewStatusMigration(): Promise<MigrationResult> {
  const result: MigrationResult = {
    totalDocuments: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errors: [],
    changes: [],
  };

  try {
    const documents = await fetchAllDocuments();
    result.totalDocuments = documents.length;

    for (const doc of documents) {
      const currentStatus = doc.status || 'generated';
      const { status: effectiveStatus, reason } = determineEffectiveStatus(doc);
      
      if (currentStatus !== effectiveStatus) {
        result.changes.push({
          id: doc.id,
          documentNumber: doc.documentNumber,
          clientName: doc.clientName,
          oldStatus: currentStatus,
          newStatus: effectiveStatus,
          reason,
          files: doc.finalDocuments?.map(fd => fd.fileName || fd.fileExtension),
        });
      } else {
        result.skippedCount++;
      }
    }

    return result;
  } catch (error: any) {
    result.errors.push(`Error: ${error.message}`);
    return result;
  }
}

/**
 * Run the full status migration
 */
export async function runStatusMigration(
  onProgress?: (message: string) => void
): Promise<MigrationResult> {
  const result: MigrationResult = {
    totalDocuments: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errors: [],
    changes: [],
  };

  try {
    onProgress?.('Fetching documents...');
    const documents = await fetchAllDocuments();
    result.totalDocuments = documents.length;

    if (documents.length === 0) {
      onProgress?.('No documents found');
      return result;
    }

    onProgress?.('Analyzing documents...');
    const changesToApply: Array<{ doc: DocumentData; newStatus: string; needsBothFiles?: boolean }> = [];

    for (const doc of documents) {
      const currentStatus = doc.status || 'generated';
      const { status: effectiveStatus, reason } = determineEffectiveStatus(doc);
      
      // Check if we need to add both files to finalDocuments
      const needsBothFiles = doc.storagePath?.toLowerCase().endsWith('.pdf') &&
                           doc.storagePath.includes('/invoice/') &&
                           !doc.finalDocuments?.some(fd => fd.fileExtension === 'xlsx');
      
      if (currentStatus !== effectiveStatus || needsBothFiles) {
        changesToApply.push({
          doc,
          newStatus: effectiveStatus,
          needsBothFiles
        });
        result.changes.push({
          id: doc.id,
          documentNumber: doc.documentNumber,
          clientName: doc.clientName,
          oldStatus: currentStatus,
          newStatus: effectiveStatus,
          reason,
          files: doc.finalDocuments?.map(fd => fd.fileName || fd.fileExtension),
        });
      } else {
        result.skippedCount++;
      }
    }

    if (changesToApply.length === 0) {
      onProgress?.('All documents have correct status');
      return result;
    }

    onProgress?.(`Found ${changesToApply.length} documents to update`);

    // Apply changes
    for (const { doc, newStatus, needsBothFiles } of changesToApply) {
      if (needsBothFiles && doc.storagePath) {
        // Update document with both PDF and Excel files
        const pdfPath = doc.storagePath;
        const pdfFileName = doc.fileName || 'unknown.pdf';
        const excelPath = doc.storagePath.replace(/\.pdf$/i, '.xlsx');
        const excelFileName = doc.fileName ? doc.fileName.replace(/\.pdf$/i, '.xlsx') : 'unknown.xlsx';
        
        const success = await updateDocumentWithBothFiles(doc.id, pdfPath, pdfFileName, excelPath, excelFileName);
        if (success) {
          result.updatedCount++;
          onProgress?.(`Updated ${doc.id}: Added both PDF and Excel files`);
        } else {
          result.failedCount++;
          result.errors.push(`Failed to update ${doc.id} with both files`);
          onProgress?.(`Failed to update ${doc.id} with both files`);
        }
      } else {
        // Just update status
        const success = await updateDocumentStatus(doc.id, newStatus);
        if (success) {
          result.updatedCount++;
          onProgress?.(`Updated ${doc.id}: ${doc.status || 'generated'} → ${newStatus}`);
        } else {
          result.failedCount++;
          result.errors.push(`Failed to update ${doc.id}`);
          onProgress?.(`Failed to update ${doc.id}`);
        }
      }
    }

    onProgress?.('Migration complete');
    return result;
  } catch (error: any) {
    result.errors.push(`Fatal error: ${error.message}`);
    onProgress?.(`Error: ${error.message}`);
    return result;
  }
}

/**
 * Run the full status migration with optional file existence verification
 *
 * @param verifyFiles - Whether to verify files exist in Firebase Storage
 * @param onProgress - Callback for progress updates
 */
export async function runStatusMigrationWithVerification(
  verifyFiles: boolean = false,
  onProgress?: (message: string) => void
): Promise<MigrationResult> {
  const result: MigrationResult = {
    totalDocuments: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errors: [],
    changes: [],
  };

  try {
    onProgress?.('Fetching documents...');
    const documents = await fetchAllDocuments();
    result.totalDocuments = documents.length;

    if (documents.length === 0) {
      onProgress?.('No documents found');
      return result;
    }

    // File verification phase
    let fileVerificationResults: DocumentFileStatus[] = [];
    if (verifyFiles) {
      onProgress?.('Verifying file existence in Firebase Storage...');
      fileVerificationResults = await verifyFilesBatch(documents, (checked, total) => {
        onProgress?.(`Verified ${checked}/${total} documents...`);
      });
      
      // Build file verification summary
      const totalFiles = fileVerificationResults.reduce((sum, r) => sum + r.files.length, 0);
      const existingFiles = fileVerificationResults.reduce((sum, r) =>
        sum + r.files.filter(f => f.exists).length, 0);
      const missingFilesList: Array<{ docId: string; path: string; fileName: string }> = [];
      
      fileVerificationResults.forEach(status => {
        status.files.filter(f => !f.exists).forEach(f => {
          missingFilesList.push({ docId: status.docId, path: f.path, fileName: f.fileName });
        });
      });
      
      result.fileVerification = {
        checked: fileVerificationResults.length,
        exists: existingFiles,
        missing: totalFiles - existingFiles,
        missingFiles: missingFilesList,
      };
      
      onProgress?.(`File verification complete: ${existingFiles}/${totalFiles} files exist`);
    }

    onProgress?.('Analyzing documents...');
    const changesToApply: Array<{ doc: DocumentData; newStatus: string }> = [];

    for (const doc of documents) {
      const currentStatus = doc.status || 'generated';
      const fileStatus = verifyFiles ? fileVerificationResults.find(r => r.docId === doc.id) : undefined;
      const { status: effectiveStatus, reason } = determineEffectiveStatus(doc, fileStatus);
      
      if (currentStatus !== effectiveStatus) {
        changesToApply.push({ doc, newStatus: effectiveStatus });
        result.changes.push({
          id: doc.id,
          documentNumber: doc.documentNumber,
          clientName: doc.clientName,
          oldStatus: currentStatus,
          newStatus: effectiveStatus,
          reason,
          files: doc.finalDocuments?.map(fd => fd.fileName || fd.fileExtension),
          fileStatus,
        });
      } else {
        result.skippedCount++;
      }
    }

    if (changesToApply.length === 0) {
      onProgress?.('All documents have correct status');
      return result;
    }

    onProgress?.(`Found ${changesToApply.length} documents to update`);

    // Apply changes
    for (const { doc, newStatus } of changesToApply) {
      const success = await updateDocumentStatus(doc.id, newStatus);
      if (success) {
        result.updatedCount++;
        onProgress?.(`Updated ${doc.id}: ${doc.status || 'generated'} → ${newStatus}`);
      } else {
        result.failedCount++;
        result.errors.push(`Failed to update ${doc.id}`);
        onProgress?.(`Failed to update ${doc.id}`);
      }
    }

    onProgress?.('Migration complete');
    return result;
  } catch (error: any) {
    result.errors.push(`Fatal error: ${error.message}`);
    onProgress?.(`Error: ${error.message}`);
    return result;
  }
}
