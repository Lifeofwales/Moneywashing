/* ==========================================================
   FIREBASE CONFIGURATION

   1. Create a Firebase project.
   2. Add a Web App.
   3. Copy the firebaseConfig values Firebase gives you.
   4. Replace the placeholder values below.
   ========================================================== */

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAJpheaXuEkmFFLrqqaJ795ainp3BJ0yl4",
  authDomain: "moneywashing.firebaseapp.com",
  projectId: "moneywashing",
  storageBucket: "moneywashing.firebasestorage.app",
  messagingSenderId: "1092797198587",
  appId: "1:1092797198587:web:0966d02abc34f745d7805e",
  measurementId: "G-STSN1WLFS8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
