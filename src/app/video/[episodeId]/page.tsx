
'use client';

import { useParams } from 'next/navigation';

/**
 * This is a placeholder page to resolve a build error (TS2307).
 * The Next.js build process is trying to find this file because it is
 * referenced somewhere in the code, but it doesn't exist after a revert.
 * Creating this minimal file satisfies the build process.
 */
export default function MobileVideoPage() {
  const params = useParams<{ episodeId: string }>();

  return (
    <div style={{ padding: '2rem', color: 'black', backgroundColor: 'white', height: '100vh', fontFamily: 'sans-serif' }}>
      <h1>Video Player Page</h1>
      <p>This page is a placeholder to resolve a build issue.</p>
      {params.episodeId && <p>Episode ID: {params.episodeId}</p>}
    </div>
  );
}
