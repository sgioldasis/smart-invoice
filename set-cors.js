/**
 * Script to set CORS configuration on Firebase Storage bucket
 * Run: node set-cors.js
 */

const { Storage } = require('@google-cloud/storage');

const BUCKET_NAME = 'smart-invoice-16f95.firebasestorage.app';

const corsConfiguration = [
  {
    origin: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'],
    method: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'],
    maxAgeSeconds: 3600,
    responseHeader: ['Content-Type', 'Authorization', 'x-goog-resumable', 'Content-Disposition'],
  },
];

async function configureCors() {
  const storage = new Storage();
  const bucket = storage.bucket(BUCKET_NAME);

  try {
    await bucket.setCorsConfiguration(corsConfiguration);
    console.log(`CORS configuration set successfully on ${BUCKET_NAME}`);
  } catch (error) {
    console.error('Error setting CORS:', error.message);
    console.log('\nMake sure you have:');
    console.log('1. Installed @google-cloud/storage: npm install @google-cloud/storage');
    console.log('2. Authenticated with Google Cloud: gcloud auth application-default login');
  }
}

configureCors();
