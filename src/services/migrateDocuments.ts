/**
 * Document Migration Service
 *
 * Migrates old documents to the new Firebase Storage folder structure:
 * - New: users/{sanitizedEmail}/{sanitizedClientName}/{month}/{type}/{filename}
 * - Old: Missing storagePath (base64), or old path structures
 *
 * Handles:
 * 1. Documents missing storagePath entirely (base64 stored in Firestore)
 * 2. Documents in old folder paths (missing month segment, missing type subfolder)
 * 3. Updates Firestore with new storagePath and downloadUrl
 * 4. Optionally deletes old storage files
 */

import type { Document, FinalDocumentInfo } from '../types';
import {
  uploadDocument,
  downloadDocument,
  deleteDocumentFile,
  sanitizeUserEmail,
  sanitizeClientName,
  base64ToBlob,
  getContentType,
} from './storage';
import { getDocuments } from './db';

// ============================================
// Types
// ============================================

export interface MigrationProgress {
  /** Current document being processed (1-based) */
  current: number;
  /** Total documents to process */
  total: number;
  /** Document currently being processed */
  currentDocument?: string;
  /** Number of documents successfully migrated */
  migrated: number;
  /** Number of documents skipped (already correct structure) */
  skipped: number;
  /** Number of documents that failed migration */
  failed: number;
  /** Number of old files deleted */
  deleted: number;
}

export interface MigrationResult {
  /** Total documents processed */
  totalProcessed: number;
  /** Number of documents successfully migrated */
  migrated: number;
  /** Number of documents skipped */
  skipped: number;
  /** Number of documents that failed */
  failed: number;
  /** Number of old files deleted */
  deleted: number;
  /** Array of errors encountered */
  errors: MigrationError[];
}

export interface MigrationError {
  documentId: string;
  error: string;
  phase: 'download' | 'upload' | 'update' | 'cleanup';
}

export interface MigrationOptions {
  /** User email to migrate documents for */
  userEmail: string;
  /** Whether to delete old storage files after migration */
  deleteOldFiles?: boolean;
  /** Progress callback called after each document */
  onProgress?: (progress: MigrationProgress) => void;
  /** Dry run - check what would be migrated without making changes */
  dryRun?: boolean;
  /** Batch size for processing (default: 10) */
  batchSize?: number;
}

// ============================================
// Path Analysis
// ============================================

/**
 * Check if a storage path follows the new structure
 * New structure: users/{sanitizedEmail}/{sanitizedClientName}/{month}/{type}/{filename}
 * or: users/{sanitizedEmail}/{sanitizedClientName}/{month}/{filename}
 */
function isNewPathStructure(storagePath: string): boolean {
  if (!storagePath) return false;

  // Split path into segments
  const segments = storagePath.split('/').filter(Boolean);

  // Must start with 'users'
  if (segments[0] !== 'users') return false;

  // Must have at least: users/{email}/{client}/{month}/{filename}
  if (segments.length < 5) return false;

  // Check if month segment looks like YYYY-MM
  const monthSegment = segments[3];
  if (!/^\d{4}-\d{2}$/.test(monthSegment)) return false;

  return true;
}

/**
 * Check if a storage path has the type subfolder (invoice/ or timesheet/)
 */
function hasTypeSubfolder(storagePath: string, documentType: 'invoice' | 'timesheet'): boolean {
  if (!storagePath) return false;

  const segments = storagePath.split('/').filter(Boolean);

  // Must have at least: users/{email}/{client}/{month}/{type}/{filename}
  if (segments.length < 6) return false;

  // Check if the 5th segment (index 4) is the document type
  return segments[4] === documentType;
}

/**
 * Extract information from an old storage path
 */
function parseOldStoragePath(storagePath: string): {
  email?: string;
  clientName?: string;
  month?: string;
  fileName?: string;
  needsMigration: boolean;
} {
  if (!storagePath) {
    return { needsMigration: true };
  }

  const segments = storagePath.split('/').filter(Boolean);

  // Old structure patterns:
  // - users/{email}/documents/{filename}
  // - users/{email}/{client}/{filename}
  // - users/{email}/{client}/{month?}/{filename}

  if (segments[0] !== 'users') {
    return { needsMigration: true };
  }

  // Check for old patterns
  if (segments[2] === 'documents') {
    // Pattern: users/{email}/documents/{filename}
    return {
      email: segments[1],
      fileName: segments[3],
      needsMigration: true,
    };
  }

  // Check if month segment is missing or invalid
  const potentialMonth = segments[3];
  const hasValidMonth = potentialMonth && /^\d{4}-\d{2}$/.test(potentialMonth);

  if (!hasValidMonth) {
    return {
      email: segments[1],
      clientName: segments[2],
      fileName: segments[segments.length - 1],
      needsMigration: true,
    };
  }

  return {
    email: segments[1],
    clientName: segments[2],
    month: potentialMonth,
    fileName: segments[segments.length - 1],
    needsMigration: !isNewPathStructure(storagePath),
  };
}

