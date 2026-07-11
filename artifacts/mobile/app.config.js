const fs = require("fs");
const path = require("path");

// Extends app.json. Wires up Android FCM (push notifications) only when
// google-services.json is present, so builds keep working before Firebase
// is configured. Drop the file from the Firebase console into this folder
// (artifacts/mobile/google-services.json) and rebuild to enable push.
module.exports = ({ config }) => {
  const googleServicesPath = path.join(__dirname, "google-services.json");
  if (fs.existsSync(googleServicesPath)) {
    config.android = {
      ...config.android,
      googleServicesFile: "./google-services.json",
    };
  }
  return config;
};
