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

    private static let maxParentWaitAttempts = 20
    private static let parentWaitInterval: TimeInterval = 0.25
    private static let readiumLocationVersion = 4

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
                editingActions: editingActions
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

        sendOpened(publication)
    }

    // MARK: - Commands from the React Native module (main thread)

    func submitPreferences(_ newSettingsJson: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let navigator = navigator else {
            reject("NOT_READY", "The reader is not open yet.", nil)
            return
        }
        settingsJson = newSettingsJson as NSString
        navigator.submitPreferences(ReaderPreferencesMapper.parse(json: newSettingsJson))
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
        }
    }

    fileprivate func sendLocation(_ locator: Locator) {
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
