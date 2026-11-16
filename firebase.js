import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";
import {
  getAuth
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBI3duzCWj5cxSz2QrYcrskZJ4qEjGHMYA",
  authDomain: "aditya-multi-services.firebaseapp.com",
  projectId: "aditya-multi-services",
  storageBucket: "aditya-multi-services.firebasestorage.app",
  messagingSenderId: "871059084940",
  appId: "1:871059084940:web:ed9852891293d51c6d4da9"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