/**
 * Build new storage path following the correct structure
 */
function buildNewStoragePath(
  userEmail: string,
  clientName: string,
  month: string,
  fileName: string,
  documentType?: 'invoice' | 'timesheet'
): string {
  const sanitizedEmail = sanitizeUserEmail(userEmail);
  const sanitizedClient = sanitizeClientName(clientName);

  if (documentType) {
    return `users/${sanitizedEmail}/${sanitizedClient}/${month}/${documentType}/${fileName}`;
  }

  return `users/${sanitizedEmail}/${sanitizedClient}/${month}/${fileName}`;
}

// ============================================
// Document Download
// ============================================

/**
 * Download document data from various sources
 * Handles: storage path, base64 data URL, legacy final documents
 */
async function downloadDocumentData(
  document: Document,
  clientName: string
): Promise<Blob | null> {
  const errors: string[] = [];

  // Try 1: Download from storagePath
  if (document.storagePath) {
    try {
      console.log(`[Migration] Downloading from storagePath: ${document.storagePath}`);
      return await downloadDocument(document.storagePath);
    } catch (error) {
      const msg = `Failed to download from storagePath: ${error}`;
      console.warn(`[Migration] ${msg}`);
      errors.push(msg);
    }
  }

  // Try 2: Check if document has data stored in Firestore (base64)
  // This would be in a data field that might exist in old documents
  const docWithData = document as Document & { data?: string; fileData?: string };
  if (docWithData.data || docWithData.fileData) {
    try {
      const base64Data = docWithData.data || docWithData.fileData;
      console.log(`[Migration] Converting base64 data to Blob`);
      const contentType = getContentType(document.fileName || 'document.xlsx');
      return base64ToBlob(base64Data!, contentType);
    } catch (error) {
      const msg = `Failed to convert base64 data: ${error}`;
      console.warn(`[Migration] ${msg}`);
      errors.push(msg);
    }
  }

  // Try 3: Download from finalStoragePath (legacy final document)
  if (document.finalStoragePath) {
    try {
      console.log(`[Migration] Downloading from finalStoragePath: ${document.finalStoragePath}`);
      return await downloadDocument(document.finalStoragePath);
    } catch (error) {
      const msg = `Failed to download from finalStoragePath: ${error}`;
      console.warn(`[Migration] ${msg}`);
      errors.push(msg);
    }
  }

  // Try 4: Download from finalDocuments array
  if (document.finalDocuments && document.finalDocuments.length > 0) {
    for (const finalDoc of document.finalDocuments) {
      try {
        console.log(`[Migration] Downloading from finalDocuments: ${finalDoc.storagePath}`);
        return await downloadDocument(finalDoc.storagePath);
      } catch (error) {
        const msg = `Failed to download from finalDocument ${finalDoc.storagePath}: ${error}`;
        console.warn(`[Migration] ${msg}`);
        errors.push(msg);
      }
    }
  }

  console.error(`[Migration] All download attempts failed for document ${document.id}:`, errors);
  return null;
}

// ============================================
// Main Migration Function
// ============================================

/**
 * Migrate documents to the new storage structure
 *
 * @param options Migration options
 * @returns Migration result statistics
 */
export async function migrateDocuments(options: MigrationOptions): Promise<MigrationResult> {
  const { userEmail, deleteOldFiles = false, onProgress, dryRun = false, batchSize = 10 } = options;

  console.log(`[Migration] Starting document migration for ${userEmail}`);
  console.log(`[Migration] Options: deleteOldFiles=${deleteOldFiles}, dryRun=${dryRun}`);

  const result: MigrationResult = {
    totalProcessed: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    deleted: 0,
    errors: [],
  };

  // Get all documents for the user
  const documents = await getDocuments(userEmail);
  console.log(`[Migration] Found ${documents.length} documents`);

  if (documents.length === 0) {
    console.log('[Migration] No documents to migrate');
    return result;
  }

  // Identify documents needing migration
  const documentsToMigrate: Document[] = [];

  for (const doc of documents) {
    const needsMigration = checkIfNeedsMigration(doc);
    if (needsMigration) {
      documentsToMigrate.push(doc);
    } else {
      result.skipped++;
      console.log(`[Migration] Skipping ${doc.id} - already correct structure`);
    }
  }

  console.log(`[Migration] ${documentsToMigrate.length} documents need migration, ${result.skipped} skipped`);

  if (dryRun) {
    console.log('[Migration] Dry run - no changes will be made');
    result.totalProcessed = documentsToMigrate.length;
    return result;
  }

  // Process documents in batches
  for (let i = 0; i < documentsToMigrate.length; i += batchSize) {
    const batch = documentsToMigrate.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (document, batchIndex) => {
        const currentIndex = i + batchIndex + 1;
        const docIdentifier = `${document.type}_${document.documentNumber || document.id}`;

        // Update progress
        onProgress?.({
          current: currentIndex,
          total: documentsToMigrate.length,
          currentDocument: docIdentifier,
          migrated: result.migrated,
          skipped: result.skipped,
          failed: result.failed,
          deleted: result.deleted,
        });

        try {
          await migrateSingleDocument(document, userEmail, deleteOldFiles, result);
          result.totalProcessed++;
        } catch (error) {
          result.failed++;
          result.totalProcessed++;
          result.errors.push({
            documentId: document.id,
            error: String(error),
            phase: 'upload',
          });
          console.error(`[Migration] Failed to migrate document ${document.id}:`, error);
        }
      })
    );
  }

  console.log('[Migration] Complete:', result);
  return result;
}

