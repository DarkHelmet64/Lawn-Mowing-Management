// Replace these values with your own Firebase project's web app config.
// Firebase Console -> Project Settings -> General -> Your apps -> Web app
// -> SDK setup and configuration -> Config
export const firebaseConfig = {
  apiKey: "AIzaSyCbxEGqMTjaxvexlPN_6WKUJI7HmL8g3c0",
  authDomain: "lawn-mowing-management.firebaseapp.com",
  projectId: "lawn-mowing-management",
  storageBucket: "lawn-mowing-management.firebasestorage.app",
  messagingSenderId: "722529945186",
  appId: "1:722529945186:web:d929d9966ea1835ad1f33b",
};

export const isConfigured = !Object.values(firebaseConfig).some((value) =>
  String(value).startsWith("YOUR_")
);
