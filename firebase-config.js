// Firebase Realtime Database config for cross-device sync.
//
// The database URL is not secret. Security comes from (a) your private
// sync code and (b) the security rules — paste these in the Realtime
// Database "Rules" tab in the Firebase console, then Publish:
//
//   {
//     "rules": {
//       ".read": false,
//       ".write": false,
//       "walls": {
//         "$code": { ".read": true, ".write": true }
//       }
//     }
//   }
window.SYNC_CONFIG = {
  databaseURL: "https://mywall-f4bc6-default-rtdb.firebaseio.com",
};
