'use server';

import { writeBatch, collection, doc } from 'firebase/firestore';
import { fields, classifications, courses, episodes } from '@/lib/data';
import { getSdks } from '@/firebase';
import { initializeApp, getApps } from 'firebase/app';
import { firebaseConfig } from '@/firebase/config';

export async function uploadMockData() {
  console.log('Starting data upload...');
  
  let app;
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  const { firestore } = getSdks(app);

  const batch = writeBatch(firestore);

  try {
    // Upload Fields
    console.log(`Uploading ${fields.length} fields...`);
    fields.forEach((item) => {
      const docRef = doc(firestore, 'fields', item.id);
      batch.set(docRef, item);
    });

    // Upload Classifications
    console.log(`Uploading ${classifications.length} classifications...`);
    classifications.forEach((item) => {
      const docRef = doc(firestore, 'classifications', item.id);
      batch.set(docRef, item);
    });

    // Upload Courses
    console.log(`Uploading ${courses.length} courses...`);
    courses.forEach((item) => {
      const docRef = doc(firestore, 'courses', item.id);
      batch.set(docRef, item);
    });

    // Upload Episodes
    console.log(`Uploading ${episodes.length} episodes...`);
    episodes.forEach((item) => {
      const courseCollectionRef = collection(firestore, 'courses', item.courseId, 'episodes');
      const docRef = doc(courseCollectionRef, item.id);
      batch.set(docRef, item);
    });
    
    await batch.commit();
    console.log('Batch commit successful!');
    return { success: true, message: 'All mock data uploaded successfully.' };

  } catch (error) {
    console.error('Error uploading mock data:', error);
    if (error instanceof Error) {
        return { success: false, message: `Upload failed: ${error.message}` };
    }
    return { success: false, message: 'An unknown error occurred during upload.' };
  }
}
