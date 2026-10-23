// Minimal platform doubles; the script inserts actual production methods.
typealias CGFloat = Double
typealias TimeInterval = Double
struct CGPoint {
    var x: Double = 0
    var y: Double = 0
    static let zero = CGPoint()
}
struct CGSize { var width: Double = 400; var height: Double = 600 }
struct CGRect { var height: Double = 600 }
struct Insets { var top: Double = 0; var bottom: Double = 0 }
struct Date { var timeIntervalSince1970: Double { 100 } }
class UIScrollView {
    var contentOffset = CGPoint()
    var contentSize = CGSize()
    var bounds = CGRect()
    var adjustedContentInset = Insets()
    var visible = true
}
class UIPanGestureRecognizer {
    enum State { case began, changed, ended, cancelled, failed, possible }
    var state = State.possible
    var view: AnyObject?
    var numberOfTouches = 1
    var position = CGPoint()
    func translation(in view: UIScrollView) -> CGPoint { position }
}
struct Href { var string: String }
struct Locations { var progression: Double = 0 }
struct Locator {
    var href = Href(string: "one#anchor")
    var locations = Locations()
    func copy(locations transform: (inout Locations) -> Void) -> Locator {
        var result = self
        transform(&result.locations)
        return result
    }
}
struct Link { var href: String; var title: String? }
class Publication {
    let readingOrder = [
        Link(href: "zero#anchor", title: "Zero"),
        Link(href: "one", title: nil),
        Link(href: "two", title: "Two"),
    ]
    var locateSuspended = false
    var locateFails = false
    var locatedHref: String?
    func locate(_ link: Link) async -> Locator? {
        while locateSuspended { await Task.yield() }
        locatedHref = link.href
        return locateFails ? nil : Locator(href: Href(string: link.href))
    }
}
struct NavigatorGoOptions { var animated: Bool }
class Navigator {
    var currentSelection: Int?
    var currentLocation: Locator? = Locator()
    var moves: [Locator] = []
    var goSucceeds = true
    func go(to locator: Locator, options: NavigatorGoOptions) async -> Bool {
        if goSucceeds { moves.append(locator); currentLocation = locator }
        return goSucceeds
    }
}
class Host {
    var publication: Publication? = Publication()
    var navigator: Navigator? = Navigator()
    var disposed = false
    var events: [(phase: String, direction: Int, progress: Double)] = []
    // PRODUCTION_STATE
    // PRODUCTION_METHODS
    func sendChapterPull(_ phase: String, direction: Int, progress: Double, title: String?) {
        events.append((phase, direction, progress))
    }
    func isVisibleChapterScrollView(_ view: UIScrollView) -> Bool { view.visible }
    static func hrefWithoutFragment(_ href: String) -> String {
        String(href.split(separator: "#", maxSplits: 1).first ?? "")
    }
}

func check(_ condition: @autoclosure () -> Bool, _ label: String) {
    precondition(condition(), label)
    print("PASS: \(label)")
}
func setup(offset: Double = 400, height: Double = 1000) -> (Host, UIScrollView, UIPanGestureRecognizer) {
    let host = Host()
    host.scrollModeEnabled = true
    let scroll = UIScrollView()
    scroll.contentOffset.y = offset
    scroll.contentSize.height = height
    let pan = UIPanGestureRecognizer()
    pan.view = scroll
    pan.state = .began
    host.observeChapterPullPan(pan)
    return (host, scroll, pan)
}
func move(_ host: Host, _ pan: UIPanGestureRecognizer, _ y: Double, x: Double = 0,
          state: UIPanGestureRecognizer.State = .changed) {
    pan.position = CGPoint(x: x, y: y)
    pan.state = state
    host.observeChapterPullPan(pan)
}
func settled(_ host: Host) async {
    for _ in 0..<1000 {
        if !host.pullNavigationPending { return }
        await Task.yield()
    }
    preconditionFailure("navigation did not settle")
}

