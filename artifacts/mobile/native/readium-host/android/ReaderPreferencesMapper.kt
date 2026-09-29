package {{PACKAGE_NAME}}.readiumhost

import org.json.JSONObject
import org.readium.r2.navigator.epub.EpubPreferences
import org.readium.r2.navigator.preferences.FontFamily
import org.readium.r2.navigator.preferences.Theme
import org.readium.r2.shared.ExperimentalReadiumApi

/**
 * Maps the app's reader settings JSON onto [EpubPreferences].
 *
 * Follows the official test-app model: preferences default to empty, which keeps
 * the publisher's original styles enabled. Only settings the user changed from
 * the app defaults are applied. Line spacing / margins require disabling
 * publisher styles (mirroring the official preferences editor, which activates
 * that switch when those preferences are edited), so publisher styles are only
 * turned off when the user explicitly picked a non-default value for them.
 */
@OptIn(ExperimentalReadiumApi::class)
internal object ReaderPreferencesMapper {
    const val DEFAULT_FONT_SIZE = 19.0

    fun parse(settings: JSONObject): EpubPreferences {
        val theme = when (settings.optString("theme")) {
            "sepia" -> Theme.SEPIA
            "dark", "oled", "forest" -> Theme.DARK
            else -> null // paper/gray: Readium's default (light) theme
        }

        val fontFamily = when (settings.optString("font")) {
            "sans" -> FontFamily.SANS_SERIF
            "serif" -> FontFamily.SERIF
            else -> null // app default: keep the publisher's font
        }

        val fontSize = settings.optDouble("fontSize")
            .takeIf { !it.isNaN() && !it.isInfinite() && it > 0 && it != DEFAULT_FONT_SIZE }
            ?.let { (it / DEFAULT_FONT_SIZE).coerceIn(0.75, 2.0) }

        val scroll = when (settings.optString("scrollMode")) {
            "vertical" -> true
            "paged" -> false
            else -> null
        }

        val lineHeight = when (settings.optString("lineSpacing")) {
            "compact" -> 1.2
            "wide" -> 1.8
            else -> null // app default: keep the publisher's line height
        }

        val pageMargins = when (settings.optString("margin")) {
            "narrow" -> 0.5
            "wide" -> 2.0
            else -> null // app default: keep the publisher's margins
        }

        val publisherStyles = if (lineHeight != null || pageMargins != null) false else null

        return EpubPreferences(
            theme = theme,
            fontFamily = fontFamily,
            fontSize = fontSize,
            scroll = scroll,
            lineHeight = lineHeight,
            pageMargins = pageMargins,
            publisherStyles = publisherStyles,
        )
    }
}
