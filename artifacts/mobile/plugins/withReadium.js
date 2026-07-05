const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
} = require("expo/config-plugins");

const READIUM_SOURCE = "source 'https://github.com/readium/podspecs'";
const COCOAPODS_SOURCE = "source 'https://cdn.cocoapods.org/'";
const DESUGAR_DEP = 'coreLibraryDesugaring "com.android.tools:desugar_jdk_libs:2.1.2"';
const KOTLINX_DATETIME_DEP = 'implementation "org.jetbrains.kotlinx:kotlinx-datetime:0.6.1"';
const READIUM_VERSION = "3.1.0";
const NATIVE_READIUM_DEPS = [
  `implementation "org.readium.kotlin-toolkit:readium-shared:${READIUM_VERSION}"`,
  `implementation "org.readium.kotlin-toolkit:readium-streamer:${READIUM_VERSION}"`,
  `implementation "org.readium.kotlin-toolkit:readium-navigator:${READIUM_VERSION}"`,
  'implementation "org.jetbrains.kotlinx:kotlinx-datetime-jvm:0.6.1"',
  'implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1"',
  'implementation "androidx.fragment:fragment-ktx:1.8.5"',
  'implementation "androidx.lifecycle:lifecycle-runtime-ktx:2.8.7"',
  'implementation "androidx.appcompat:appcompat:1.7.0"',
];

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

function ensureAndroidAbiFilters(contents) {
  if (contents.includes("abiFilters")) return contents;
  return contents.replace(/defaultConfig\s*\{/, "defaultConfig {\n        ndk {\n            abiFilters \"arm64-v8a\"\n        }");
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

function ensureKotlinxDatetimeDependency(contents) {
  if (contents.includes("org.jetbrains.kotlinx:kotlinx-datetime")) return contents;
  const lines = contents.split("\n");
  const dependenciesIndex = lines.findIndex((line) => /^dependencies\s*\{/.test(line.trim()));
  if (dependenciesIndex >= 0) {
    lines.splice(dependenciesIndex + 1, 0, `    ${KOTLINX_DATETIME_DEP}`);
  } else {
    lines.push("", "dependencies {", `    ${KOTLINX_DATETIME_DEP}`, "}");
  }
  return lines.join("\n");
}

function ensureNativeReadiumDependencies(contents) {
  const missingDeps = NATIVE_READIUM_DEPS.filter((dep) => !contents.includes(dep));
  if (missingDeps.length === 0) return contents;

  const lines = contents.split("\n");
  const dependenciesIndex = lines.findIndex((line) => /^dependencies\s*\{/.test(line.trim()));
  const inserted = missingDeps.map((dep) => `    ${dep}`);

  if (dependenciesIndex >= 0) {
    lines.splice(dependenciesIndex + 1, 0, ...inserted);
  } else {
    lines.push("", "dependencies {", ...inserted, "}");
  }

  return lines.join("\n");
}

function withReadiumAndroid(config) {
  return withAppBuildGradle(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    contents = ensureAndroidAbiFilters(contents);
    contents = ensureCompileOptions(contents);
    contents = ensureDesugarDependency(contents);
    contents = ensureKotlinxDatetimeDependency(contents);
    contents = ensureNativeReadiumDependencies(contents);
    modConfig.modResults.contents = contents;
    return modConfig;
  });
}

function withNativeReadiumManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const packageName = modConfig.modResults.manifest.$.package
      || config.android?.package
      || "com.jasminmuze.commentaryreader";
    const activityName = `${packageName}.readiumhost.NativeReadiumActivity`;
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) return modConfig;

    application.activity = application.activity || [];
    const exists = application.activity.some((activity) => activity.$?.["android:name"] === activityName);
    if (!exists) {
      application.activity.push({
        $: {
          "android:name": activityName,
          "android:configChanges": "keyboard|keyboardHidden|orientation|screenSize|uiMode",
          "android:exported": "false",
          "android:screenOrientation": "portrait",
        },
      });
    }

    return modConfig;
  });
}

function ensureMainApplicationPackage(contents, packageName) {
  const importLine = `import ${packageName}.readiumhost.NativeReadiumPackage`;
  let next = contents;

  if (!next.includes(importLine)) {
    const packageMatch = next.match(/^package .+$/m);
    if (packageMatch) {
      const insertAt = packageMatch.index + packageMatch[0].length;
      next = `${next.slice(0, insertAt)}\n\n${importLine}${next.slice(insertAt)}`;
    }
  }

  if (next.includes("NativeReadiumPackage()")) return next;

  if (next.includes("PackageList(this).packages.apply {")) {
    return next.replace(
      /PackageList\(this\)\.packages\.apply\s*\{/,
      "PackageList(this).packages.apply {\n              add(NativeReadiumPackage())",
    );
  }

  return next.replace(
    /(\s*)return packages/,
    "$1packages.add(NativeReadiumPackage())\n$1return packages",
  );
}

function withNativeReadiumMainApplication(config) {
  return withMainApplication(config, (modConfig) => {
    const packageName = config.android?.package || "com.jasminmuze.commentaryreader";
    modConfig.modResults.contents = ensureMainApplicationPackage(
      modConfig.modResults.contents,
      packageName,
    );
    return modConfig;
  });
}

function withNativeReadiumSources(config) {
  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const packageName = config.android?.package || "com.jasminmuze.commentaryreader";
      const packagePath = packageName.split(".").join(path.sep);
      const sourceDir = path.join(
        modConfig.modRequest.projectRoot,
        "native",
        "readium-host",
        "android",
      );
      const targetDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        packagePath,
        "readiumhost",
      );

      fs.mkdirSync(targetDir, { recursive: true });

      for (const fileName of fs.readdirSync(sourceDir)) {
        if (!fileName.endsWith(".kt")) continue;
        const sourcePath = path.join(sourceDir, fileName);
        const targetPath = path.join(targetDir, fileName);
        const source = fs
          .readFileSync(sourcePath, "utf8")
          .replaceAll("{{PACKAGE_NAME}}", packageName);
        fs.writeFileSync(targetPath, source);
      }

      return modConfig;
    },
  ]);
}

module.exports = function withReadium(config) {
  config = withReadiumIos(config);
  config = withReadiumAndroid(config);
  config = withNativeReadiumManifest(config);
  config = withNativeReadiumMainApplication(config);
  config = withNativeReadiumSources(config);
  return config;
};
