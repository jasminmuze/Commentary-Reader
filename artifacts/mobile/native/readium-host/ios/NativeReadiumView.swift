//
//  NativeReadiumView.swift
//  A React Native view that embeds the Readium EPUB navigator inline, so all
//  reader chrome (toolbar, settings, TOC, comment sheet) can be rendered by
//  React Native as overlays.
//
//  iOS counterpart of the Android `NativeReadiumView` — same props, same
//  commands, same event names/payloads, so the JS bridge contract in
//  `app/readium/[libraryId].tsx` works unchanged on both platforms.
//
//  Follows the official readium/swift-toolkit TestApp reader implementation
//  (EPUBViewController + VisualReaderViewController) for:
//  - Publication opening through `AssetRetriever` + `PublicationOpener`.
//  - `EPUBNavigatorViewController` served by the shared `GCDHTTPServer`.
//  - `DirectionalNavigationAdapter` edge taps + center tap events.
//  - Community highlights as decoration groups with
//    `observeDecorationInteractions` for tap activation.
//  - Text selection via custom `EditingAction`s resolved on the responder
//    chain (this view implements the selectors).
//  - Cross-edition quote matching through the publication's `SearchService`.
//

import Foundation
import ReadiumAdapterGCDWebServer
import ReadiumNavigator
import ReadiumShared
import ReadiumStreamer
import React
import UIKit
import WebKit

/// Shared Readium context (official TestApp `Readium.swift` pattern).
private final class ReadiumContext {
    static let shared = ReadiumContext()

    let httpClient: HTTPClient
    let assetRetriever: AssetRetriever
    let publicationOpener: PublicationOpener
    let httpServer: HTTPServer

    private init() {
        let httpClient = DefaultHTTPClient()
        let assetRetriever = AssetRetriever(httpClient: httpClient)
        self.httpClient = httpClient
        self.assetRetriever = assetRetriever
        publicationOpener = PublicationOpener(
            parser: DefaultPublicationParser(
                httpClient: httpClient,
                assetRetriever: assetRetriever,
                pdfFactory: DefaultPDFDocumentFactory()
            )
        )
        httpServer = GCDHTTPServer(assetRetriever: assetRetriever)
    }
}

class NativeReadiumView: UIView {
    // MARK: - React props

    @objc var libraryId: NSNumber = -1
    @objc var filePath: NSString?
    @objc var locatorJson: NSString?
    @objc var settingsJson: NSString?

    private var libId: Int { libraryId.intValue }

    // MARK: - State

    private var opening = false
    private var disposed = false
    private var parentWaitAttempts = 0
    private var publication: Publication?
    private var navigator: EPUBNavigatorViewController?
    private var listenedGroups = Set<String>()
    private var scrollModeEnabled = false
    private var observedScrollViews: [ObjectIdentifier: UIScrollView] = [:]
    private var originalBounceSettings: [ObjectIdentifier: (bounces: Bool, vertical: Bool)] = [:]
    private var observerRefreshGeneration = 0
    private weak var pullScrollView: UIScrollView?
    private var pullNavigationPending = false
    private var pullNavigationGeneration = 0
    private var pullGestureActive = false
    private var pullInProgress = false
    private var pullCandidateActive = false
    private var pullDirection = 0 // +1 next chapter, -1 previous chapter
    private var pullTargetIndex = -1
    private var pullTargetTitle: String?
    private var pullLastSentProgress = -1.0
    private var pullLastTranslation = CGPoint.zero
    private var pullLastContentOffsetY: CGFloat = 0
    private var pullCandidateAnchor = CGPoint.zero
    private var pullTravel = CGPoint.zero
    private var lastChapterJumpAt: TimeInterval = 0
    private var chapterTitleByHref: [String: String] = [:]

    private static let maxParentWaitAttempts = 20
    private static let parentWaitInterval: TimeInterval = 0.25
    private static let readiumLocationVersion = 4
    private static let chapterPullThreshold: CGFloat = 80
    private static let chapterJumpCooldown: TimeInterval = 0.7

    // MARK: - Lifecycle

    /// Called by React Native after a batch of prop updates was applied.
    /// (`didSetProps:` comes from RN's `UIView (React)` category, so this
    /// must be declared as an override.)
    @objc override func didSetProps(_ changedProps: [String]!) {
        maybeOpen()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil {
            parentWaitAttempts = 0
            maybeOpen()
        }
    }

