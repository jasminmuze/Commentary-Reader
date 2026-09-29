//
//  NativeReadiumViewRegistry.swift
//  Maps libraryId -> active NativeReadiumView so the RN module can dispatch
//  commands to the right embedded reader (mirrors the Android registry).
//

import Foundation

final class NativeReadiumViewRegistry {
    private static var views: [Int: WeakBox] = [:]

    private struct WeakBox {
        weak var view: NativeReadiumView?
    }

    /// Main-thread only (matches how RN commands are dispatched).
    static func register(_ libraryId: Int, _ view: NativeReadiumView) {
        views[libraryId] = WeakBox(view: view)
    }

    static func unregister(_ libraryId: Int, _ view: NativeReadiumView) {
        if views[libraryId]?.view === view || views[libraryId]?.view == nil {
            views.removeValue(forKey: libraryId)
        }
    }

    static func get(_ libraryId: Int) -> NativeReadiumView? {
        views[libraryId]?.view
    }
}
