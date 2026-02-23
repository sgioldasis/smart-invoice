/**
 * Firebase Storage Service
 *
 * Handles file uploads, downloads, and deletions for:
 * - Templates (invoice/timesheet Excel files)
 * - Documents (generated invoices/timesheets)
 *
 * Storage Structure:
 * /users/{userId}/
 *   /{sanitized-client-name}/
 *     /templates/{filename}              - Client default templates
 *     /{YYYY-MM}/
 *       /{filename}                      - Documents (invoices, timesheets)
 *       /templates/{filename}            - Month-specific templates
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
// Client Name Sanitization
// ============================================

/**
 * Sanitize a client name to be filesystem-safe
 * - Removes/replaces special characters
 * - Limits length
 * - Handles edge cases like empty names
 * 
 * Examples:
 *   "Acme Corp" -> "Acme_Corp"
 *   "Client @ Home!" -> "Client___Home_"
 *   "Very Long Client Name..." -> "Very_Long_Client_Name_..." (truncated)
 */
export function sanitizeClientName(clientName: string): string {
  if (!clientName || typeof clientName !== 'string') {
    return 'unnamed-client';
  }
  
  // Trim and limit length
  const trimmed = clientName.trim().slice(0, 50);
  
  // Replace unsafe characters with underscores
  // Safe: alphanumeric, hyphen, underscore
  // Unsafe: spaces, slashes, dots, control chars, etc.
  const sanitized = trimmed
    .replace(/[^a-zA-Z0-9\-_]/g, '_')  // Replace unsafe chars with underscore
    .replace(/_{2,}/g, '_')              // Collapse multiple underscores
    .replace(/^_+|_+$/g, '');             // Trim leading/trailing underscores
  
  return sanitized || 'unnamed-client';
}

/**
 * Sanitize user email for use in Firebase Storage paths
 * Emails contain @ and . which need special handling
 *
 * Rules:
 *   - Replace @ with _at_
 *   - Replace . with _dot_
 *   - Keep alphanumeric, hyphen, underscore
 *   - Truncate to 100 chars max
 *
 * Examples:
 *   "user@example.com" -> "user_at_example_dot_com"
 *   "john.doe@company.co.uk" -> "john_dot_doe_at_company_dot_co_dot_uk"
 */
export function sanitizeUserEmail(email: string): string {
  if (!email || typeof email !== 'string') {
    return 'unknown-user';
  }
  
  const trimmed = email.trim().toLowerCase().slice(0, 100);
  
  const sanitized = trimmed
    .replace(/@/g, '_at_')
    .replace(/\./g, '_dot_')
    .replace(/[^a-zA-Z0-9\-_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  
  return sanitized || 'unknown-user';
}

// ============================================
// Path Builders
// ============================================

// NOTE: Using user email instead of user ID for more readable paths
// The email is sanitized to be filesystem-safe

/**
 * Build path for client-level template (default template for a client)
 */
function buildClientTemplatePath(userEmail: string, clientName: string, fileName: string): string {
  return `users/${sanitizeUserEmail(userEmail)}/${sanitizeClientName(clientName)}/templates/${fileName}`;
}

/**
 * Build path for month-specific template (overrides client default for a specific month)
 * Stored in: {clientName}/{month}/templates/{filename}
 */
function buildMonthTemplatePath(userEmail: string, clientName: string, month: string, fileName: string): string {
  return `users/${sanitizeUserEmail(userEmail)}/${sanitizeClientName(clientName)}/${month}/templates/${fileName}`;
}

/**
 * Build path for documents (invoices, timesheets) stored in month folder
 * Stored in: {clientName}/{month}/{filename}
 */
function buildDocumentPath(userEmail: string, clientName: string, month: string, fileName: string): string {
  return `users/${sanitizeUserEmail(userEmail)}/${sanitizeClientName(clientName)}/${month}/${fileName}`;
}

// ============================================
// Template Storage Operations
// ============================================

/**
 * Upload a template file to Firebase Storage
 * Supports both File objects and base64 strings (for migration)
 *
 * @param userEmail - User email (will be sanitized for the path)
 * @param clientName - Client name (will be sanitized for the path)
 * @param month - Optional month (YYYY-MM). If provided, stores as month-specific template.
 *                 If omitted, stores as client default template.
 */
export async function uploadTemplate(
  userEmail: string,
  clientName: string,
  fileName: string,
  data: File | string, // File object or base64 string
  month?: string, // YYYY-MM format for month-specific templates
  contentType: string = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
): Promise<{ storagePath: string; downloadUrl: string }> {
  const storagePath = month
    ? buildMonthTemplatePath(userEmail, clientName, month, fileName)
    : buildClientTemplatePath(userEmail, clientName, fileName);
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
 * Documents are stored in a flat structure under {clientName}/{month}/
 *
 * @param userEmail - User email (will be sanitized for the path)
 * @param clientName - Client name (will be sanitized for the path)
 */
export async function uploadDocument(
  userEmail: string,
  clientName: string,
  month: string, // YYYY-MM format
  fileName: string,
  data: Blob | File | string,
  contentType: string = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
): Promise<{ storagePath: string; downloadUrl: string }> {
  const storagePath = buildDocumentPath(userEmail, clientName, month, fileName);
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
