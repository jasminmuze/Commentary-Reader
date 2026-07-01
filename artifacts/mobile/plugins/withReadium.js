const fs = require("fs");
const path = require("path");
const { withAppBuildGradle, withDangerousMod } = require("@expo/config-plugins");

const READIUM_SOURCE = "source 'https://github.com/readium/podspecs'";
const COCOAPODS_SOURCE = "source 'https://cdn.cocoapods.org/'";
const DESUGAR_DEP = 'coreLibraryDesugaring "com.android.tools:desugar_jdk_libs:2.1.2"';

function ensurePodSources(contents) {
  if (contents.includes(READIUM_SOURCE)) return contents;
  if (contents.includes(COCOAPODS_SOURCE)) {
    return contents.replace(COCOAPODS_SOURCE, `${READIUM_SOURCE}\n${COCOAPODS_SOURCE}`);
  }
  return `${READIUM_SOURCE}\n${COCOAPODS_SOURCE}\n\n${contents}`;
}

function ensureReadiumPods(contents) {
  if (contents.includes("readium_pods")) return contents;
  const postInstallIndex = contents.indexOf("post_install do |installer|");
  if (postInstallIndex >= 0) {
    return `${contents.slice(0, postInstallIndex)}  readium_pods\n\n${contents.slice(postInstallIndex)}`;
  }

  const targetIndex = contents.indexOf("target ");
  if (targetIndex < 0) return contents;
  const insertionIndex = contents.indexOf("\n", targetIndex);
  if (insertionIndex < 0) return contents;
  return `${contents.slice(0, insertionIndex + 1)}  readium_pods\n${contents.slice(insertionIndex + 1)}`;
}

function parenDelta(line) {
  let delta = 0;
  for (const char of line) {
    if (char === "(") delta += 1;
    if (char === ")") delta -= 1;
  }
  return delta;
}

function ensureReadiumPostInstall(contents) {
  if (contents.includes("readium_post_install(installer)")) return contents;

  const lines = contents.split("\n");
  const start = lines.findIndex((line) => line.includes("react_native_post_install("));
  if (start < 0) return contents;

  let balance = 0;
  for (let index = start; index < lines.length; index += 1) {
    balance += parenDelta(lines[index]);
    if (balance <= 0) {
      lines.splice(index + 1, 0, "    readium_post_install(installer)");
      return lines.join("\n");
    }
  }
  return contents;
}

function ensureCompileOptions(contents) {
  if (contents.includes("coreLibraryDesugaringEnabled true")) return contents;
  const lines = contents.split("\n");
  const compileOptionsIndex = lines.findIndex((line) => line.includes("compileOptions"));

  if (compileOptionsIndex >= 0) {
    lines.splice(compileOptionsIndex + 1, 0, "        coreLibraryDesugaringEnabled true");
    return lines.join("\n");
  }

  const androidIndex = lines.findIndex((line) => /^android\s*\{/.test(line.trim()));
  if (androidIndex >= 0) {
    lines.splice(
      androidIndex + 1,
      0,
      "    compileOptions {",
      "        coreLibraryDesugaringEnabled true",
      "    }",
    );
  }
  return lines.join("\n");
}

function ensureDesugarDependency(contents) {
  if (contents.includes("com.android.tools:desugar_jdk_libs")) return contents;
  const lines = contents.split("\n");
  const dependenciesIndex = lines.findIndex((line) => /^dependencies\s*\{/.test(line.trim()));
  if (dependenciesIndex >= 0) {
    lines.splice(dependenciesIndex + 1, 0, `    ${DESUGAR_DEP}`);
  } else {
    lines.push("", "dependencies {", `    ${DESUGAR_DEP}`, "}");
  }
  return lines.join("\n");
}

function withReadiumIos(config) {
  return withDangerousMod(config, [
    "ios",
    async (modConfig) => {
      const podfilePath = path.join(modConfig.modRequest.platformProjectRoot, "Podfile");
      if (!fs.existsSync(podfilePath)) return modConfig;

      let contents = fs.readFileSync(podfilePath, "utf8");
      contents = ensurePodSources(contents);
      contents = ensureReadiumPods(contents);
      contents = ensureReadiumPostInstall(contents);
      fs.writeFileSync(podfilePath, contents);
      return modConfig;
    },
  ]);
}

function withReadiumAndroid(config) {
  return withAppBuildGradle(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    contents = ensureCompileOptions(contents);
    contents = ensureDesugarDependency(contents);
    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

module.exports = function withReadium(config) {
  config = withReadiumIos(config);
  config = withReadiumAndroid(config);
  return config;
};