/**
 * Check if a document needs migration
 */
function checkIfNeedsMigration(document: Document): boolean {
  // Case 1: Missing storagePath entirely
  if (!document.storagePath) {
    console.log(`[Migration] Document ${document.id} needs migration: missing storagePath`);
    return true;
  }

  // Case 2: Not in new path structure
  if (!isNewPathStructure(document.storagePath)) {
    console.log(`[Migration] Document ${document.id} needs migration: old path structure`);
    return true;
  }

  // Case 3: Missing type subfolder when it should have one
  // (Documents should be in invoice/ or timesheet/ subfolder)
  if (!hasTypeSubfolder(document.storagePath, document.type)) {
    console.log(`[Migration] Document ${document.id} needs migration: missing type subfolder`);
    return true;
  }

  return false;
}

/**
 * Migrate a single document
 */
async function migrateSingleDocument(
  document: Document,
  userEmail: string,
  deleteOldFiles: boolean,
  result: MigrationResult
): Promise<void> {
  console.log(`[Migration] Processing document ${document.id} (${document.type} ${document.documentNumber})`);

  const oldStoragePath = document.storagePath;
  const oldFinalStoragePath = document.finalStoragePath;

  // Get client name - we need this for the new path
  // Try to extract from old path or use a fallback
  let clientName = extractClientNameFromPath(document.storagePath, document);

  if (!clientName) {
    throw new Error('Cannot determine client name for migration');
  }

  // Download document data
  const blob = await downloadDocumentData(document, clientName);
  if (!blob) {
    throw new Error('Failed to download document data from any source');
  }

  // Build new storage path
  const fileName = document.fileName || `${document.type}_${document.documentNumber}.xlsx`;
  const newStoragePath = buildNewStoragePath(
    userEmail,
    clientName,
    document.month,
    fileName,
    document.type
  );

  console.log(`[Migration] New path: ${newStoragePath}`);

  // Upload to new location
  const { storagePath, downloadUrl } = await uploadDocument(
    userEmail,
    clientName,
    document.month,
    fileName,
    blob,
    undefined, // contentType - use default
    undefined, // onProgress - not needed for migration
    document.type as 'invoice' | 'timesheet'
  );

  console.log(`[Migration] Uploaded to ${storagePath}`);

  // Update Firestore document with new paths
  const updatedDocument: Partial<Document> = {
    storagePath,
    downloadUrl,
  };

  // Also migrate final documents if they exist
  if (document.finalDocuments && document.finalDocuments.length > 0) {
    const migratedFinalDocs: FinalDocumentInfo[] = [];

    for (const finalDoc of document.finalDocuments) {
      try {
        // Check if final doc needs migration
        if (!isNewPathStructure(finalDoc.storagePath)) {
          const finalBlob = await downloadDocument(finalDoc.storagePath);
          const newFinalPath = buildNewStoragePath(
            userEmail,
            clientName,
            document.month,
            finalDoc.fileName,
            document.type
          );

          const { storagePath: newPath, downloadUrl: newUrl } = await uploadDocument(
            userEmail,
            clientName,
            document.month,
            finalDoc.fileName,
            finalBlob,
            undefined,
            undefined,
            document.type as 'invoice' | 'timesheet'
          );

          migratedFinalDocs.push({
            ...finalDoc,
            storagePath: newPath,
            downloadUrl: newUrl,
          });

          // Delete old final doc if requested
          if (deleteOldFiles) {
            try {
              await deleteDocumentFile(finalDoc.storagePath);
              result.deleted++;
            } catch (e) {
              console.warn(`[Migration] Failed to delete old final doc: ${e}`);
            }
          }
        } else {
          migratedFinalDocs.push(finalDoc);
        }
      } catch (e) {
        console.warn(`[Migration] Failed to migrate final doc ${finalDoc.id}: ${e}`);
        migratedFinalDocs.push(finalDoc); // Keep original
      }
    }

    updatedDocument.finalDocuments = migratedFinalDocs;
  }

  // Migrate legacy final document if exists
  if (document.finalStoragePath && !isNewPathStructure(document.finalStoragePath)) {
    try {
      const finalBlob = await downloadDocument(document.finalStoragePath);
      const finalFileName = document.finalFileName || fileName;
      const newFinalPath = buildNewStoragePath(
        userEmail,
        clientName,
        document.month,
        finalFileName,
        document.type
      );

      const { storagePath: newFinalStoragePath, downloadUrl: newFinalDownloadUrl } = await uploadDocument(
        userEmail,
        clientName,
        document.month,
        finalFileName,
        finalBlob,
        undefined,
        undefined,
        document.type as 'invoice' | 'timesheet'
      );

      updatedDocument.finalStoragePath = newFinalStoragePath;
      updatedDocument.finalDownloadUrl = newFinalDownloadUrl;

      // Delete old file if requested
      if (deleteOldFiles) {
        try {
          await deleteDocumentFile(document.finalStoragePath);
          result.deleted++;
        } catch (e) {
          console.warn(`[Migration] Failed to delete old final file: ${e}`);
        }
      }
    } catch (e) {
      console.warn(`[Migration] Failed to migrate final document: ${e}`);
    }
  }

  // Save updated document to Firestore using setDoc directly to update only specific fields
  const { doc, setDoc } = await import('firebase/firestore');
  const { db } = await import('../../firebase');

  const documentRef = doc(db, 'documents', document.id);
  await setDoc(documentRef, updatedDocument, { merge: true });

  console.log(`[Migration] Updated Firestore document ${document.id}`);

  // Delete old storage file if requested
  if (deleteOldFiles && oldStoragePath) {
    try {
      await deleteDocumentFile(oldStoragePath);
      result.deleted++;
      console.log(`[Migration] Deleted old file: ${oldStoragePath}`);
    } catch (e) {
      console.warn(`[Migration] Failed to delete old file ${oldStoragePath}: ${e}`);
    }
  }

  result.migrated++;
}

