# Document Status System Implementation Plan

## Overview
Implement a status tracking system for documents (invoices and timesheets) to track them through the workflow: Generated → Final → Sent → Paid (invoices only).

## Status Workflow

```
┌─────────────┐     Upload Final      ┌─────────┐     Mark Sent      ┌────────┐
│  Generated  │ ────────────────────> │  Final  │ ────────────────>  │  Sent  │
│  (Excel)    │                       │(PDF/Excel)                   │        │
└─────────────┘                       └─────────┘                    └────┬───┘
       ^                                                                  │
       │         (Invoices only)                                          │
       └──────────────────────────────────────────────────────────────────┘
                                    Mark Paid
```

## Status Types

| Status | Description | Date Field | Documents |
|--------|-------------|------------|-----------|
| `generated` | Initial Excel generated from template | `generatedAt` | Both |
| `final` | Final document uploaded (replaces generated) | `finalizedAt` | Both |
| `sent` | Document sent to client | `sentAt` | Both |
| `paid` | Invoice paid by client | `paidAt` | Invoice only |

## Type Definitions

### New Types (add to `src/types/index.ts`)

```typescript
// Status type for documents
export type DocumentStatus = 'generated' | 'final' | 'sent' | 'paid';

// Status history entry for audit trail
export interface StatusHistoryEntry {
  status: DocumentStatus;
  timestamp: string; // ISO timestamp
  note?: string; // Optional note about the status change
}

// Updated Document interface
export interface Document {
  id: string;
  userEmail: string;
  clientId: string;
  workRecordId: string;
  type: DocumentType;
  documentNumber: string;
  
  // Snapshot of work data (immutable)
  month: string;
  workingDays: number;
  workingDaysArray: string[];
  weekendDatesArray?: string[];
  dailyRate: number;
  totalAmount: number;
  
  // Status tracking
  status: DocumentStatus;
  statusHistory: StatusHistoryEntry[];
  
  // Status dates
  generatedAt: string;
  finalizedAt?: string; // When marked as final
  sentAt?: string;      // When marked as sent
  paidAt?: string;      // When marked as paid (invoices only)
  
  // Storage: Generated version (Excel from template)
  storagePath: string;
  downloadUrl: string;
  fileName?: string;
  
  // Storage: Final version (uploaded PDF/Excel)
  finalStoragePath?: string;
  finalDownloadUrl?: string;
  finalFileName?: string;
  
  // Legacy/deprecated fields (for backward compatibility)
  isPaid?: boolean;
  isOutdated?: boolean;
  outdatedAt?: string;
}

// Updated DocumentInput interface
export interface DocumentInput {
  userEmail?: string;
  clientId: string;
  clientName: string;
  workRecordId: string;
  type: DocumentType;
  documentNumber: string;
  month: string;
  workingDays: number;
  workingDaysArray: string[];
  weekendDatesArray?: string[];
  dailyRate: number;
  totalAmount: number;
  
  // Status (defaults to 'generated')
  status?: DocumentStatus;
  statusHistory?: StatusHistoryEntry[];
  
  // Dates
  generatedAt?: string;
  finalizedAt?: string | null;
  sentAt?: string | null;
  paidAt?: string | null;
  
  // Storage paths
  fileName?: string;
  storagePath: string;
  downloadUrl: string;
  finalStoragePath?: string | null;
  finalDownloadUrl?: string | null;
  finalFileName?: string | null;
  
  // Legacy
  isPaid?: boolean;
  paidAt?: string;
  isOutdated?: boolean;
  outdatedAt?: string | null;
}
```

## Database Service Changes (`src/services/db.ts`)

### New Functions

```typescript
/**
 * Update document status with history tracking
 */
export async function updateDocumentStatus(
  userEmail: string,
  documentId: string,
  newStatus: DocumentStatus,
  note?: string
): Promise<void>;

/**
 * Upload final version of a document (replaces generated version)
 */
export async function uploadFinalDocument(
  userEmail: string,
  documentId: string,
  file: File,
  note?: string
): Promise<{ finalStoragePath: string; finalDownloadUrl: string }>;

/**
 * Mark document as sent to client
 */
export async function markDocumentSent(
  userEmail: string,
  documentId: string,
  note?: string
): Promise<void>;

/**
 * Mark invoice as paid
 */
export async function markInvoicePaid(
  userEmail: string,
  documentId: string,
  note?: string
): Promise<void>;

/**
 * Get status history for a document
 */
export async function getDocumentStatusHistory(
  userEmail: string,
  documentId: string
): Promise<StatusHistoryEntry[]>;
```

### Modified Functions

