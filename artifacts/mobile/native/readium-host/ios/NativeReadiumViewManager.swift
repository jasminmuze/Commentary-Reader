//
//  NativeReadiumViewManager.swift
//  Exposes `NativeReadiumView` to React Native (legacy view manager, hosted by
//  the Fabric interop layer under the new architecture).
//

import Foundation
import React

@objc(NativeReadiumViewManager)
class NativeReadiumViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        NativeReadiumView()
    }
}