    override func willMove(toSuperview newSuperview: UIView?) {
        super.willMove(toSuperview: newSuperview)
        if newSuperview == nil {
            dispose()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        navigator?.view.frame = bounds
        refreshChapterPullObservers()
    }

    // MARK: - Opening

    private func maybeOpen() {
        guard !opening, !disposed, window != nil else { return }
        guard libId >= 0, let path = filePath as String?, !path.isEmpty else { return }

        opening = true
        NativeReadiumViewRegistry.register(libId, self)
        sendDebug("view: opening \(path)")

        let initialLocator = Self.parseInitialLocator(locatorJson as String?)
        let preferences = ReaderPreferencesMapper.parse(json: settingsJson as String?)

        Task { [weak self] in
            do {
                let publication = try await Self.openPublication(path: path)
                guard let self = self else {
                    publication.close()
                    return
                }
                if self.disposed {
                    publication.close()
                    return
                }
                do {
                    try self.attachNavigator(
                        publication: publication,
                        initialLocator: initialLocator,
                        preferences: preferences
                    )
                } catch {
                    // Allow a retry (remount) instead of wedging the view.
                    self.opening = false
                    self.navigator = nil
                    publication.close()
                    self.publication = nil
                    self.sendError("Reader crashed while starting the navigator:\n\(Self.describe(error))")
                }
            } catch {
                guard let self = self, !self.disposed else { return }
                self.opening = false
                self.sendError(Self.describe(error))
            }
        }
    }

    private enum OpenError: Error, CustomStringConvertible {
        case message(String)
        var description: String {
            switch self {
            case let .message(text): return text
            }
        }
    }

    private static func openPublication(path: String) async throws -> Publication {
        guard FileManager.default.fileExists(atPath: path) else {
            throw OpenError.message("EPUB file does not exist: \(path)")
        }
        guard let fileURL = FileURL(path: path, isDirectory: false) else {
            throw OpenError.message("Invalid EPUB file path: \(path)")
        }

        let readium = ReadiumContext.shared
        let asset: Asset
        switch await readium.assetRetriever.retrieve(url: fileURL) {
        case let .success(retrieved):
            asset = retrieved
        case let .failure(error):
            throw OpenError.message("Readium could not read the EPUB asset:\n\(describe(error))")
        }

        switch await readium.publicationOpener.open(asset: asset, allowUserInteraction: false) {
        case let .success(publication):
            return publication
        case let .failure(error):
            throw OpenError.message("Readium could not open this EPUB:\n\(describe(error))")
        }
    }

    private func attachNavigator(
        publication: Publication,
        initialLocator: Locator?,
        preferences: EPUBPreferences
    ) throws {
        // On a cold start the view can attach before its view controller is
        // reachable, so poll briefly instead of failing immediately (mirrors
        // the Android "activity not ready" retry).
        guard let hostController = reactViewController() else {
            if parentWaitAttempts < Self.maxParentWaitAttempts {
                parentWaitAttempts += 1
                sendDebug("view: host view controller not ready, retrying (\(parentWaitAttempts))")
                opening = false
                DispatchQueue.main.asyncAfter(deadline: .now() + Self.parentWaitInterval) { [weak self] in
                    self?.maybeOpen()
                }
                publication.close()
                return
            }
            publication.close()
            opening = false
            sendError("Reader could not find the host view controller.")
            return
        }
        parentWaitAttempts = 0

        // Official pattern (EPUBViewController.init): custom editing actions
        // resolved on the responder chain — this view implements the selectors.
        let editingActions = EditingAction.defaultActions + [
            EditingAction(title: "하이라이트", action: #selector(highlightSelection)),
            EditingAction(title: "댓글", action: #selector(commentSelection)),
        ]

        let navigator = try EPUBNavigatorViewController(
            publication: publication,
            initialLocation: initialLocator,
            config: EPUBNavigatorViewController.Configuration(
                preferences: preferences,
                editingActions: editingActions,
                // Keep the existing escape route until chapter pulls have been
                // verified in an iPhone build (including short chapters).
                disablePageTurnsWhileScrolling: false
            ),
            httpServer: ReadiumContext.shared.httpServer
        )

        self.publication = publication
        self.navigator = navigator
        navigator.delegate = self

        hostController.addChild(navigator)
        navigator.view.frame = bounds
        navigator.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(navigator.view)
        navigator.didMove(toParent: hostController)

        scrollModeEnabled = isScrollModeEnabled()
        refreshChapterPullObservers()
        scheduleChapterPullObserverRefreshes()
        sendOpened(publication)
    }

    // MARK: - Commands from the React Native module (main thread)

    func submitPreferences(_ newSettingsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let navigator = navigator else {
            reject("NOT_READY", "The reader is not open yet.", nil)
            return
        }
        settingsJson = newSettingsJson as NSString
        pullNavigationGeneration += 1
        cancelChapterPull()
        navigator.submitPreferences(ReaderPreferencesMapper.parse(json: newSettingsJson))
        scrollModeEnabled = isScrollModeEnabled()
        refreshChapterPullObservers()
        scheduleChapterPullObserverRefreshes()
        resolve(true)
    }

    func goToLocator(_ locatorJsonString: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let navigator = navigator else {
            reject("NOT_READY", "The reader is not open yet.", nil)
            return
        }
        guard let locator = try? Locator(jsonString: locatorJsonString) else {
            reject("BAD_LOCATOR", "Could not parse the locator JSON.", nil)
            return
        }
        Task {
            let moved = await navigator.go(to: locator, options: NavigatorGoOptions(animated: true))
            resolve(moved)
        }
    }

    func goToHref(_ href: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let publication = publication, let navigator = navigator else {
            reject("NOT_READY", "The reader is not open yet.", nil)
            return
        }
        Task {
            // Official pattern (OutlineTableView): locate(link) -> go.
            guard let link = await Self.findLink(in: publication, href: href) else {
                reject("NO_LINK", "No TOC entry matches href: \(href)", nil)
                return
            }
            guard let locator = await publication.locate(link) else {
                reject("NO_LOCATOR", "No locator for href: \(href)", nil)
                return
            }
            let moved = await navigator.go(to: locator, options: NavigatorGoOptions(animated: true))
            resolve(moved)
        }
    }

    /// Applies highlight decorations from JSON:
    /// `[{ "id": string, "tint": int(ARGB), "style"?: "highlight"|"underline",
    ///     "isActive"?: bool, "locator": {...} }]`
    func applyDecorations(_ group: String, decorationsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let navigator = navigator else {
            reject("NOT_READY", "The reader is not open yet.", nil)
            return
        }
        guard
            let data = decorationsJson.data(using: .utf8),
            let items = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]]
        else {
            reject("DECORATION_ERROR", "Could not parse the decorations JSON.", nil)
            return
        }

        var decorations: [Decoration] = []
        for item in items {
            guard
                let id = item["id"] as? String,
                let locatorObject = item["locator"],
                let locator = try? Locator(json: locatorObject)
            else { continue }
            let tint = Self.color(fromARGB: (item["tint"] as? NSNumber)?.int64Value ?? 0)
            let isActive = item["isActive"] as? Bool ?? false
            let style: Decoration.Style = (item["style"] as? String) == "underline"
                ? .underline(tint: tint, isActive: isActive)
                : .highlight(tint: tint, isActive: isActive)
            decorations.append(Decoration(id: id, locator: locator, style: style))
        }

        if listenedGroups.insert(group).inserted {
            navigator.observeDecorationInteractions(inGroup: group) { [weak self] event in
                self?.handleDecorationActivated(event)
            }
        }
        navigator.apply(decorations: decorations, in: group)
        resolve(decorations.count)
    }

    func clearSelection() {
        navigator?.clearSelection()
    }

    /// Locates quotes in this edition by searching for their leading text.
    /// Input: `[{ "quoteId": int, "searchText": string }]`.
    ///
    /// Emits an incremental `quoteLocated` event per match (so decorations can
    /// be painted progressively) and resolves the promise with the full result
    /// JSON: `[{ "quoteId": int, "locator": {...} }]`.
    func findQuoteLocators(_ requestsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let publication = publication else {
            reject("NOT_READY", "The reader is not open yet.", nil)
            return
        }
        guard publication.isSearchable else {
            reject("NOT_SEARCHABLE", "This publication has no search service.", nil)
            return
        }
        guard
            let data = requestsJson.data(using: .utf8),
            let requests = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]]
        else {
            reject("SEARCH_ERROR", "Could not parse the search requests JSON.", nil)
            return
        }

