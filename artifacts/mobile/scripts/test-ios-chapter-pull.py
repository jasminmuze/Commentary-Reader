#!/usr/bin/env python3
"""Run the production Swift pull methods with small UIKit/Readium test doubles.

Requires Swift 5.8+ (SWIFT=/path/to/swift is supported). This tests gesture
decisions and async navigation, not UIKit gesture recognition on an iPhone.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = root / "native/readium-host/ios/NativeReadiumView.swift"
swift = os.environ.get("SWIFT") or shutil.which("swift")
if not swift:
    raise SystemExit("Swift 5.8+ is required; set SWIFT to its executable.")

text = source.read_text()
state = text[text.index("    private var scrollModeEnabled"):text.index("    // MARK: - Lifecycle")]
methods = text[text.index("    @objc private func observeChapterPullPan"):text.index("    private func sendChapterPull(")]
methods = methods.replace("@objc ", "").replace("private ", "")
state = state.replace("private ", "")
fixture = (Path(__file__).with_name("ios-chapter-pull-fixture.swift")).read_text()
program = fixture.replace("// PRODUCTION_STATE", state).replace("// PRODUCTION_METHODS", methods)


def run_check(label, command):
    print(f"==> {label}", flush=True)
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as error:
        raise SystemExit(
            f"ERROR: {label} failed with exit code {error.returncode}."
        ) from error


with tempfile.TemporaryDirectory(prefix="ios-chapter-pull-") as directory:
    test = Path(directory) / "main.swift"
    test.write_text(program)
    run_check("Chapter-pull production logic tests", [swift, str(test)])
# Syntax-check the complete iOS file as well. Linux cannot typecheck UIKit.
run_check("Complete iOS host Swift syntax check", [swift, "-frontend", "-parse", str(source)])
