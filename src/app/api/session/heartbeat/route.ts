
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { heartbeatPlaySession } from '@/lib/actions/session-actions';

export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ success: false, message: 'Session ID is required' }, { status: 400 });
    }
    
    const result = await heartbeatPlaySession(sessionId);
    
    if (result.success) {
      return NextResponse.json({ success: true });
    } else {
      // This could happen if the session was already cleaned up, which is not a critical client error.
      return NextResponse.json({ success: false, message: 'Session not found or failed to update' }, { status: 404 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}

    