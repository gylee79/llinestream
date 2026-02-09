
{
  "workflow": "LlineStream Video Processing & Playback",
  "version": "2024-07-29",
  "parts": [
    {
      "name": "Part 1: Video Upload & Backend Processing",
      "actor": "Admin",
      "steps": [
        {
          "step": 1,
          "description": "Admin selects video and enters metadata in the UI.",
          "file": "src/components/admin/content/video-upload-dialog.tsx",
          "technicalDetails": {
            "action": "Calls 'saveEpisodeMetadata' Server Action upon form submission."
          }
        },
        {
          "step": 2,
          "description": "Files are uploaded and metadata is saved to Firestore.",
          "file": "src/lib/actions/upload-episode.ts",
          "technicalDetails": {
            "storageUpload": "Client-side upload to Firebase Storage using 'uploadFile' helper from 'src/firebase/storage/upload.ts'.",
            "firestoreWrite": "Creates a new document in the 'episodes' collection with 'aiProcessingStatus' set to 'pending'."
          }
        },
        {
          "step": 3,
          "description": "Cloud Function is triggered by the new Firestore document.",
          "file": "functions/src/index.ts",
          "technicalDetails": {
            "trigger": "Firestore onDocumentWritten trigger for 'episodes/{episodeId}'.",
            "initialUpdate": "Immediately updates 'aiProcessingStatus' to 'processing' to prevent re-triggering."
          }
        },
        {
          "step": 4,
          "description": "AI analysis and HLS encryption run in parallel.",
          "file": "functions/src/index.ts",
          "technicalDetails": {
            "aiAnalysis": {
              "library": "@google/generative-ai",
              "model": "gemini-3-flash-preview",
              "function": "runAiAnalysis",
              "output": "JSON object with transcript, summary, timeline, and keywords. A VTT file is also generated and uploaded to Storage."
            },
            "hlsPackaging": {
              "library": "@google-cloud/video-transcoder",
              "function": "createHlsPackagingJob",
              "encryption": "AES-128",
              "keyStorage": "Private path in Cloud Storage (e.g., 'episodes/{id}/keys/enc.key').",
              "manifestKeyURI": "Writes a secure API endpoint URL ('/api/key-delivery?episodeId=...') into the .m3u8 manifest."
            }
          }
        },
        {
          "step": 5,
          "description": "Results from both processes are saved to the episode document.",
          "file": "functions/src/index.ts",
          "technicalDetails": {
            "updatedFields": ["aiGeneratedContent", "vttPath", "manifestPath", "keyPath", "packagingStatus", "aiProcessingStatus"]
          }
        }
      ]
    },
    {
      "name": "Part 2: Encrypted Video Playback",
      "actor": "User",
      "steps": [
        {
          "step": 6,
          "description": "User clicks play, initializing Shaka Player.",
          "file": "src/components/shared/video-player-dialog.tsx",
          "technicalDetails": {
            "player": "Shaka Player",
            "manifestFetch": "Constructs a public URL for the manifest file from 'manifestPath' and loads it."
          }
        },
        {
          "step": 7,
          "description": "Player requests the encryption key via the API endpoint specified in the manifest.",
          "file": "src/components/shared/video-player-dialog.tsx",
          "technicalDetails": {
            "networkRequestInterceptor": "Adds the current user's Firebase Auth ID Token to the 'Authorization' header of the key request."
          }
        },
        {
          "step": 8,
          "description": "The secure API validates the request and serves the key.",
          "file": "src/app/api/key-delivery/route.ts",
          "technicalDetails": {
            "authentication": "Verifies the received ID Token using Firebase Admin SDK.",
            "authorization": "Checks the user's subscription status in Firestore.",
            "keyRetrieval": "If authorized, reads the key file from the private Cloud Storage path ('keyPath') and returns its binary content."
          }
        },
        {
          "step": 9,
          "description": "Player decrypts and plays the video.",
          "file": "src/components/shared/video-player-dialog.tsx",
          "technicalDetails": {
            "decryption": "Shaka Player uses the received key to decrypt HLS segments in real-time."
          }
        }
      ]
    }
  ]
}
