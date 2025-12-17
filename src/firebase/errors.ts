'use client';

type SecurityRuleContext = {
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete' | 'write';
  requestResourceData?: any;
};

interface SecurityRuleRequest {
  auth: { uid: string } | null; // Simplified auth object
  method: string;
  path: string;
  resource?: {
    data: any;
  };
}

function buildRequestObject(context: SecurityRuleContext, uid: string | null): SecurityRuleRequest {
  return {
    auth: uid ? { uid } : null,
    method: context.operation,
    path: `/databases/(default)/documents/${context.path}`,
    resource: context.requestResourceData ? { data: context.requestResourceData } : undefined,
  };
}

function buildErrorMessage(requestObject: SecurityRuleRequest): string {
  // Simplified error message for stability
  return `FirebaseError: Missing or insufficient permissions. Request details: ${JSON.stringify({
    path: requestObject.path,
    method: requestObject.method,
    auth: requestObject.auth,
  })}`;
}

export class FirestorePermissionError extends Error {
  public readonly request: SecurityRuleRequest;

  constructor(context: SecurityRuleContext, uid: string | null = null) {
    const requestObject = buildRequestObject(context, uid);
    super(buildErrorMessage(requestObject));
    this.name = 'FirestorePermissionError'; // Changed name to be more specific
    this.request = requestObject;
  }
}
