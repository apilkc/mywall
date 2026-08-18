// Firebase Realtime Database config for real-time sync.
//
// Every device that opens the site reads and writes this ONE wall, so
// your notes sync automatically and in real time — no login, no code,
// no QR. The wall id is below; the database URL is not secret.
//
// Recommended security rule (paste in the Realtime Database "Rules" tab):
//
//   {
//     "rules": {
//       ".read": false,
//       ".write": false,
//       "walls": {
//         "wall-8f3k2m9q": { ".read": true, ".write": true }
//       }
//     }
//   }
window.SYNC_CONFIG = {
  databaseURL: "https://mywall-f4bc6-default-rtdb.firebaseio.com",
  wallId: "wall-8f3k2m9q",
};
