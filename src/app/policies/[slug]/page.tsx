
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Policy } from '@/lib/types';
import * as admin from 'firebase-admin';

// Helper function to initialize Firebase Admin SDK
function initializeAdminApp(): admin.app.App {
  if (admin.apps.length) {
    return admin.apps[0] as admin.app.App;
  }
  
  const serviceAccountEnv = process.env.FIREBASE_ADMIN_SDK_CONFIG;
  if (!serviceAccountEnv) {
    throw new Error("FIREBASE_ADMIN_SDK_CONFIG is not set. Server-side features will fail.");
  }
  try {
    const serviceAccount = JSON.parse(serviceAccountEnv);
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
     console.error("Failed to parse FIREBASE_ADMIN_SDK_CONFIG.", error);
     throw new Error("Failed to initialize Firebase Admin SDK. Check server logs.");
  }
}

async function getPolicy(slug: string): Promise<Policy | null> {
    try {
        const adminApp = initializeAdminApp();
        const firestore = admin.firestore(adminApp);
        const policyRef = firestore.collection('policies').doc(slug);
        const docSnap = await policyRef.get();

        if (!docSnap.exists) {
            return null;
        }
        
        const data = docSnap.data() as Omit<Policy, 'id'>;
        return {
            id: docSnap.id,
            ...data,
        } as Policy;

    } catch (error) {
        console.error(`Failed to fetch policy for slug: ${slug}`, error);
        return null;
    }
}


interface PolicyPageProps {
  params: { slug: string };
}

// This is now a React Server Component
export default async function PolicyPage({ params }: PolicyPageProps) {
  const policy = await getPolicy(params.slug);

  if (!policy) {
    notFound();
  }

  return (
    <div className="container mx-auto max-w-4xl py-12">
      <Card>
        <CardHeader>
          <CardTitle className="font-headline text-3xl">{policy.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="prose dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: policy.content.replace(/\n/g, '<br />') }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
