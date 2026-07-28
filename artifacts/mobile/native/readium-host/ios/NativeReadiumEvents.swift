//
//  NativeReadiumEvents.swift
//  Event bridge from the native Readium reader to React Native.
//
//  Mirrors the Android `NativeReadiumEvents` object: every payload carries the
//  `libraryId` so the JS side can route events to the right reader instance.
//
//  On iOS, events flow through the `NativeReadiumHost` RCTEventEmitter module;
//  the JS side subscribes with `new NativeEventEmitter(NativeModules.NativeReadiumHost)`.
//  Events emitted before the first JS listener registers are buffered briefly
//  and flushed on `startObserving` (cold-start race defense).
//

import Foundation

final class NativeReadiumEvents {
    static let allEvents: [String] = [
        "NativeReadiumHost.opened",
        "NativeReadiumHost.locationChanged",
        "NativeReadiumHost.centerTapped",
        "NativeReadiumHost.highlightTapped",
        "NativeReadiumHost.textSelected",
        "NativeReadiumHost.quoteLocated",
        "NativeReadiumHost.chapterPull",
        "NativeReadiumHost.error",
        "NativeReadiumHost.debug",
        "NativeReadiumHost.resourceLoadFailed",
    ]

    private static let lock = NSLock()
    private static weak var emitter: NativeReadiumHostModule?
    private static var observing = false
    private static var pending: [(name: String, body: [String: Any])] = []
    private static let maxPending = 64

    static func attach(_ module: NativeReadiumHostModule) {
        lock.lock()
        emitter = module
        lock.unlock()
    }

    static func setObserving(_ value: Bool) {
        lock.lock()
        observing = value
        let toFlush = value ? pending : []
        if value { pending.removeAll() }
        let module = emitter
        lock.unlock()

        guard value, let module = module else { return }
        for event in toFlush {
            module.sendEvent(withName: event.name, body: event.body)
        }
    }

    static func send(_ name: String, _ body: [String: Any]) {
        lock.lock()
        let module = emitter
        let isObserving = observing
        if !isObserving || module == nil {
            pending.append((name, body))
            if pending.count > maxPending {
                pending.removeFirst(pending.count - maxPending)
            }
            lock.unlock()
            return
        }
        lock.unlock()
        module?.sendEvent(withName: name, body: body)
    }
}