        Task { [weak self] in
            var results: [[String: Any]] = []
            for request in requests {
                guard let self = self, !self.disposed else { break }
                guard
                    let quoteId = (request["quoteId"] as? NSNumber)?.intValue,
                    let searchText = (request["searchText"] as? String)?
                        .trimmingCharacters(in: .whitespacesAndNewlines),
                    !searchText.isEmpty
                else { continue }

                guard let locator = await Self.searchFirstLocator(in: publication, query: searchText) else {
                    continue
                }
                results.append(["quoteId": quoteId, "locator": locator.json])
                NativeReadiumEvents.send("NativeReadiumHost.quoteLocated", [
                    "libraryId": self.libId,
                    "quoteId": quoteId,
                    "locatorJson": locator.jsonString ?? "{}",
                ])
            }
            guard let json = try? JSONSerialization.data(withJSONObject: results),
                  let jsonString = String(data: json, encoding: .utf8)
            else {
                reject("SEARCH_ERROR", "Could not serialize the search results.", nil)
                return
            }
            resolve(jsonString)
        }
    }

    private static func searchFirstLocator(in publication: Publication, query: String) async -> Locator? {
        guard case let .success(iterator) = await publication.search(
            query: query,
            options: SearchOptions(caseSensitive: false, diacriticSensitive: false)
        ) else { return nil }
        defer { iterator.close() }
        while true {
            guard case let .success(collection) = await iterator.next(), let collection = collection else {
                return nil
            }
            if let locator = collection.locators.first {
                return locator
            }
        }
    }

    // MARK: - Decoration taps -> React Native

    private func handleDecorationActivated(_ event: OnDecorationActivatedEvent) {
        NativeReadiumEvents.send("NativeReadiumHost.highlightTapped", [
            "libraryId": libId,
            "decorationId": event.decoration.id,
            "group": event.group,
        ])
    }

    // MARK: - Text selection actions -> React Native

    @objc private func highlightSelection() {
        sendSelection(action: "highlight")
    }

    @objc private func commentSelection() {
        sendSelection(action: "comment")
    }

    private func sendSelection(action: String) {
        guard let navigator = navigator, let selection = navigator.currentSelection else { return }
        NativeReadiumEvents.send("NativeReadiumHost.textSelected", [
            "libraryId": libId,
            "action": action,
            "text": selection.locator.text.highlight ?? "",
            "locatorJson": selection.locator.jsonString ?? "{}",
        ])
        navigator.clearSelection()
    }

    // MARK: - Events -> React Native

    private func sendOpened(_ publication: Publication) {
        Task { [weak self] in
            guard let self = self else { return }
            var toc: [[String: Any]] = []
            if case let .success(links) = await publication.tableOfContents() {
                func walk(_ links: [ReadiumShared.Link], depth: Int) {
                    for link in links {
                        let title = link.title?.isEmpty == false ? link.title! : link.href
                        toc.append(["title": title, "href": link.href, "depth": depth])
                        if let linkTitle = link.title, !linkTitle.isEmpty {
                            self.chapterTitleByHref[Self.hrefWithoutFragment(link.href)] = linkTitle
                        }
                        walk(link.children, depth: depth + 1)
                    }
                }
                walk(links, depth: 0)
            }

            let tocJson: String = {
                guard let data = try? JSONSerialization.data(withJSONObject: toc),
                      let string = String(data: data, encoding: .utf8)
                else { return "[]" }
                return string
            }()

            NativeReadiumEvents.send("NativeReadiumHost.opened", [
                "libraryId": self.libId,
                "title": publication.metadata.title ?? "",
                "tocJson": tocJson,
                "searchable": publication.isSearchable,
            ])
            self.sendDebug(
                "view opened \"\(publication.metadata.title ?? "?")\" (toc=\(toc.count), searchable=\(publication.isSearchable))"
            )
            self.refreshChapterPullObservers()
        }
    }

    fileprivate func sendLocation(_ locator: Locator) {
        refreshChapterPullObservers()
        let progress = locator.locations.totalProgression ?? locator.locations.progression
        var snapshot: [String: Any] = [
            "v": Self.readiumLocationVersion,
            "engine": "readium",
            "locator": locator.json,
        ]
        if let progress = progress {
            snapshot["progress"] = progress
        } else {
            snapshot["progress"] = NSNull()
        }
        guard let data = try? JSONSerialization.data(withJSONObject: snapshot),
              let location = String(data: data, encoding: .utf8)
        else { return }

        NativeReadiumEvents.send("NativeReadiumHost.locationChanged", [
            "libraryId": libId,
            "location": location,
            "progress": progress.map { $0 as Any } ?? NSNull(),
            "href": locator.href.string,
            "title": locator.title ?? NSNull(),
        ])
    }

    fileprivate func sendError(_ message: String) {
        sendDebug("view error: \(message)")
        NativeReadiumEvents.send("NativeReadiumHost.error", [
            "libraryId": libId,
            "message": message,
        ])
    }

    fileprivate func sendDebug(_ message: String) {
        NativeReadiumEvents.send("NativeReadiumHost.debug", [
            "libraryId": libId,
            "message": message,
        ])
    }

    // MARK: - Teardown

    func dispose() {
        guard !disposed else { return }
        disposed = true
        pullNavigationGeneration += 1
        removeChapterPullObservers()
        if libId >= 0 {
            NativeReadiumViewRegistry.unregister(libId, self)
        }
        if let navigator = navigator {
            navigator.willMove(toParent: nil)
            navigator.view.removeFromSuperview()
            navigator.removeFromParent()
        }
        navigator = nil
        publication?.close()
        publication = nil
    }

    // MARK: - Helpers

    private static func parseInitialLocator(_ raw: String?) -> Locator? {
        guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
            return nil
        }
        guard
            let data = text.data(using: .utf8),
            let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return nil }
        let locatorObject = (root["locator"] as? [String: Any]) ?? root
        return try? Locator(json: locatorObject)
    }

    // MARK: - Scroll-mode chapter pull (observe-only)

    /// Readium 3.1.0's public navigator view tree contains a `WKWebView` for
    /// each loaded EPUB spread. Observe the WebKit scroll views' existing pan
    /// recognizers; no recognizer/delegate replacement or touch interception
    /// is used, so WebKit keeps handling scrolling, taps and text selection.
    private func refreshChapterPullObservers() {
        guard let root = navigator?.view else { return }
        var current: [ObjectIdentifier: UIScrollView] = [:]

        func walk(_ view: UIView) {
            if let webView = view as? WKWebView {
                let scrollView = webView.scrollView
                current[ObjectIdentifier(scrollView)] = scrollView
            }
            for child in view.subviews {
                walk(child)
            }
        }
        walk(root)

        let removed = observedScrollViews.filter { current[$0.key] == nil }
        for (identifier, scrollView) in removed {
            if pullScrollView === scrollView { cancelChapterPull() }
            scrollView.panGestureRecognizer.removeTarget(self, action: #selector(observeChapterPullPan(_:)))
            restoreChapterPullBounceSettings(scrollView)
            observedScrollViews.removeValue(forKey: identifier)
        }
        for (identifier, scrollView) in current where observedScrollViews[identifier] == nil {
            scrollView.panGestureRecognizer.addTarget(self, action: #selector(observeChapterPullPan(_:)))
            observedScrollViews[identifier] = scrollView
        }
        for (identifier, scrollView) in current {
            if scrollModeEnabled {
                if originalBounceSettings[identifier] == nil {
                    originalBounceSettings[identifier] = (scrollView.bounces, scrollView.alwaysBounceVertical)
                }
                // Readium 3.1 disables bouncing. Without alwaysBounceVertical,
                // a resource shorter than the viewport may never recognize a
                // vertical pan, leaving the observer with no events at all.
                scrollView.bounces = true
                scrollView.alwaysBounceVertical = true
            } else {
                restoreChapterPullBounceSettings(scrollView)
            }
        }
    }

    private func restoreChapterPullBounceSettings(_ scrollView: UIScrollView) {
        if let original = originalBounceSettings.removeValue(forKey: ObjectIdentifier(scrollView)) {
            scrollView.bounces = original.bounces
            scrollView.alwaysBounceVertical = original.vertical
        }
    }

    /// Readium can invalidate and recreate its spread views asynchronously
    /// after preferences change. Re-scan on subsequent main-loop turns as well
    /// as from layout/location callbacks, so the replacement WebViews are
    /// observed without modifying their scroll delegates.
    private func scheduleChapterPullObserverRefreshes() {
        observerRefreshGeneration += 1
        let generation = observerRefreshGeneration
        for delay in [0.0, 0.05, 0.15, 0.35, 0.75, 1.5, 2.5] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self = self,
                      !self.disposed,
                      self.observerRefreshGeneration == generation
                else { return }
                self.refreshChapterPullObservers()
            }
        }
    }

    private func removeChapterPullObservers() {
        observerRefreshGeneration += 1
        for scrollView in observedScrollViews.values {
            scrollView.panGestureRecognizer.removeTarget(self, action: #selector(observeChapterPullPan(_:)))
            restoreChapterPullBounceSettings(scrollView)
        }
        observedScrollViews.removeAll()
        cancelChapterPull()
    }

    @objc private func observeChapterPullPan(_ recognizer: UIPanGestureRecognizer) {
        guard let scrollView = recognizer.view as? UIScrollView else { return }
        // Adjacent/preloaded WebViews must not cancel another view's gesture.
        guard pullScrollView == nil || pullScrollView === scrollView else { return }
        guard !disposed, scrollModeEnabled,
              isVisibleChapterScrollView(scrollView)
        else {
            if pullScrollView === scrollView { cancelChapterPull() }
            return
        }

        switch recognizer.state {
        case .began:
            cancelChapterPull()
            pullScrollView = scrollView
            pullLastTranslation = recognizer.translation(in: scrollView)
            pullLastContentOffsetY = scrollView.contentOffset.y
            pullGestureActive = Date().timeIntervalSince1970 - lastChapterJumpAt > Self.chapterJumpCooldown
                && !pullNavigationPending
                && navigator?.currentSelection == nil
                && recognizer.numberOfTouches <= 1
        case .changed:
            guard pullGestureActive, navigator?.currentSelection == nil,
                  recognizer.numberOfTouches <= 1
            else {
                if pullInProgress { cancelChapterPull() }
                resetChapterPullGesture()
                return
            }
            updateChapterPull(scrollView, translation: recognizer.translation(in: scrollView))
        case .ended:
            guard pullGestureActive, navigator?.currentSelection == nil else {
                if pullInProgress { cancelChapterPull() }
                resetChapterPullGesture()
                return
            }
            updateChapterPull(scrollView, translation: recognizer.translation(in: scrollView))
            if pullInProgress {
                let distance = pullDirection > 0 ? -pullTravel.y : pullTravel.y
                if distance >= Self.chapterPullThreshold {
                    commitChapterPull()
                } else {
                    cancelChapterPull()
                }
            }
            resetChapterPullGesture()
        case .cancelled, .failed:
            if pullInProgress { cancelChapterPull() }
            resetChapterPullGesture()
        default:
            break
        }
    }

    private func updateChapterPull(_ scrollView: UIScrollView, translation: CGPoint) {
        let delta = CGPoint(
            x: translation.x - pullLastTranslation.x,
            y: translation.y - pullLastTranslation.y
        )
        pullLastTranslation = translation
        let previousOffset = pullLastContentOffsetY
        let offset = scrollView.contentOffset.y
        pullLastContentOffsetY = offset
        let top = -scrollView.adjustedContentInset.top
        let bottom = max(
            top,
            scrollView.contentSize.height - scrollView.bounds.height + scrollView.adjustedContentInset.bottom
        )

        if pullInProgress {
            pullTravel.x += delta.x
            pullTravel.y += delta.y
            let distance = pullDirection > 0 ? -pullTravel.y : pullTravel.y
            guard distance > 0, isVerticallyDominant(pullTravel) else {
                cancelChapterPullAttempt()
                return
            }
            sendChapterPullProgress(distance)
            return
        }

        if pullCandidateActive {
            let travel = CGPoint(
                x: translation.x - pullCandidateAnchor.x,
                y: translation.y - pullCandidateAnchor.y
            )
            let distance = pullDirection > 0 ? -travel.y : travel.y
            let stillAtEdge = pullDirection > 0 ? offset >= bottom - 1 : offset <= top + 1
            guard stillAtEdge, distance > 0 else {
                pullCandidateActive = false
                pullDirection = 0
                pullTravel = .zero
                return
            }
            guard isVerticallyDominant(travel) else { return }
            beginChapterPull(direction: pullDirection, travel: travel)
            sendChapterPullProgress(distance)
            return
        }

        let direction: Int
        if delta.y < 0, offset >= bottom - 1 {
            direction = 1
        } else if delta.y > 0, offset <= top + 1 {
            direction = -1
        } else {
            return
        }

        guard adjacentChapter(direction: direction) != nil else { return }
        let fingerDistance = direction > 0 ? -delta.y : delta.y
        let distanceConsumedBeforeEdge = direction > 0
            ? max(0, bottom - previousOffset)
            : max(0, previousOffset - top)
        let beyondEdgeDistance = max(0, fingerDistance - distanceConsumedBeforeEdge)
        guard beyondEdgeDistance > 0, fingerDistance > 0 else { return }
        let beyondEdgeFraction = beyondEdgeDistance / fingerDistance
        pullCandidateActive = true
        pullDirection = direction
        pullCandidateAnchor = CGPoint(
            x: translation.x - delta.x * beyondEdgeFraction,
            y: translation.y - delta.y * beyondEdgeFraction
        )
        let travel = CGPoint(
            x: delta.x * beyondEdgeFraction,
            y: delta.y * beyondEdgeFraction
        )
        let distance = direction > 0 ? -travel.y : travel.y
        guard isVerticallyDominant(travel) else { return }
        beginChapterPull(direction: direction, travel: travel)
        sendChapterPullProgress(distance)
    }

    private func beginChapterPull(direction: Int, travel: CGPoint) {
        guard let target = adjacentChapter(direction: direction) else {
            pullCandidateActive = false
            pullDirection = 0
            pullTravel = .zero
            return
        }
        pullCandidateActive = false
        pullInProgress = true
        pullDirection = direction
        pullTargetIndex = target.index
        pullTargetTitle = target.title
        pullTravel = travel
        pullLastSentProgress = 0
        sendChapterPull("pull", direction: direction, progress: 0, title: target.title)
    }

    private func isVerticallyDominant(_ translation: CGPoint) -> Bool {
        abs(translation.y) > abs(translation.x) * 1.2
    }

    private func sendChapterPullProgress(_ distance: CGFloat) {
        let progress = min(Double(distance / Self.chapterPullThreshold), 1.5)
        guard abs(progress - pullLastSentProgress) >= 0.01 else { return }
        pullLastSentProgress = progress
        sendChapterPull("pull", direction: pullDirection, progress: progress, title: pullTargetTitle)
    }

    /// Ends a pull attempt but keeps tracking the current pan, matching the
    /// Android behavior that permits another pull before the finger is lifted.
    private func cancelChapterPullAttempt() {
        if pullInProgress {
            sendChapterPull("cancel", direction: pullDirection, progress: 0, title: pullTargetTitle)
        }
        pullInProgress = false
        pullCandidateActive = false
        pullDirection = 0
        pullTargetIndex = -1
        pullTargetTitle = nil
        pullLastSentProgress = -1
        pullTravel = .zero
    }

    private func adjacentChapter(direction: Int) -> (index: Int, title: String?)? {
        guard let publication = publication,
              let currentHref = navigator?.currentLocation?.href.string
        else { return nil }
        let href = Self.hrefWithoutFragment(currentHref)
        guard let currentIndex = publication.readingOrder.firstIndex(where: {
            Self.hrefWithoutFragment($0.href) == href
        }) else { return nil }
        let targetIndex = currentIndex + direction
        guard publication.readingOrder.indices.contains(targetIndex) else { return nil }
        let link = publication.readingOrder[targetIndex]
        let title = link.title.flatMap { $0.isEmpty ? nil : $0 }
            ?? chapterTitleByHref[Self.hrefWithoutFragment(link.href)]
        return (targetIndex, title)
    }

    private func commitChapterPull() {
        guard !pullNavigationPending,
              let publication = publication,
              let navigator = navigator,
              publication.readingOrder.indices.contains(pullTargetIndex),
              adjacentChapter(direction: pullDirection)?.index == pullTargetIndex
        else {
            cancelChapterPull()
            return
        }

        pullNavigationPending = true
        let generation = pullNavigationGeneration
        let targetIndex = pullTargetIndex
        let link = publication.readingOrder[pullTargetIndex]
        let direction = pullDirection
        let title = pullTargetTitle

        Task { [weak self] in
            guard let self = self else { return }
            defer { self.pullNavigationPending = false }
            guard !self.disposed, self.pullNavigationGeneration == generation else {
                self.sendChapterPull("cancel", direction: direction, progress: 0, title: title)
                return
            }
            var destinationLink = link
            if direction < 0 {
                // Readium's locator service may honor a fragment on the link.
                // Backward chapter pulls need the resource end, not that anchor.
                destinationLink.href = Self.hrefWithoutFragment(destinationLink.href)
            }
            guard var locator = await publication.locate(destinationLink)
            else {
                self.sendChapterPull("cancel", direction: direction, progress: 0, title: title)
                return
            }
            if direction < 0 {
                // A backward chapter transition lands at the end of that chapter.
                locator = locator.copy(locations: { locations in
                    locations.progression = 1.0
                })
            }
            guard !self.disposed, self.navigator === navigator,
                  self.scrollModeEnabled, self.navigator?.currentSelection == nil,
                  self.pullNavigationGeneration == generation,
                  self.adjacentChapter(direction: direction)?.index == targetIndex
            else {
                self.sendChapterPull("cancel", direction: direction, progress: 0, title: title)
                return
            }
            let moved = await navigator.go(to: locator, options: NavigatorGoOptions(animated: true))
            if moved {
                self.lastChapterJumpAt = Date().timeIntervalSince1970
            }
            self.sendChapterPull(moved ? "commit" : "cancel",
                                 direction: direction, progress: moved ? 1 : 0, title: title)
        }
    }

    private func cancelChapterPull() {
        if pullInProgress {
            sendChapterPull("cancel", direction: pullDirection, progress: 0, title: pullTargetTitle)
        }
        resetChapterPullGesture()
    }

    private func resetChapterPullGesture() {
        pullScrollView = nil
        pullGestureActive = false
        pullInProgress = false
        pullCandidateActive = false
        pullDirection = 0
        pullTargetIndex = -1
        pullTargetTitle = nil
        pullLastSentProgress = -1
        pullLastTranslation = .zero
        pullLastContentOffsetY = 0
        pullCandidateAnchor = .zero
        pullTravel = .zero
    }

    private func sendChapterPull(_ phase: String, direction: Int, progress: Double, title: String?) {
        NativeReadiumEvents.send("NativeReadiumHost.chapterPull", [
            "libraryId": libId,
            "phase": phase,
            "direction": direction > 0 ? "next" : "prev",
            "progress": progress,
            "targetTitle": title ?? NSNull(),
        ])
    }

    private func isVisibleChapterScrollView(_ scrollView: UIScrollView) -> Bool {
        guard let root = navigator?.view else {
            return false
        }
        var ancestor = scrollView.superview
        while ancestor != nil, !(ancestor is WKWebView) {
            ancestor = ancestor?.superview
        }
        guard let webView = ancestor as? WKWebView else { return false }
        let visibleRect = webView.convert(webView.bounds, to: nil).intersection(root.convert(root.bounds, to: nil))
        return webView.window != nil
            && !webView.isHidden
            && webView.alpha > 0
            && visibleRect.width > root.bounds.width / 2
            && visibleRect.height > 0
    }

    private func isScrollModeEnabled() -> Bool {
        guard let text = settingsJson as String?,
              let data = text.data(using: .utf8),
              let settings = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return false }
        return settings["scrollMode"] as? String == "vertical"
    }

    private static func hrefWithoutFragment(_ href: String) -> String {
        String(href.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first ?? Substring(href))
    }

    private static func findLink(in publication: Publication, href: String) async -> ReadiumShared.Link? {
        func search(_ links: [ReadiumShared.Link]) -> ReadiumShared.Link? {
            for link in links {
                if link.href == href { return link }
                if let found = search(link.children) { return found }
            }
            return nil
        }
        if case let .success(toc) = await publication.tableOfContents(), let found = search(toc) {
            return found
        }
        return search(publication.readingOrder)
    }

    /// UIColor from a signed 32-bit ARGB int (the format the JS side computes).
    private static func color(fromARGB value: Int64) -> UIColor {
        let argb = UInt32(bitPattern: Int32(truncatingIfNeeded: value))
        let alpha = CGFloat((argb >> 24) & 0xFF) / 255.0
        let red = CGFloat((argb >> 16) & 0xFF) / 255.0
        let green = CGFloat((argb >> 8) & 0xFF) / 255.0
        let blue = CGFloat(argb & 0xFF) / 255.0
        return UIColor(red: red, green: green, blue: blue, alpha: alpha)
    }

    private static func describe(_ error: Error) -> String {
        var parts: [String] = []
        var current: Error? = error
        while let e = current, parts.count < 10 {
            parts.append(String(describing: e))
            current = (e as NSError).userInfo[NSUnderlyingErrorKey] as? Error
        }
        return parts.joined(separator: "\n← ")
    }
}

