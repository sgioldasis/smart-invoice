/**
 * Firebase Storage Service
 *
 * Handles file uploads, downloads, and deletions for:
 * - Templates (invoice/timesheet Excel files)
 * - Documents (generated invoices/timesheets)
 *
 * Storage Structure:
 * /users/{userId}/
 *   /templates/{clientId}/{templateId}/{filename}
 *   /documents/{clientId}/{documentId}/{filename}
 */

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  getBlob,
  uploadString,
} from 'firebase/storage';
import { storage } from '../../firebase';

// ============================================
// Path Builders
// ============================================

function buildTemplatePath(userId: string, clientId: string, templateId: string, fileName: string): string {
  return `users/${userId}/templates/${clientId}/${templateId}/${fileName}`;
}

function buildDocumentPath(userId: string, clientId: string, documentId: string, fileName: string): string {
  return `users/${userId}/documents/${clientId}/${documentId}/${fileName}`;
}

// ============================================
// Template Storage Operations
// ============================================

/**
 * Upload a template file to Firebase Storage
 * Supports both File objects and base64 strings (for migration)
 */
export async function uploadTemplate(
  userId: string,
  clientId: string,
  templateId: string,
  fileName: string,
  data: File | string, // File object or base64 string
  contentType: string = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
): Promise<{ storagePath: string; downloadUrl: string }> {
  const storagePath = buildTemplatePath(userId, clientId, templateId, fileName);
  const storageRef = ref(storage, storagePath);

  let uploadResult;
  if (typeof data === 'string') {
    // Handle base64 string (remove data URL prefix if present)
    const base64Data = data.replace(/^data:[^;]+;base64,/, '');
    uploadResult = await uploadString(storageRef, base64Data, 'base64', {
      contentType,
    });
  } else {
    // Handle File object
    uploadResult = await uploadBytes(storageRef, data, {
      contentType: data.type || contentType,
    });
  }

  const downloadUrl = await getDownloadURL(uploadResult.ref);

  return { storagePath, downloadUrl };
}

/**
 * Download a template file from Firebase Storage
 * Returns the file as a Blob
 */
export async function downloadTemplate(storagePath: string): Promise<Blob> {
  const storageRef = ref(storage, storagePath);
  return getBlob(storageRef);
}

/**
 * Download a template file from Firebase Storage as ArrayBuffer
 * Useful for loading directly into ExcelJS
 */
export async function downloadTemplateAsArrayBuffer(storagePath: string): Promise<ArrayBuffer> {
  const blob = await downloadTemplate(storagePath);
  return blob.arrayBuffer();
}

/**
 * Get download URL for a template
 */
export async function getTemplateDownloadUrl(storagePath: string): Promise<string> {
  const storageRef = ref(storage, storagePath);
  return getDownloadURL(storageRef);
}

/**
 * Delete a template file from Firebase Storage
 */
export async function deleteTemplateFile(storagePath: string): Promise<void> {
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef);
}

// ============================================
// Document Storage Operations
// ============================================

/**
 * Upload a generated document to Firebase Storage
 * Supports both Blob/File objects and base64 strings
 */
export async function uploadDocument(
  userId: string,
  clientId: string,
  documentId: string,
  fileName: string,
  data: Blob | File | string,
  contentType: string = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
): Promise<{ storagePath: string; downloadUrl: string }> {
  const storagePath = buildDocumentPath(userId, clientId, documentId, fileName);
  const storageRef = ref(storage, storagePath);

  let uploadResult;
  if (typeof data === 'string') {
    // Handle base64 string (remove data URL prefix if present)
    const base64Data = data.replace(/^data:[^;]+;base64,/, '');
    uploadResult = await uploadString(storageRef, base64Data, 'base64', {
      contentType,
    });
  } else if (data instanceof File) {
    // Handle File object
    uploadResult = await uploadBytes(storageRef, data, {
      contentType: data.type || contentType,
    });
  } else {
    // Handle Blob
    uploadResult = await uploadBytes(storageRef, data, { contentType });
  }

  const downloadUrl = await getDownloadURL(uploadResult.ref);

  return { storagePath, downloadUrl };
}

/**
 * Download a document from Firebase Storage
 */
export async function downloadDocument(storagePath: string): Promise<Blob> {
  const storageRef = ref(storage, storagePath);
  return getBlob(storageRef);
}

/**
 * Get download URL for a document
 */
export async function getDocumentDownloadUrl(storagePath: string): Promise<string> {
  const storageRef = ref(storage, storagePath);
  return getDownloadURL(storageRef);
}

/**
 * Delete a document file from Firebase Storage
 */
export async function deleteDocumentFile(storagePath: string): Promise<void> {
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef);
}

// ============================================
// Utility Functions
// ============================================

/**
 * Convert a base64 string to a Blob
 */
export function base64ToBlob(base64Data: string, contentType: string = 'application/octet-stream'): Blob {
  // Remove data URL prefix if present
  const base64 = base64Data.replace(/^data:[^;]+;base64,/, '');

  const byteCharacters = atob(base64);
  const byteArrays: ArrayBuffer[] = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers).buffer;
    byteArrays.push(byteArray);
  }

  return new Blob(byteArrays, { type: contentType });
}

/**
 * Convert a File to base64 string
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
}

/**
 * Extract file extension from filename
 */
export function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot !== -1 ? fileName.slice(lastDot + 1).toLowerCase() : '';
}

/**
 * Determine content type based on file extension
 */
export function getContentType(fileName: string): string {
  const ext = getFileExtension(fileName);
  const mimeTypes: Record<string, string> = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    csv: 'text/csv',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}