```typescript
// saveDocument - Update to set default status
export async function saveDocument(
  userEmail: string,
  data: DocumentInput
): Promise<Document> {
  // Set default status and history if not provided
  const now = new Date().toISOString();
  const documentData = {
    ...data,
    status: data.status || 'generated',
    statusHistory: data.statusHistory || [
      { status: 'generated', timestamp: now, note: 'Document generated' }
    ],
    generatedAt: data.generatedAt || now,
  };
  // ... rest of implementation
}
```

## Storage Service Changes (`src/services/storage.ts`)

### New Functions

```typescript
/**
 * Upload final version of a document
 * Overwrites any existing final version
 */
export async function uploadFinalDocument(
  userEmail: string,
  clientName: string,
  month: string,
  fileName: string,
  data: Blob | File,
  contentType?: string
): Promise<{ finalStoragePath: string; finalDownloadUrl: string }>;

/**
 * Delete final version of a document
 */
export async function deleteFinalDocument(
  finalStoragePath: string
): Promise<void>;

/**
 * Get download URL for final document
 */
export async function getFinalDocumentUrl(
  finalStoragePath: string
): Promise<string>;
```

## UI Components Changes

### DocumentManager Component

Add to each document card:
1. **Status Badge** - Color-coded badge showing current status
   - Generated: Blue (`bg-blue-100 text-blue-700`)
   - Final: Purple (`bg-purple-100 text-purple-700`)
   - Sent: Green (`bg-green-100 text-green-700`)
   - Paid: Emerald (`bg-emerald-100 text-emerald-700`)

2. **Status Timeline** - Visual timeline showing status progression with dates

3. **Action Buttons** (contextual based on status):
   - **Generated**: "Upload Final" button
   - **Final**: "Mark as Sent" button, "Re-upload Final" button
   - **Sent**: "Mark as Paid" (invoices only), "Re-upload Final" button
   - **Paid**: View only, "Mark as Unpaid" option

4. **Status History** - Expandable section showing status change history

### WorkRecordList Component

Add status indicators to document list items:
1. Small colored dot next to document name indicating status
2. Hover tooltip showing status name and date
3. Quick actions based on status (e.g., quick "Mark Sent" button)

### InvoiceGenerator Component

1. After successful generation, show success message with current status
2. Option to immediately upload final version
3. Status indicator in the generation dialog

## Firestore Rules Updates

Add to `firestore.rules`:

```javascript
// Allow users to update status on their own documents
function canUpdateDocumentStatus(userEmail, documentId) {
  return isAuthenticated() && 
         request.auth.token.email == userEmail;
}

// Allow status field updates
match /documents/{documentId} {
  allow update: if canUpdateDocumentStatus(resource.data.userEmail, documentId)
                && request.resource.data.diff(resource.data).affectedKeys()
                   .hasOnly(['status', 'statusHistory', 'finalizedAt', 'sentAt', 
                            'paidAt', 'finalStoragePath', 'finalDownloadUrl', 
                            'finalFileName', 'updatedAt']);
}
```

## Migration Plan

### For Existing Documents

Create a migration script to:
1. Set `status` field based on existing data:
   - If `isPaid` is true → status: 'paid'
   - Else if `downloadUrl` exists → status: 'generated'
   - Default → status: 'generated'
2. Set `statusHistory` with single entry:
   ```javascript
   statusHistory: [{
     status: document.status,
     timestamp: document.generatedAt || new Date().toISOString(),
     note: 'Migrated from legacy data'
   }]
   ```
3. Keep `isPaid` and `paidAt` for backward compatibility

## Implementation Order

1. **Phase 1: Types and Database**
   - Update type definitions
   - Add database service functions
   - Update storage service functions

2. **Phase 2: Firestore Rules**
   - Update security rules

3. **Phase 3: UI Components**
   - Update DocumentManager with status UI
   - Update WorkRecordList with status indicators
   - Update InvoiceGenerator to set status

4. **Phase 4: Migration**
   - Create and run migration script
   - Verify all existing documents have status

## Visual Status Indicators

| Status | Color | Icon | Description |
|--------|-------|------|-------------|
| generated | Blue | FileSpreadsheet | Excel generated from template |
| final | Purple | Upload | Final version uploaded |
| sent | Green | Send | Sent to client |
| paid | Emerald | CheckCircle | Invoice paid |

## Status Transitions Validation

Valid transitions:
- `generated` → `final` (upload final version)
- `final` → `sent` (mark as sent)
- `sent` → `paid` (invoices only, mark as paid)
- `final` → `final` (re-upload final version)
- `sent` → `final` (re-upload final after sending)

Invalid transitions (should be blocked):
- `generated` → `sent` (must upload final first)
- `paid` → `sent` (cannot un-pay)
- `paid` → `final` (cannot modify paid invoice)
