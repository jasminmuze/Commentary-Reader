package {{PACKAGE_NAME}}.readiumhost

import android.app.AlertDialog
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.commitNow
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.facebook.react.bridge.Arguments
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.readium.r2.navigator.HyperlinkNavigator
import org.readium.r2.navigator.OverflowableNavigator
import org.readium.r2.navigator.VisualNavigator
import org.readium.r2.navigator.epub.EpubNavigatorFactory
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.navigator.epub.EpubPreferences
import org.readium.r2.navigator.input.InputListener
import org.readium.r2.navigator.input.TapEvent
import org.readium.r2.navigator.preferences.FontFamily
import org.readium.r2.navigator.preferences.Theme
import org.readium.r2.navigator.util.DirectionalNavigationAdapter
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Link
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.util.AbsoluteUrl
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.asset.Asset
import org.readium.r2.shared.util.asset.AssetRetriever
import org.readium.r2.shared.util.data.ReadError
import org.readium.r2.shared.util.http.DefaultHttpClient
import org.readium.r2.streamer.PublicationOpener
import org.readium.r2.streamer.parser.DefaultPublicationParser

/**
 * Hosts the Readium EPUB navigator, following the official readium/kotlin-toolkit
 * test-app reader implementation (ReaderActivity + VisualReaderFragment +
 * EpubReaderFragment + FullscreenReaderActivityDelegate + SystemUiManagement):
 *
 * - Navigator added via `commitNow` and looked up by tag, with a fragment factory.
 * - `DirectionalNavigationAdapter` turns pages when tapping the screen edges.
 * - A center tap toggles the system UI (immersive reading, official behavior).
 * - TOC navigation is `publication.locatorFromLink(link)` -> `go(locator, true)`.
 * - Publisher styles stay enabled by default; only user-changed settings are applied.
 *
 * The official test-app hides/shows system bars with legacy `systemUiVisibility`
 * flags, which are ignored on the Android 15+ targets Expo SDK 54 builds against,
 * so the equivalent `WindowInsetsControllerCompat` calls are used instead.
 */
@OptIn(ExperimentalReadiumApi::class)
class NativeReadiumActivity : FragmentActivity(), EpubNavigatorFragment.Listener {
    private val containerId: Int = View.generateViewId()
    private var libraryId: Int = -1
    private var publication: Publication? = null
    private var asset: Asset? = null
    private var navigator: EpubNavigatorFragment? = null
    private var locationJob: Job? = null
    private lateinit var root: FrameLayout
    private var toolbar: LinearLayout? = null
    private var systemUiVisible = true
    private var settingsJson: JSONObject = JSONObject()

    private val insetsController: WindowInsetsControllerCompat by lazy {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            isAppearanceLightStatusBars = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        // Official pattern (EpubReaderFragment.onCreate): when the activity is being
        // restored after process death, the publication is not opened yet, so fragment
        // restoration cannot instantiate the navigator. Install the official dummy
        // factory so `super.onCreate` does not crash, then close the reader; the user
        // reopens it from the app (the manifest's configChanges already prevents
        // recreation on rotation, so this only happens after process death).
        if (savedInstanceState != null) {
            supportFragmentManager.fragmentFactory = EpubNavigatorFragment.createDummyFactory()
            super.onCreate(savedInstanceState)
            finish()
            return
        }

        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)

