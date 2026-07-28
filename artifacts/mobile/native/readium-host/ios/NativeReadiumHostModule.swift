//
//  NativeReadiumHostModule.swift
//  React Native module `NativeReadiumHost` — command entry points targeting an
//  embedded NativeReadiumView (by libraryId), plus the event emitter the JS
//  side subscribes to with `new NativeEventEmitter(NativeModules.NativeReadiumHost)`.
//
//  Mirrors the Android `NativeReadiumModule` method-for-method so the JS
//  bridge contract is identical on both platforms.
//

import Foundation
import React

@objc(NativeReadiumHost)
class NativeReadiumHostModule: RCTEventEmitter {
    override init() {
        super.init()
        NativeReadiumEvents.attach(self)
    }

    @objc override static func requiresMainQueueSetup() -> Bool {
        false
    }

    override func supportedEvents() -> [String]! {
        NativeReadiumEvents.allEvents
    }

    override func startObserving() {
        NativeReadiumEvents.setObserving(true)
    }

    override func stopObserving() {
        NativeReadiumEvents.setObserving(false)
    }

    // -----------------------------------------------------------------
    // Commands targeting an embedded NativeReadiumView (by libraryId).
    // All view/navigator access must happen on the main thread.
    // -----------------------------------------------------------------

    @objc func submitPreferences(_ libraryId: NSInteger, settingsJson: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        withView(libraryId, reject) { view in
            view.submitPreferences(settingsJson, resolve: resolve, reject: reject)
        }
    }

    @objc func goToLocator(_ libraryId: NSInteger, locatorJson: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        withView(libraryId, reject) { view in
            view.goToLocator(locatorJson, resolve: resolve, reject: reject)
        }
    }

    @objc func goToHref(_ libraryId: NSInteger, href: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        withView(libraryId, reject) { view in
            view.goToHref(href, resolve: resolve, reject: reject)
        }
    }

    @objc func applyDecorations(_ libraryId: NSInteger, group: String, decorationsJson: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        withView(libraryId, reject) { view in
            view.applyDecorations(group, decorationsJson: decorationsJson, resolve: resolve, reject: reject)
        }
    }

    @objc func clearSelection(_ libraryId: NSInteger) {
        DispatchQueue.main.async {
            NativeReadiumViewRegistry.get(libraryId)?.clearSelection()
        }
    }

    @objc func findQuoteLocators(_ libraryId: NSInteger, requestsJson: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        withView(libraryId, reject) { view in
            view.findQuoteLocators(requestsJson, resolve: resolve, reject: reject)
        }
    }

    private func withView(
        _ libraryId: Int,
        _ reject: @escaping RCTPromiseRejectBlock,
        _ block: @escaping (NativeReadiumView) -> Void
    ) {
        DispatchQueue.main.async {
            guard let view = NativeReadiumViewRegistry.get(libraryId) else {
                reject("NO_VIEW", "No active reader view for library \(libraryId).", nil)
                return
            }
            block(view)
        }
    }
}
