# **App Name**: LlineStream

## Core Features:

- User Authentication: Secure user login and registration with Firebase Auth, supporting both standard credentials and social logins.
- Content Streaming: Stream video content with adaptive bitrate streaming for optimal playback on various devices.
- Subscription Management: Allow users to subscribe to monthly plans for specific content categories ('큰분류') and manage their active subscriptions via Firestore.
- Content Discovery: Enable users to browse content by categories ('분야', '큰분류', '상세분류') and view related episodes in a structured manner. Content is populated dynamically from Firestore.
- Admin Content Management: Admin interface for managing content hierarchy, setting subscription prices, and uploading/managing video episodes. Category creation includes auto thumbnail generation using AI.
- Personalized Recommendations: AI-powered video recommendations based on viewing history and user preferences, powered using a tool to identify trending content. Recommendations adjust to prioritize or suppress individual contents based on performance and user behavior.
- Payment Integration: Integrate a secure payment gateway (e.g., Stripe) to handle subscription payments and individual content purchases.

## Style Guidelines:

- Primary color: Deep Blue (#1A237E) to convey a sense of premium quality and trust. This darker shade works well for a streaming service, promoting focus on the video content.
- Background color: Very light gray (#F5F5F5) to provide a clean and modern look, ensuring that the blue primary color stands out.
- Accent color: Vivid Yellow (#FFEB3B) is used for calls to action, highlights, and important information.  Its position 30 degrees to the 'right' (clockwise) side of green-blue produces striking contrast without clashing.
- Font pairing: 'Poppins' (sans-serif) for headlines to provide a modern and geometric feel, paired with 'PT Sans' (sans-serif) for body text to ensure readability.
- Use consistent and clear icons throughout the app. Use the font-awesome icon library.
- Implement a responsive layout that adapts to different screen sizes, ensuring a consistent experience across devices.
- Use subtle animations for UI elements like button hovers and transitions between pages.