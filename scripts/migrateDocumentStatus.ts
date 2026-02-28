/**
 * Document Status Migration Script
 *
 * This script updates the status field of all documents in Firestore
 * based on their finalDocuments array or file data.
 *
 * Usage:
 *   npx ts-node scripts/migrateDocumentStatus.ts
 *
 * The script will:
 * 1. Fetch all documents from the 'documents' collection
 * 2. Check each document for finalDocuments, finalStoragePath, or excelBase64
 * 3. Optionally verify files exist in Firebase Storage
 * 4. Update the status field to reflect the actual file state:
 *    - 'pdf-uploaded' if PDF files exist in finalDocuments
 *    - 'excel-uploaded' if only Excel files exist
 *    - Keep 'sent' or 'paid' if already set
 *    - 'generated' if no files exist
 *
 * New Features:
 * - Storage file existence verification (optional)
 * - Batch processing with progress reporting
 * - Detailed summary report with missing file tracking
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  getDocs,
  updateDoc,
  doc,
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  getMetadata,
} from 'firebase/storage';
import * as readline from 'readline';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC0I4rS4HH4Vp09YjzdCD5q-9R4l5_0qBE",
  authDomain: "smart-invoice-27748.firebaseapp.com",
  projectId: "smart-invoice-27748",
  storageBucket: "smart-invoice-27748.firebasestorage.app",
  messagingSenderId: "132403927681",
  appId: "1:132403927681:web:40b61446d1f7a1f59beac9"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Configuration
const BATCH_SIZE = 50; // Process documents in batches
const STORAGE_CHECK_TIMEOUT = 5000; // 5 second timeout for storage checks

interface FinalDocumentInfo {
  id: string;
  fileName: string;
  storagePath: string;
  fileExtension: string;
}

interface DocumentData {
  id: string;
  status?: string;
  finalDocuments?: FinalDocumentInfo[];
  finalStoragePath?: string;
  finalFileName?: string;
  finalDownloadUrl?: string;
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

interface FileExistenceResult {
  exists: boolean;
  path: string;
  error?: string;
}

interface DocumentFileStatus {
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

interface MigrationResult {
  totalDocuments: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: string[];
  changes: Array<{
    id: string;
    documentNumber?: string;
    oldStatus: string;
    newStatus: string;
    reason: string;
  }>;
  fileVerification?: {
    checked: number;
    exists: number;
    missing: number;
    missingFiles: Array<{ docId: string; path: string; fileName: string }>;
  };
}

function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Check if a file exists in Firebase Storage
 */
