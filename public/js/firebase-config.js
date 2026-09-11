// Replace these values with your own Firebase project's web app config.
// Firebase Console -> Project Settings -> General -> Your apps -> Web app
// -> SDK setup and configuration -> Config
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

export const isConfigured = !Object.values(firebaseConfig).some((value) =>
  String(value).startsWith("YOUR_")
);
