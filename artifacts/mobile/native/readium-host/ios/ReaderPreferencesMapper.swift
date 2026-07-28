//
//  ReaderPreferencesMapper.swift
//  Maps the app's reader settings JSON to Readium EPUBPreferences.
//
//  Mirrors the Android `ReaderPreferencesMapper` exactly so both platforms
//  render the same settings identically:
//  - Preferences default EMPTY (publisher styles ON); only user-changed
//    settings are applied (official Readium test-app semantics).
//  - lineHeight / pageMargins only take effect with publisherStyles=false,
//    so that switch is flipped only when the user picked a non-default value.
//

import Foundation
import ReadiumNavigator

enum ReaderPreferencesMapper {
    static let defaultFontSize = 19.0

    static func parse(_ settings: [String: Any]) -> EPUBPreferences {
        let theme: Theme? = {
            switch settings["theme"] as? String {
            case "sepia": return .sepia
            case "dark", "oled", "forest": return .dark
            default: return nil // paper/gray: Readium's default (light) theme
            }
        }()

        let fontFamily: FontFamily? = {
            switch settings["font"] as? String {
            case "sans": return .sansSerif
            case "serif": return .serif
            default: return nil // app default: keep the publisher's font
            }
        }()

        let fontSize: Double? = {
            guard let raw = settings["fontSize"] as? Double ?? (settings["fontSize"] as? NSNumber)?.doubleValue,
                  raw.isFinite, raw > 0, raw != defaultFontSize
            else { return nil }
            return min(max(raw / defaultFontSize, 0.75), 2.0)
        }()

        let scroll: Bool? = {
            switch settings["scrollMode"] as? String {
            case "vertical": return true
            case "paged": return false
            default: return nil
            }
        }()

        let lineHeight: Double? = {
            switch settings["lineSpacing"] as? String {
            case "compact": return 1.2
            case "wide": return 1.8
            default: return nil // app default: keep the publisher's line height
            }
        }()

        let pageMargins: Double? = {
            switch settings["margin"] as? String {
            case "narrow": return 0.5
            case "wide": return 2.0
            default: return nil // app default: keep the publisher's margins
            }
        }()

        let publisherStyles: Bool? = (lineHeight != nil || pageMargins != nil) ? false : nil

        return EPUBPreferences(
            fontFamily: fontFamily,
            fontSize: fontSize,
            lineHeight: lineHeight,
            pageMargins: pageMargins,
            publisherStyles: publisherStyles,
            scroll: scroll,
            theme: theme
        )
    }

    static func parse(json: String?) -> EPUBPreferences {
        guard
            let data = json?.data(using: .utf8),
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else {
            return .empty
        }
        return parse(object)
    }
}