// MARK: - EPUBNavigatorDelegate

extension NativeReadiumView: EPUBNavigatorDelegate {
    func navigator(_ navigator: Navigator, locationDidChange locator: Locator) {
        sendLocation(locator)
    }

    func navigator(_ navigator: Navigator, didJumpTo locator: Locator) {
        sendLocation(locator)
    }

    func navigator(_ navigator: Navigator, presentError error: NavigatorError) {
        sendError(String(describing: error))
    }

    func navigator(_ navigator: Navigator, presentExternalURL url: URL) {
        UIApplication.shared.open(url)
    }

    func navigator(_ navigator: Navigator, shouldNavigateToNoteAt link: ReadiumShared.Link, content: String, referrer: String?) -> Bool {
        true
    }

    func navigator(_ navigator: Navigator, didFailToLoadResourceAt href: RelativeURL, withError error: ReadError) {
        NativeReadiumEvents.send("NativeReadiumHost.resourceLoadFailed", [
            "libraryId": libId,
            "href": href.string,
            "message": String(describing: error),
        ])
    }

    // Official pattern (VisualReaderViewController.didTapAt): edge taps turn
    // pages; a center tap is forwarded to React Native so it can toggle its
    // overlay chrome.
    func navigator(_ navigator: VisualNavigator, didTapAt point: CGPoint) {
        Task { [weak self] in
            guard let self = self else { return }
            guard await !DirectionalNavigationAdapter(navigator: navigator).didTap(at: point) else {
                return
            }
            NativeReadiumEvents.send("NativeReadiumHost.centerTapped", [
                "libraryId": self.libId,
            ])
        }
    }

    func navigator(_ navigator: VisualNavigator, didPressKey event: KeyEvent) {
        Task {
            await DirectionalNavigationAdapter(navigator: navigator).didPressKey(event: event)
        }
    }
}
