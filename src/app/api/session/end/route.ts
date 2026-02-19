
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { endPlaySession } from '@/lib/actions/session-actions';

export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ success: false, message: 'Session ID is required' }, { status: 400 });
    }
    
    await endPlaySession(sessionId);
    
    // We send a success response even if the session was already gone.
    return NextResponse.json({ success: true });

  } catch (error) {
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}

    