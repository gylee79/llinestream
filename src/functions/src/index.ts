
'use server';

import { onDocumentWritten, type Change, type FirestoreEvent } from 'firebase-functions/v2/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type DocumentData, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { ai } from './genkit.js';
import { z } from 'zod';
import { setGlobalOptions } from 'firebase-functions/v2';
import type { FileDataPart } from '@google/generative-ai';

// Cloud Functions 리전 및 옵션 설정 (중요)
setGlobalOptions({ region: 'asia-northeast3' });

// Firebase Admin SDK 초기화 (ESM 방식)
if (!getApps().length)