/**
 * Extract client name from old storage path or document data
 */
function extractClientNameFromPath(storagePath: string | undefined, document: Document): string | null {
  if (storagePath) {
    const parsed = parseOldStoragePath(storagePath);
    if (parsed.clientName) {
      return parsed.clientName;
    }
  }

  // Try to extract from finalStoragePath
  if (document.finalStoragePath) {
    const parsed = parseOldStoragePath(document.finalStoragePath);
    if (parsed.clientName) {
      return parsed.clientName;
    }
  }

  // Check final documents
  if (document.finalDocuments && document.finalDocuments.length > 0) {
    for (const finalDoc of document.finalDocuments) {
      const parsed = parseOldStoragePath(finalDoc.storagePath);
      if (parsed.clientName) {
        return parsed.clientName;
      }
    }
  }

  // If we have client ID but not name, we'd need to fetch it
  // For now, return null and let caller handle
  return null;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Preview what documents would be migrated without making changes
 */
export async function previewMigration(userEmail: string): Promise<{
  totalDocuments: number;
  needsMigration: Document[];
  alreadyCorrect: Document[];
}> {
  const documents = await getDocuments(userEmail);

  const needsMigration: Document[] = [];
  const alreadyCorrect: Document[] = [];

  for (const doc of documents) {
    if (checkIfNeedsMigration(doc)) {
      needsMigration.push(doc);
    } else {
      alreadyCorrect.push(doc);
    }
  }

  return {
    totalDocuments: documents.length,
    needsMigration,
    alreadyCorrect,
  };
}

/**
 * Get migration statistics for a user
 */
export async function getMigrationStats(userEmail: string): Promise<{
  total: number;
  migrated: number;
  needsMigration: number;
  withBase64Data: number;
  withOldPath: number;
}> {
  const documents = await getDocuments(userEmail);

  let migrated = 0;
  let needsMigration = 0;
  let withBase64Data = 0;
  let withOldPath = 0;

  for (const doc of documents) {
    const docWithData = doc as Document & { data?: string; fileData?: string };

    if (!doc.storagePath) {
      needsMigration++;
      if (docWithData.data || docWithData.fileData) {
        withBase64Data++;
      }
    } else if (!isNewPathStructure(doc.storagePath)) {
      needsMigration++;
      withOldPath++;
    } else if (!hasTypeSubfolder(doc.storagePath, doc.type)) {
      needsMigration++;
      withOldPath++;
    } else {
      migrated++;
    }
  }

  return {
    total: documents.length,
    migrated,
    needsMigration,
    withBase64Data,
    withOldPath,
  };
}
