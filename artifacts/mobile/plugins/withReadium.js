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
// Readium 3.x is compiled against kotlinx-datetime 0.6.x, whose Instant/Clock classes were
// REMOVED in 0.7.0. If any other dependency pulls 0.7+, Gradle picks the highest version and
// Readium crashes at runtime with NoClassDefFoundError: kotlinx.datetime.Instant. The
// "-0.6.x-compat" artifacts ship BOTH the new API and the deprecated 0.6.x classes, so we pin
// them via resolutionStrategy.force below.
const KOTLINX_DATETIME_VERSION = "0.7.1-0.6.x-compat";
const KOTLINX_DATETIME_DEP = `implementation "org.jetbrains.kotlinx:kotlinx-datetime:${KOTLINX_DATETIME_VERSION}"`;
const KOTLINX_DATETIME_FORCE_MARKER = "// readium: pin kotlinx-datetime for binary compat";
const READIUM_VERSION = "3.1.0";
const NATIVE_READIUM_DEPS = [
  `implementation "org.readium.kotlin-toolkit:readium-shared:${READIUM_VERSION}"`,
  `implementation "org.readium.kotlin-toolkit:readium-streamer:${READIUM_VERSION}"`,
  `implementation "org.readium.kotlin-toolkit:readium-navigator:${READIUM_VERSION}"`,
  `implementation "org.jetbrains.kotlinx:kotlinx-datetime-jvm:${KOTLINX_DATETIME_VERSION}"`,
  'implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1"',
  'implementation "androidx.fragment:fragment-ktx:1.8.5"',
  'implementation "androidx.lifecycle:lifecycle-runtime-ktx:2.8.7"',
  'implementation "androidx.appcompat:appcompat:1.7.0"',
];

const READIUM_IOS_VERSION = "3.1.0";
const READIUM_PODS_MARKER = "# readium: pods + post_install helpers";
// Defines the `readium_pods` / `readium_post_install` helpers referenced from
// inside the target block. Expo links pods as static libraries, so every pod
// with Objective-C headers (GCDWebServer fork, Minizip) and the Swift pods
// imported from Swift code need modular headers.
const READIUM_PODS_DEFS = `${READIUM_PODS_MARKER}
def readium_pods
  pod 'ReadiumShared', '~> ${READIUM_IOS_VERSION}', :modular_headers => true
  pod 'ReadiumStreamer', '~> ${READIUM_IOS_VERSION}', :modular_headers => true
  pod 'ReadiumNavigator', '~> ${READIUM_IOS_VERSION}', :modular_headers => true
  pod 'ReadiumInternal', '~> ${READIUM_IOS_VERSION}', :modular_headers => true
  pod 'ReadiumAdapterGCDWebServer', '~> ${READIUM_IOS_VERSION}', :modular_headers => true
  pod 'ReadiumGCDWebServer', :modular_headers => true
  pod 'ReadiumFuzi', :modular_headers => true
  pod 'ReadiumZIPFoundation', :modular_headers => true
  pod 'Minizip', :modular_headers => true
  pod 'SwiftSoup', :modular_headers => true
  pod 'DifferenceKit', :modular_headers => true
  pod 'NativeReadiumHost', :path => File.join(__dir__, '..', 'native', 'readium-host', 'ios')
end

def readium_post_install(installer)
  installer.pods_project.targets.each do |target|
    next unless target.name.start_with?('Readium') ||
                ['NativeReadiumHost', 'Minizip', 'SwiftSoup', 'DifferenceKit'].include?(target.name)
    target.build_configurations.each do |config|
      # Readium pods declare older deployment targets; align them with the app
      # so Xcode 15+ doesn't fail the build.
      if config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < 15.1
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
      end
    end
  end
end
`;

function ensureReadiumPodDefs(contents) {
  if (contents.includes(READIUM_PODS_MARKER)) return contents;
  return `${READIUM_PODS_DEFS}\n${contents}`;
}

function ensurePodSources(contents) {
  if (contents.includes(READIUM_SOURCE)) return contents;
  if (contents.includes(COCOAPODS_SOURCE)) {
    return contents.replace(COCOAPODS_SOURCE, `${READIUM_SOURCE}\n${COCOAPODS_SOURCE}`);
  }
  return `${READIUM_SOURCE}\n${COCOAPODS_SOURCE}\n\n${contents}`;
}

function ensureReadiumPods(contents) {
  // Match only a bare `readium_pods` call line, not the `def readium_pods` helper.
  if (/^\s*readium_pods\s*$/m.test(contents)) return contents;
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
  // Match only a bare call line, not the `def readium_post_install(installer)` helper.
  if (/^\s*readium_post_install\(installer\)\s*$/m.test(contents)) return contents;

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
      contents = ensureReadiumPodDefs(contents);
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

function ensureKotlinxDatetimeResolution(contents) {
  if (contents.includes(KOTLINX_DATETIME_FORCE_MARKER)) return contents;
  return [
    contents,
    "",
    KOTLINX_DATETIME_FORCE_MARKER,
    "configurations.all {",
    "    resolutionStrategy {",
    `        force "org.jetbrains.kotlinx:kotlinx-datetime:${KOTLINX_DATETIME_VERSION}"`,
    `        force "org.jetbrains.kotlinx:kotlinx-datetime-jvm:${KOTLINX_DATETIME_VERSION}"`,
    "    }",
    "}",
    "",
  ].join("\n");
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
    contents = ensureKotlinxDatetimeResolution(contents);
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
