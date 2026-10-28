const fs = require("fs");
const path = require("path");

module.exports = function withOptionalGoogleServices(config) {
  const googleServicesPath = path.join(__dirname, "..", "google-services.json");
  if (!fs.existsSync(googleServicesPath)) {
    return config;
  }

  return {
    ...config,
    android: {
      ...config.android,
      googleServicesFile: "./google-services.json",
    },
  };
};