// Run on one task, so the platform doubles don't race with navigation tasks.
let tests = Task {
    do {
        let (h, _, p) = setup()
        move(h, p, -79, state: .ended)
        check(h.events.last?.phase == "cancel" && h.navigator!.moves.isEmpty,
              "release below 80 points cancels")
    }
    do {
        let (h, _, p) = setup()
        move(h, p, -80)
        check(h.events.last?.progress == 1, "80-point pull arms the shared indicator")
        move(h, p, -80, state: .ended)
        await settled(h)
        check(h.navigator!.moves.count == 1 && h.navigator!.moves[0].href.string == "two",
              "release at threshold opens the next reading-order resource")
        check(h.events.last?.phase == "commit", "successful navigation emits commit")
    }
    do {
        let (h, _, p) = setup(offset: 0)
        move(h, p, 90, state: .ended)
        await settled(h)
        check(h.navigator!.moves.first?.locations.progression == 1,
              "backward pull lands at the previous chapter end")
        check(h.publication!.locatedHref == "zero", "previous chapter fragment is removed")
    }
    do {
        let (h, s, p) = setup(offset: 300)
        s.contentOffset.y = 400
        move(h, p, -150, state: .ended)
        check(h.navigator!.moves.isEmpty && h.events.last?.phase == "cancel",
              "ordinary scrolling before the edge does not count toward the threshold")
    }
    do {
        let (h, _, p) = setup()
        move(h, p, -100, x: 200, state: .ended)
        check(h.events.isEmpty, "horizontal-dominant movement does not trigger a chapter pull")
    }
    do {
        let (h, _, p) = setup()
        move(h, p, -90)
        move(h, p, 0, state: .ended)
        check(h.events.last?.phase == "cancel" && h.navigator!.moves.isEmpty,
              "reversing an armed pull cancels")
    }
    for state in [UIPanGestureRecognizer.State.cancelled, .failed] {
        let (h, _, p) = setup()
        move(h, p, -100)
        move(h, p, -100, state: state)
        check(h.events.last?.phase == "cancel" && !h.pullGestureActive,
              "interrupted recognizer cancels without navigation")
    }
    do {
        let (h, _, p) = setup()
        move(h, p, -100)
        h.navigator!.currentSelection = 1
        move(h, p, -100, state: .ended)
        check(h.events.last?.phase == "cancel" && h.navigator!.moves.isEmpty,
              "selection appearing on release prevents navigation")
    }
    do {
        let (h, _, p) = setup()
        p.numberOfTouches = 2
        move(h, p, -120)
        check(!h.pullGestureActive && h.events.isEmpty, "multi-touch abandons the gesture")
    }
    do {
        let (h, _, p) = setup()
        h.scrollModeEnabled = false
        move(h, p, -120, state: .ended)
        check(h.events.isEmpty && h.navigator!.moves.isEmpty, "paged mode is unaffected")
    }
    for href in ["zero", "two"] {
        let (h, s, p) = setup(offset: href == "zero" ? 0 : 400)
        h.navigator!.currentLocation = Locator(href: Href(string: href))
        s.contentOffset.y = href == "zero" ? 0 : 400
        move(h, p, href == "zero" ? 100 : -100, state: .ended)
        check(h.events.isEmpty, "book boundary \(href) does not wrap around")
    }
    do {
        let (h, _, p) = setup(offset: 0, height: 200)
        move(h, p, -100, state: .ended)
        await settled(h)
        check(h.navigator!.moves.first?.href.string == "two",
              "short chapter can pull forward when its scroll pan is delivered")
    }
    do {
        let (h, _, p) = setup()
        let other = UIPanGestureRecognizer()
        other.view = UIScrollView()
        other.state = .began
        move(h, p, -100)
        h.observeChapterPullPan(other)
        check(h.pullInProgress, "preloaded WebView does not cancel the active gesture")
        move(h, p, -100, state: .ended)
        await settled(h)
    }
    do {
        let (h, _, p) = setup()
        h.publication!.locateSuspended = true
        move(h, p, -100, state: .ended)
        p.state = .began
        h.observeChapterPullPan(p)
        check(!h.pullGestureActive, "pending chapter navigation blocks duplicate pulls")
        h.pullNavigationGeneration += 1
        h.publication!.locateSuspended = false
        await settled(h)
        check(h.navigator!.moves.isEmpty && h.events.last?.phase == "cancel",
              "settings change invalidates a pending destination")
    }
    for failsLocate in [true, false] {
        let (h, _, p) = setup()
        h.publication!.locateFails = failsLocate
        h.navigator!.goSucceeds = false
        move(h, p, -100, state: .ended)
        await settled(h)
        check(h.events.last?.phase == "cancel" && !h.pullNavigationPending,
              "failed locator/navigation clears indicator and pending lock")
    }
    do {
        let (h, _, p) = setup()
        move(h, p, -100, state: .ended)
        await settled(h)
        p.state = .began
        h.observeChapterPullPan(p)
        check(!h.pullGestureActive, "post-jump cooldown prevents accidental repeat")
    }
    print("All iOS chapter-pull logic checks passed.")
}
// Yield from the top level until the asynchronous suite completes.
await tests.value
