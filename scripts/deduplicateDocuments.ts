/**
 * Deduplicate Documents Script
 * 
 * This script finds and deletes duplicate documents from Firestore.
 * Documents are considered duplicates if they share the same workRecordId and type.
 * The most recent document (by generatedAt) is kept, others are deleted.
 * 
 * Usage:
 *   npx ts-node scripts/deduplicateDocuments.ts
 * 
 * The script will:
 * 1. Fetch all documents from the 'documents' collection
 * 2. Group them by workRecordId + type
 * 3. For each group with duplicates, keep the most recent, delete the rest
 * 4. Only deletes Firestore documents, NOT storage files
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  getDocs,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import * as readline from 'readline';

// Firebase configuration - matches your firebase.ts
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

interface DocumentData {
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

interface DuplicateGroup {
  key: string;
  documents: DocumentData[];
  keep: DocumentData;
  delete: DocumentData[];
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return 'unknown';
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
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

export async function fetchAllDocuments(): Promise<DocumentData[]> {
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

export function findDuplicates(documents: DocumentData[]): DuplicateGroup[] {
  console.log('🔍 Analyzing for duplicates...');
  
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

export async function deleteDocument(docData: DocumentData, dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    console.log(`   📝 [DRY RUN] Would delete document: ${docData.id}`);
    console.log(`      - Client: ${docData.clientName || 'N/A'}`);
    console.log(`      - Month: ${docData.month || 'N/A'}`);
    console.log(`      - Generated: ${formatDate(docData.generatedAt)}`);
    return true;
  }
  
  try {
    // Delete only the Firestore document (NOT storage files)
    await deleteDoc(doc(db, 'documents', docData.id));
    console.log(`   ✅ Deleted document: ${docData.id}`);
    return true;
  } catch (error: any) {
    console.error(`   ❌ Error deleting document ${docData.id}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('🔥 Firestore Document Deduplication Tool');
  console.log('='.repeat(60));
  console.log();
  
  try {
    // Fetch all documents
    const documents = await fetchAllDocuments();
    
    if (documents.length === 0) {
      console.log('❌ No documents found in Firestore.');
      process.exit(0);
    }
    
    // Find duplicates
    const duplicates = findDuplicates(documents);
    
    if (duplicates.length === 0) {
      console.log('✅ No duplicate documents found!');
      process.exit(0);
    }
    
    // Show duplicate summary
    console.log(`⚠️  Found ${duplicates.length} groups with duplicates:\n`);
    
    let totalDuplicates = 0;
    duplicates.forEach((group, index) => {
      console.log(`${index + 1}. ${group.key}`);
      console.log(`   📄 Keeping:  ${group.keep.id} (${formatDate(group.keep.generatedAt)})`);
      group.delete.forEach((dup, i) => {
        console.log(`   🗑️  Delete ${i + 1}: ${dup.id} (${formatDate(dup.generatedAt)})`);
        totalDuplicates++;
      });
      console.log();
    });
    
    console.log(`Total duplicates to delete: ${totalDuplicates}\n`);
    
    // Ask for dry run
    const dryRunAnswer = await askQuestion('Run in dry-run mode first? (see what would be deleted) [Y/n]: ');
    const dryRun = dryRunAnswer.toLowerCase() !== 'n';
    
    if (dryRun) {
      console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
    }
    
    // Process deletions
    let successCount = 0;
    let failCount = 0;
    
    for (const group of duplicates) {
      console.log(`\n📁 Processing: ${group.key}`);
      console.log(`   Keeping: ${group.keep.id}`);
      
      for (const docToDelete of group.delete) {
        const success = await deleteDocument(docToDelete, dryRun);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary');
    console.log('='.repeat(60));
    console.log(`   Groups processed: ${duplicates.length}`);
    console.log(`   Documents ${dryRun ? 'that would be' : ''} deleted: ${successCount}`);
    if (failCount > 0) {
      console.log(`   Failed deletions: ${failCount}`);
    }
    
    if (dryRun && successCount > 0) {
      const confirmDelete = await askQuestion('\n⚠️  Run again with actual deletion? [y/N]: ');
      if (confirmDelete.toLowerCase() === 'y') {
        console.log('\n🚀 Running with actual deletion...\n');
        // Re-run the deletion loop without dry run
        successCount = 0;
        failCount = 0;
        
        for (const group of duplicates) {
          console.log(`\n📁 Processing: ${group.key}`);
          console.log(`   Keeping: ${group.keep.id}`);
          
          for (const docToDelete of group.delete) {
            const success = await deleteDocument(docToDelete, false);
            if (success) {
              successCount++;
            } else {
              failCount++;
            }
          }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 Final Summary');
        console.log('='.repeat(60));
        console.log(`   Groups processed: ${duplicates.length}`);
        console.log(`   Documents deleted: ${successCount}`);
        if (failCount > 0) {
          console.log(`   Failed deletions: ${failCount}`);
        }
      }
    }
    
    console.log('\n✅ Done!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  main();
}
