# iOS chapter-pull verification

The iOS host observes each EPUB WebView's existing scroll pan; it does not
install a competing recognizer or change Readium's gesture/scroll delegates.
Scroll mode enables vertical bounce so even a chapter shorter than the viewport
can deliver a pan. Original bounce settings are restored in paged mode and when
an observed view is removed.

## Automated logic checks

The logic and syntax checks can run on macOS or Linux with Swift 5.8 or newer
and Python 3:

```sh
python3 artifacts/mobile/scripts/test-ios-chapter-pull.py
# Or: SWIFT=/path/to/swift python3 artifacts/mobile/scripts/test-ios-chapter-pull.py
```

The runner extracts the production Swift gesture and navigation methods into
lightweight platform doubles. It checks the threshold, ordinary scrolling,
reversal/cancellation, direction, book boundaries, short resources, selection,
multi-touch, paged mode, preloaded views, pending navigation, preference changes,
failed navigation, and cooldown. It also parses the complete host Swift file.
It does **not** compile UIKit/Readium or prove UIKit will deliver the gesture.

## Combined macOS compile check

Run the complete check on macOS with Xcode, CocoaPods, Node.js, and pnpm:

```sh
pnpm --filter @workspace/mobile run test:ios-readium
```

This runs the logic and syntax checks first, then regenerates the Expo iOS
project, installs CocoaPods (including Readium Swift 3.1.x), and compiles the
iOS Simulator target with code signing disabled. It type-checks the UIKit and
Readium integration but does not create a signed app or verify device gestures.
The same command runs in `.github/workflows/ios-readium-build.yml` on relevant
pull requests and pushes. On Linux, use the Python command above for the
logic-only check; the combined command exits with an explicit message because
UIKit/Readium compilation requires macOS and Xcode.

## Required iPhone build check

Native changes require a new iOS build; Metro reloads cannot apply them.
Use an EPUB with at least three resources, including one shorter than a screen.

1. In vertical mode, scroll to a chapter's bottom and keep dragging upward.
   Only movement beyond the edge should fill the existing chapter indicator.
   Release below 80 points: stay. Release at/above 80: open the next resource.
2. At a chapter's top, pull down and release: open the **end** of the previous
   resource. Repeat both directions on the short resource.
3. Reverse the drag, cancel it, start a pinch, or select text: no chapter jump.
   Text selection handles, copy, highlight/comment actions, and highlight taps
   must still work.
4. Try both book boundaries: no wraparound or stuck indicator. Pull again
   immediately after a transition: no duplicate jump.
5. Change font/margins and vertical → paged → vertical. Repeat the pull checks
   after the WebViews rebuild. Paged swiping must still turn pages normally.
6. Repeat with VoiceOver disabled and on supported iOS versions/device sizes.
   Verify TOC navigation and ordinary scrolling are unchanged.

`disablePageTurnsWhileScrolling` intentionally remains **false** until this
device checklist passes. This keeps horizontal chapter navigation available if
UIKit fails to recognize an edge pull. Only after the checklist passes should
it become `true`; then repeat the vertical navigation and paged-swipe checks
with horizontal scroll-mode transitions disabled.