async function checkFileExists(storagePath: string): Promise<FileExistenceResult> {
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
 */
async function verifyDocumentFiles(doc: DocumentData): Promise<DocumentFileStatus> {
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
async function verifyFilesBatch(
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
 * Determine the effective status based on document files
 * Can optionally consider file existence verification results
 */
function determineEffectiveStatus(
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

async function fetchAllDocuments(): Promise<DocumentData[]> {
  console.log('📥 Fetching all documents from Firestore...');
  
  const q = query(collection(db, 'documents'));
  const snapshot = await getDocs(q);
  
  const documents: DocumentData[] = snapshot.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data(),
  } as DocumentData));
  
  console.log(`   Found ${documents.length} documents total\n`);
  return documents;
}

async function updateDocumentStatus(docId: string, newStatus: string, dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    return true;
  }
  
  try {
    const docRef = doc(db, 'documents', docId);
    await updateDoc(docRef, { status: newStatus });
    return true;
  } catch (error: any) {
    console.error(`   ❌ Error updating ${docId}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('📄 Document Status Migration Tool');
  console.log('='.repeat(70));
  console.log();
  console.log('This script will update document status based on existing files.');
  console.log('Status hierarchy: paid > sent > pdf-uploaded > excel-uploaded > generated');
  console.log();
  
  try {
    // Ask if user wants to verify file existence in Storage
    const verifyFilesAnswer = await askQuestion('Verify file existence in Firebase Storage? [y/N]: ');
    const verifyFiles = verifyFilesAnswer.toLowerCase() === 'y';
    
    // Fetch all documents
    const documents = await fetchAllDocuments();
    
    if (documents.length === 0) {
      console.log('❌ No documents found in Firestore.');
      process.exit(0);
    }
    
    // File verification phase
    let fileVerificationResults: DocumentFileStatus[] = [];
    if (verifyFiles) {
      console.log('\n🔍 Verifying file existence in Firebase Storage...\n');
      fileVerificationResults = await verifyFilesBatch(documents, (checked, total) => {
        process.stdout.write(`   Progress: ${checked}/${total} documents checked\r`);
      });
      console.log(`\n   ✅ Verified ${fileVerificationResults.length} documents`);
      
      // Show file existence summary
      const totalFiles = fileVerificationResults.reduce((sum, r) => sum + r.files.length, 0);
      const existingFiles = fileVerificationResults.reduce((sum, r) =>
        sum + r.files.filter(f => f.exists).length, 0);
      const missingFiles = totalFiles - existingFiles;
      const docsWithMissingFiles = fileVerificationResults.filter(r => r.missingFiles.length > 0);
      
      console.log(`\n📊 File Verification Summary:`);
      console.log(`   Total files referenced: ${totalFiles}`);
      console.log(`   Files exist: ${existingFiles}`);
      console.log(`   Files missing: ${missingFiles}`);
      console.log(`   Documents with missing files: ${docsWithMissingFiles.length}`);
      
      if (docsWithMissingFiles.length > 0) {
        console.log(`\n⚠️  Documents with missing files:`);
        docsWithMissingFiles.forEach(status => {
          console.log(`   - ${status.documentNumber || status.docId} (${status.clientName || 'Unknown'}): ${status.missingFiles.join(', ')}`);
        });
      }
      console.log();
    }
    
    // Analyze documents
    console.log('🔍 Analyzing document statuses...\n');
    
    const result: MigrationResult = {
      totalDocuments: documents.length,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
      changes: [],
    };
    
    const documentsToUpdate: Array<{
      doc: DocumentData;
      newStatus: string;
      reason: string;
      needsBothFiles?: boolean;
    }> = [];
    
    for (const doc of documents) {
      const currentStatus = doc.status || 'generated';
      const fileStatus = verifyFiles ? fileVerificationResults.find(r => r.docId === doc.id) : undefined;
      const { status: effectiveStatus, reason } = determineEffectiveStatus(doc, fileStatus);
      
      // Check if we need to add both files to finalDocuments
      const needsBothFiles = doc.storagePath?.toLowerCase().endsWith('.pdf') &&
                           doc.storagePath.includes('/invoice/') &&
                           !doc.finalDocuments?.some(fd => fd.fileExtension === 'xlsx');
      
      if (currentStatus !== effectiveStatus || needsBothFiles) {
        documentsToUpdate.push({
          doc,
          newStatus: effectiveStatus,
          reason,
          needsBothFiles
        });
        result.changes.push({
          id: doc.id,
          documentNumber: doc.documentNumber,
          oldStatus: currentStatus,
          newStatus: effectiveStatus,
          reason,
        });
      } else {
        result.skippedCount++;
      }
    }
    
    // Show analysis results
    console.log(`📊 Analysis Results:`);
    console.log(`   Total documents: ${result.totalDocuments}`);
    console.log(`   Documents to update: ${documentsToUpdate.length}`);
    console.log(`   Already correct: ${result.skippedCount}`);
    console.log();
    
    if (documentsToUpdate.length === 0) {
      console.log('✅ All documents have correct status!');
      process.exit(0);
    }
    
    // Show changes
    console.log('📝 Changes to be made:\n');
    documentsToUpdate.forEach(({ doc, newStatus, reason }, idx) => {
      const currentStatus = doc.status || 'generated';
      console.log(`${idx + 1}. ${doc.documentNumber || doc.id} (${doc.clientName || 'Unknown'})`);
      console.log(`   ${currentStatus} → ${newStatus}`);
      console.log(`   Reason: ${reason}`);
      if (doc.finalDocuments) {
        console.log(`   Files: ${doc.finalDocuments.map(fd => fd.fileName || fd.fileExtension).join(', ')}`);
      }
      console.log();
    });
    
    // Ask for confirmation
    const dryRunAnswer = await askQuestion('Run in dry-run mode first? [Y/n]: ');
    const dryRun = dryRunAnswer.toLowerCase() !== 'n';
    
    if (dryRun) {
      console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
      console.log('The following would be updated:');
      documentsToUpdate.forEach(({ doc, newStatus }) => {
        const currentStatus = doc.status || 'generated';
        console.log(`  ${doc.id}: ${currentStatus} → ${newStatus}`);
      });
      
      const confirmReal = await askQuestion('\nRun with actual updates? [y/N]: ');
      if (confirmReal.toLowerCase() !== 'y') {
        console.log('\n❌ Cancelled.');
        process.exit(0);
      }
      console.log('\n🚀 Running with actual updates...\n');
    }
    
    // Perform updates
    console.log('🔄 Updating documents...\n');
    
    for (const { doc, newStatus } of documentsToUpdate) {
      const success = await updateDocumentStatus(doc.id, newStatus, false);
      if (success) {
        result.updatedCount++;
        console.log(`   ✅ ${doc.id}: ${doc.status || 'generated'} → ${newStatus}`);
      } else {
        result.failedCount++;
        result.errors.push(`Failed to update ${doc.id}`);
      }
    }
    
    // Build file verification summary if applicable
    if (verifyFiles && fileVerificationResults.length > 0) {
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
    }
    
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 Migration Summary');
    console.log('='.repeat(70));
    console.log(`   Total documents: ${result.totalDocuments}`);
    console.log(`   Updated: ${result.updatedCount}`);
    console.log(`   Skipped (already correct): ${result.skippedCount}`);
    console.log(`   Failed: ${result.failedCount}`);
    
    // File verification summary
    if (result.fileVerification) {
      console.log('\n📁 File Verification:');
      console.log(`   Files checked: ${result.fileVerification.checked}`);
      console.log(`   Files exist: ${result.fileVerification.exists}`);
      console.log(`   Files missing: ${result.fileVerification.missing}`);
      
      if (result.fileVerification.missingFiles.length > 0) {
        console.log('\n   Missing file details:');
        result.fileVerification.missingFiles.forEach(mf => {
          console.log(`     - ${mf.fileName} (${mf.docId})`);
        });
      }
    }
    
    // Status breakdown
    if (result.changes.length > 0) {
      const statusCounts = result.changes.reduce((acc, change) => {
        acc[change.newStatus] = (acc[change.newStatus] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      console.log('\n📈 New Status Distribution:');
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`   ${status}: ${count}`);
      });
    }
    
    if (result.errors.length > 0) {
      console.log('\n   Errors:');
      result.errors.forEach(err => console.log(`   - ${err}`));
    }
    
    console.log('\n✅ Done!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
main();
