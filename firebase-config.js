// Firebase Realtime Database config for cross-device sync.
//
// HOW TO SET UP (free, ~2 minutes):
//   1. Go to https://console.firebase.google.com and create a project.
//   2. In the left menu: Build -> Realtime Database -> Create database.
//      Pick any region and start in "test mode" (you'll paste a stricter
//      rule below right after).
//   3. Copy the database URL from the top of the Realtime Database page.
//      It looks like: https://YOUR-PROJECT-default-rtdb.firebaseio.com
//   4. Paste it below, replacing the placeholder.
//   5. In the Realtime Database "Rules" tab, paste this rule and publish:
//
//        {
//          "rules": {
//            ".read": false,
//            ".write": false,
//            "walls": {
//              "$code": { ".read": true, ".write": true }
//            }
//          }
//        }
//
// The URL is the only value this app needs — no SDK and no API key.
// Security comes from your sync code: anyone who knows it can read/write
// your wall, so keep it private (like a password).
window.SYNC_CONFIG = {
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
};
