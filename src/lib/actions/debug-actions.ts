'use server';

import { config } from 'dotenv';
config();

import { initializeAdminApp } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';

export async function logDebugMessage(message: string, context?: any): Promise<void> {
  try {
    const adminApp = initializeAdminApp();
    const db = admin.firestore(adminApp);
    
    // Sanitize context to ensure it's Firestore-compatible
    const sanitizedContext = context ? JSON.parse(JSON.stringify(context, (key, value) => 
        typeof value === 'bigint' ? value.toString() : value
    )) : null;
    
    await db.collection('debug_logs').add({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      message,
      context: sanitizedContext,
    });
  } catch (error) {
    console.error('Failed to log debug message:', error);
    // This function should not throw, as it's a debugging tool.
  }
}
