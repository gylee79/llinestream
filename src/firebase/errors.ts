
'use client';

import type { User as AuthUser } from 'firebase/auth';

export type SecurityRuleContext = {
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete' | 'write';
  requestResourceData?: any;
};

interface FirebaseAuthToken {
    name: string | null;
    picture?: string;
    email: string | null;
    email_verified: boolean;
    phone_number: string | null;
    sub: string; // This is the UID
    firebase: {
        identities: Record<string, any>;
        sign_in_provider: string;
        tenant?: string | null;
    };
}

interface FirebaseAuthObject {
    uid: string;
    token: FirebaseAuthToken;
}


interface SecurityRuleRequest {
  auth: FirebaseAuthObject | null; 
  method: string;
  path: string;
  resource?: {
    data: any;
  };
}

function buildAuthObject(currentUser: AuthUser | null): FirebaseAuthObject | null {
    if (!currentUser) {
        return null;
    }

    const token: FirebaseAuthToken = {
        name: currentUser.displayName,
        picture: currentUser.photoURL || undefined,
        email: currentUser.email,
        email_verified: currentUser.emailVerified,
        phone_number: currentUser.phoneNumber,
        sub: currentUser.uid,
        firebase: {
            identities: currentUser.providerData.reduce((acc, p) => {
                if (p.providerId) {
                    // Firebase returns an array of UIDs for each provider, although it's often just one.
                    acc[p.providerId] = [p.uid];
                }
                return acc;
            }, {} as Record<string, any>),
            sign_in_provider: currentUser.providerData[0]?.providerId || 'custom',
            tenant: currentUser.tenantId,
        },
    };

    return {
        uid: currentUser.uid,
        token: token,
    };
}


function buildRequestObject(context: SecurityRuleContext, currentUser: AuthUser | null): SecurityRuleRequest {
  return {
    auth: buildAuthObject(currentUser),
    method: context.operation,
    path: `/databases/(default)/documents/${context.path}`,
    resource: context.requestResourceData ? { data: context.requestResourceData } : undefined,
  };
}

function buildErrorMessage(requestObject: SecurityRuleRequest): string {
  // Use a stable JSON stringification to prevent unnecessary re-renders in DevTools
  const prettyJson = JSON.stringify(requestObject, null, 2);
  return `FirestoreError: Missing or insufficient permissions: The following request was denied by Firestore Security Rules:
${prettyJson}`;
}

export class FirestorePermissionError extends Error {
  public readonly request: SecurityRuleRequest;

  constructor(context: SecurityRuleContext, currentUser: AuthUser | null) {
    const requestObject = buildRequestObject(context, currentUser);
    super(buildErrorMessage(requestObject));
    this.name = 'FirestorePermissionError';
    this.request = requestObject;
  }
}
