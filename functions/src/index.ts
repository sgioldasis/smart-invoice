/**
 * SmartInvoice Firebase Cloud Functions
 * 
 * NOTE: These functions are currently not in use.
 * AI processing is done directly in the frontend using Gemini API (src/services/ai.ts).
 * This file is kept as a placeholder for future server-side functionality.
 */

import { setGlobalOptions } from "firebase-functions";

// Set global options for all functions
setGlobalOptions({ maxInstances: 10 });

// No active Cloud Functions - all AI processing is done client-side
// See src/services/ai.ts for the Gemini API integration