        libraryId = intent.getIntExtra(EXTRA_LIBRARY_ID, -1)
        root = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(14, 17, 23))
        }
        setContentView(root)
        showLoading()

        val filePath = intent.getStringExtra(EXTRA_FILE_PATH)
        if (libraryId < 0 || filePath.isNullOrBlank()) {
            showError("Reader was opened without a valid book.")
            return
        }

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                try {
                    openPublication(File(filePath))
                } catch (t: Throwable) {
                    Try.failure("Reader crashed while opening the EPUB:\n${describeThrowable(t)}")
                }
            }

            when (result) {
                is Try.Success -> {
                    try {
                        showReader(result.value)
                    } catch (t: Throwable) {
                        showError("Reader crashed while starting the navigator:\n${describeThrowable(t)}")
                    }
                }
                is Try.Failure -> showError(result.value)
            }
        }
    }

    private fun showCentered(vararg views: View) {
        root.removeAllViews()
        toolbar = null
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(24.dp, 24.dp, 24.dp, 24.dp)
        }
        views.forEach { column.addView(it) }
        root.addView(
            column,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
    }

    private fun showLoading() {
        showCentered(
            ProgressBar(this),
            TextView(this).apply {
                text = "Opening EPUB..."
                setTextColor(Color.WHITE)
                textSize = 15f
                gravity = Gravity.CENTER
                setPadding(0, 24, 0, 0)
            },
        )
    }

    private fun showError(message: String) {
        sendDebug("error: $message")
        showSystemUi()
        showCentered(
            TextView(this).apply {
                text = message
                setTextColor(Color.WHITE)
                textSize = 15f
                gravity = Gravity.CENTER
            },
        )
    }

    private fun showReader(opened: OpenedPublication) {
        root.removeAllViews()

        val container = FrameLayout(this).apply {
            id = containerId
        }
        root.addView(
            container,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )

        val toolbar = buildToolbar(opened.publication)
        root.addView(
            toolbar,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP,
            ),
        )
        this.toolbar = toolbar

        // Official pattern: pad by the system bar insets (ignoring visibility) so the
        // toolbar never sits underneath the status bar. See SystemUiManagement.padSystemUi.
        ViewCompat.setOnApplyWindowInsetsListener(toolbar) { view, insets ->
            val bars = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.systemBars())
            view.setPadding(12.dp + bars.left, 8.dp + bars.top, 12.dp + bars.right, 8.dp)
            insets
        }
        // The toolbar is attached after the window's initial insets pass, so the
        // listener above never fires on its own and the toolbar renders with zero
        // padding underneath the status bar. Official pattern: request a fresh
        // dispatch (VisualReaderFragment.updateSystemUiVisibility -> requestApplyInsets).
        ViewCompat.requestApplyInsets(toolbar)

        asset = opened.asset
        publication = opened.publication

        val initialLocator = parseInitialLocator(intent.getStringExtra(EXTRA_LOCATOR_JSON))
        settingsJson = try {
            JSONObject(intent.getStringExtra(EXTRA_SETTINGS_JSON) ?: "")
        } catch (_: Exception) {
            JSONObject()
        }
        val preferences = parsePreferences(settingsJson)

        // Official pattern (EpubReaderFragment.onCreate/onCreateView): fragment factory,
        // then commitNow and look the navigator up by tag.
        supportFragmentManager.fragmentFactory =
            EpubNavigatorFactory(opened.publication)
                .createFragmentFactory(
                    initialLocator = initialLocator,
                    initialPreferences = preferences,
                    listener = this,
                )

        supportFragmentManager.commitNow {
            replace(containerId, EpubNavigatorFragment::class.java, Bundle(), NAVIGATOR_TAG)
        }

        val navigatorFragment =
            supportFragmentManager.findFragmentByTag(NAVIGATOR_TAG) as EpubNavigatorFragment
        navigator = navigatorFragment

        // Official pattern (VisualReaderFragment.onViewCreated): edge taps and arrow keys
        // turn pages; a center tap toggles the system UI.
        (navigatorFragment as OverflowableNavigator).apply {
            addInputListener(DirectionalNavigationAdapter(this))
        }
        (navigatorFragment as VisualNavigator).apply {
            addInputListener(object : InputListener {
                override fun onTap(event: TapEvent): Boolean {
                    toggleSystemUi()
                    return true
                }
            })
        }

        observeLocation()
        sendDebug(
            "opened \"${opened.publication.metadata.title}\" " +
                "(toc=${opened.publication.tableOfContents.size}, " +
                "initialLocator=${initialLocator != null})"
        )

        // The official test app starts immersive, but our users expect the menu to
        // be visible when the book opens (like the previous reader). Tapping the
        // center of the screen toggles it, same as the official behavior.
        showSystemUi()
    }

    private fun buildToolbar(publication: Publication): LinearLayout {
        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(12.dp, 8.dp, 12.dp, 8.dp)
            setBackgroundColor(Color.argb(235, 14, 17, 23))
        }
        toolbar.addView(toolbarButton("Back") { finish() })
        toolbar.addView(
            TextView(this).apply {
                text = intent.getStringExtra(EXTRA_TITLE) ?: publication.metadata.title ?: "Reader"
                setTextColor(Color.WHITE)
                textSize = 16f
                maxLines = 1
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            },
        )
        toolbar.addView(toolbarButton("Aa") { showSettingsMenu() })
        toolbar.addView(toolbarButton("TOC") { showTableOfContents() })
        return toolbar
    }

    // Reader settings menu, mirroring the previous reader's "Aa" panel. Preferences
    // are applied through the official Configurable API (submitPreferences) and the
    // updated settings are sent back to React Native for persistence.

    private fun showSettingsMenu() {
        if (navigator == null) return
        val sections = arrayOf("테마", "글꼴", "글자 크기", "줄 간격", "여백", "보기 방식")
        AlertDialog.Builder(this)
            .setTitle("보기 설정")
            .setItems(sections) { _, index ->
                when (index) {
                    0 -> pickOption(
                        "테마",
                        "theme",
                        "paper",
                        listOf("paper" to "밝게 (기본)", "sepia" to "세피아", "dark" to "어둡게"),
                    )
                    1 -> pickOption(
                        "글꼴",
                        "font",
                        "georgia",
                        listOf(
                            "georgia" to "출판사 기본",
                            "serif" to "명조 (Serif)",
                            "sans" to "고딕 (Sans)",
                        ),
                    )
                    2 -> pickFontSize()
                    3 -> pickOption(
                        "줄 간격",
                        "lineSpacing",
                        "normal",
                        listOf("compact" to "좁게", "normal" to "기본", "wide" to "넓게"),
                    )
                    4 -> pickOption(
                        "여백",
                        "margin",
                        "normal",
                        listOf("narrow" to "좁게", "normal" to "기본", "wide" to "넓게"),
                    )
                    5 -> pickOption(
                        "보기 방식",
                        "scrollMode",
                        "vertical",
                        listOf("vertical" to "스크롤", "paged" to "페이지 넘김"),
                    )
                }
            }
            .setNegativeButton("닫기", null)
            .show()
    }

    private fun pickOption(
        title: String,
        key: String,
        defaultValue: String,
        options: List<Pair<String, String>>,
    ) {
        val current = settingsJson.optString(key).ifBlank { defaultValue }
        val checked = options.indexOfFirst { it.first == current }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setSingleChoiceItems(options.map { it.second }.toTypedArray(), checked) { dialog, index ->
                applySetting(key, options[index].first)
                dialog.dismiss()
            }
            .setNegativeButton("닫기", null)
            .show()
    }

    private fun pickFontSize() {
        val sizes = listOf(14, 16, 18, 19, 21, 23, 26)
        val current = settingsJson.optDouble("fontSize", DEFAULT_FONT_SIZE)
        val checked = sizes.indexOfFirst { it.toDouble() == current }
        val labels = sizes.map { if (it.toDouble() == DEFAULT_FONT_SIZE) "${it}pt (기본)" else "${it}pt" }
        AlertDialog.Builder(this)
            .setTitle("글자 크기")
            .setSingleChoiceItems(labels.toTypedArray(), checked) { dialog, index ->
                applySetting("fontSize", sizes[index])
                dialog.dismiss()
            }
            .setNegativeButton("닫기", null)
            .show()
    }

    private fun applySetting(key: String, value: Any) {
        settingsJson.put(key, value)
        navigator?.submitPreferences(parsePreferences(settingsJson))
        sendDebug("settings: $key=$value")

        val payload = Arguments.createMap().apply {
            putInt("libraryId", libraryId)
            putString("settings", settingsJson.toString())
        }
        NativeReadiumEvents.send("NativeReadiumHost.settingsChanged", payload)
    }

    private fun toolbarButton(label: String, action: () -> Unit): TextView =
        TextView(this).apply {
            text = label
            setTextColor(Color.WHITE)
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(12.dp, 8.dp, 12.dp, 8.dp)
            setOnClickListener { action() }
        }

    // System UI management, equivalent to the official SystemUiManagement.kt utils.
    // The official file uses legacy `systemUiVisibility` flags, which are no-ops on
    // the Android 15+ targets used by Expo SDK 54, so WindowInsetsControllerCompat
    // (the platform-mandated replacement) is used here.

    private fun showSystemUi() {
        systemUiVisible = true
        insetsController.show(WindowInsetsCompat.Type.systemBars())
        toolbar?.visibility = View.VISIBLE
        // Official pattern: re-dispatch insets whenever the bars visibility changes.
        toolbar?.let { ViewCompat.requestApplyInsets(it) }
    }

    private fun hideSystemUi() {
        systemUiVisible = false
        insetsController.hide(WindowInsetsCompat.Type.systemBars())
        toolbar?.visibility = View.GONE
    }

    private fun toggleSystemUi() {
        if (systemUiVisible) hideSystemUi() else showSystemUi()
    }

    private fun showTableOfContents() {
        val currentPublication = publication ?: return
        val currentNavigator = navigator ?: return
        val items = flattenToc(currentPublication.tableOfContents)

        if (items.isEmpty()) {
            AlertDialog.Builder(this)
                .setTitle("Table of contents")
                .setMessage("This EPUB does not expose a table of contents.")
                .setPositiveButton("OK", null)
                .show()
            return
        }

        AlertDialog.Builder(this)
            .setTitle("Table of contents")
            .setItems(items.map { it.title }.toTypedArray()) { dialog, index ->
                val link = items[index].link
                // Official pattern (NavigationFragment.onLinkSelected +
                // ReaderActivity.closeOutlineFragment): locatorFromLink, then go.
                val locator = currentPublication.locatorFromLink(link)
                if (locator != null) {
                    val moved = currentNavigator.go(locator, animated = true)
                    sendDebug("toc -> ${link.href} moved=$moved")
                } else {
                    sendDebug("toc: no locator for ${link.href}")
                }
                dialog.dismiss()
            }
            .show()
    }

    private fun observeLocation() {
        val currentNavigator = navigator ?: return
        locationJob?.cancel()
        locationJob = lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                currentNavigator.currentLocator
                    .collect { locator -> sendLocation(locator) }
            }
        }
    }

    private suspend fun openPublication(file: File): Try<OpenedPublication, String> {
        if (!file.exists()) {
            return Try.failure("EPUB file does not exist: ${file.absolutePath}")
        }

        val httpClient = DefaultHttpClient()
        val assetRetriever = AssetRetriever(contentResolver, httpClient)
        val retrievedAsset = assetRetriever.retrieve(file).fold(
            onSuccess = { it },
            onFailure = { return Try.failure("Readium could not read the EPUB asset:\n${describeError(it)}") },
        )

        val parser = DefaultPublicationParser(
            this,
            httpClient = httpClient,
            assetRetriever = assetRetriever,
            pdfFactory = null,
        )
        val opener = PublicationOpener(parser)
        val openedPublication = opener.open(retrievedAsset, allowUserInteraction = true).fold(
            onSuccess = { it },
            onFailure = {
                retrievedAsset.close()
                return Try.failure("Readium could not open this EPUB:\n${describeError(it)}")
            },
        )

        return Try.success(OpenedPublication(retrievedAsset, openedPublication))
    }

    private fun describeThrowable(root: Throwable): String {
        val parts = mutableListOf<String>()
        var current: Throwable? = root
        while (current != null && parts.size < 10) {
            parts.add("${current.javaClass.simpleName}: ${current.message ?: "no message"}")
            current = current.cause
        }
        return parts.joinToString("\n\u2190 ")
    }

    private fun describeError(error: org.readium.r2.shared.util.Error): String {
        val parts = mutableListOf<String>()
        var current: org.readium.r2.shared.util.Error? = error
        while (current != null && parts.size < 10) {
            parts.add(current.message)
            val throwable = (current as? org.readium.r2.shared.util.ThrowableError<*>)?.throwable
            if (throwable != null) {
                parts.add(describeThrowable(throwable))
            }
            current = current.cause
        }
        return parts.distinct().joinToString("\n\u2190 ")
    }

    private fun parseInitialLocator(raw: String?): Locator? {
        val text = raw?.trim().takeUnless { it.isNullOrBlank() } ?: return null
        return try {
            val root = JSONObject(text)
            val locatorJson = root.optJSONObject("locator") ?: root
            Locator.fromJSON(locatorJson)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Maps the app's reader settings onto [EpubPreferences].
     *
     * Follows the official test-app model: preferences default to empty, which keeps
     * the publisher's original styles enabled. Only settings the user changed from
     * the app defaults are applied. Line spacing / margins require disabling
     * publisher styles (mirroring the official preferences editor, which activates
     * that switch when those preferences are edited), so publisher styles are only
     * turned off when the user explicitly picked a non-default value for them.
     */
    private fun parsePreferences(settings: JSONObject): EpubPreferences {
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

    private fun sendLocation(locator: Locator) {
        val progress = locator.locations.totalProgression ?: locator.locations.progression
        val snapshot = JSONObject()
            .put("v", READIUM_LOCATION_VERSION)
            .put("engine", "readium")
            .put("locator", locator.toJSON())
            .put("progress", progress)

        val payload = Arguments.createMap().apply {
            putInt("libraryId", libraryId)
            putString("location", snapshot.toString())
            if (progress == null) {
                putNull("progress")
            } else {
                putDouble("progress", progress)
            }
            putString("href", locator.href.toString())
            putString("title", locator.title)
        }

        NativeReadiumEvents.send("NativeReadiumHost.locationChanged", payload)
    }

    private fun sendDebug(message: String) {
        val payload = Arguments.createMap().apply {
            putInt("libraryId", libraryId)
            putString("message", message)
        }
        NativeReadiumEvents.send("NativeReadiumHost.debug", payload)
    }

    override fun onResourceLoadFailed(href: org.readium.r2.shared.util.Url, error: ReadError) {
        val payload = Arguments.createMap().apply {
            putInt("libraryId", libraryId)
            putString("href", href.toString())
            putString("message", error.message)
        }
        NativeReadiumEvents.send("NativeReadiumHost.resourceLoadFailed", payload)
    }

    override fun onJumpToLocator(locator: Locator) {
        sendLocation(locator)
    }

    override fun shouldFollowInternalLink(link: Link, context: HyperlinkNavigator.LinkContext?): Boolean =
        true

    override fun onExternalLinkActivated(url: AbsoluteUrl) {
        runCatching {
            startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url.toString())))
        }
    }

    override fun onDestroy() {
        locationJob?.cancel()
        publication?.close()
        asset?.close()
        if (libraryId >= 0) {
            val payload = Arguments.createMap().apply { putInt("libraryId", libraryId) }
            NativeReadiumEvents.send("NativeReadiumHost.closed", payload)
        }
        super.onDestroy()
    }

    private data class OpenedPublication(
        val asset: Asset,
        val publication: Publication,
    )

    private data class TocItem(
        val title: String,
        val link: Link,
    )

    private fun flattenToc(links: List<Link>, depth: Int = 0): List<TocItem> =
        links.flatMap { link ->
            val prefix = if (depth == 0) "" else "  ".repeat(depth)
            val title = link.title?.takeIf { it.isNotBlank() } ?: link.href.toString()
            listOf(TocItem("$prefix$title", link)) + flattenToc(link.children, depth + 1)
        }

    private val Int.dp: Int
        get() = (this * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_LIBRARY_ID = "libraryId"
        const val EXTRA_FILE_PATH = "filePath"
        const val EXTRA_LOCATOR_JSON = "locatorJson"
        const val EXTRA_SETTINGS_JSON = "settingsJson"
        const val EXTRA_TITLE = "title"

        private const val NAVIGATOR_TAG = "native-readium-navigator"
        private const val READIUM_LOCATION_VERSION = 4
        private const val DEFAULT_FONT_SIZE = 19.0
    }
}
