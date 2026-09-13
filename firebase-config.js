// Remplace ces valeurs par celles de TON projet Firebase
// (Console Firebase > Paramètres du projet > Tes applications > SDK config)
const firebaseConfig = {
    apiKey: "AIzaSyB2ahxezsY4m5iDEe0UMjqIXRljDmuwKgI",
    authDomain: "cancel-game.firebaseapp.com",
    databaseURL: "https://cancel-game-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "cancel-game",
    storageBucket: "cancel-game.firebasestorage.app",
    messagingSenderId: "990856354447",
    appId: "1:990856354447:web:e5f5bd0937f223ef296efa"
  };

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
