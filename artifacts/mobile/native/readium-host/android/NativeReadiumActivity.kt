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
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.commit
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.facebook.react.bridge.Arguments
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.readium.r2.navigator.HyperlinkNavigator
import org.readium.r2.navigator.epub.EpubNavigatorFactory
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.navigator.epub.EpubPreferences
import org.readium.r2.navigator.preferences.FontFamily
import org.readium.r2.navigator.preferences.TextAlign
import org.readium.r2.navigator.preferences.Theme
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
import org.readium.r2.shared.util.mediatype.MediaType
import org.readium.r2.streamer.PublicationOpener
import org.readium.r2.streamer.parser.DefaultPublicationParser

@OptIn(ExperimentalReadiumApi::class)
class NativeReadiumActivity : FragmentActivity(), EpubNavigatorFragment.Listener {
    private var containerId: Int = View.generateViewId()
    private var libraryId: Int = -1
    private var publication: Publication? = null
    private var asset: Asset? = null
    private var navigator: EpubNavigatorFragment? = null
    private var locationJob: Job? = null
    private lateinit var root: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        libraryId = intent.getIntExtra(EXTRA_LIBRARY_ID, -1)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
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
                openPublication(File(filePath))
            }

            when (result) {
                is Try.Success -> showReader(result.value)
                is Try.Failure -> showError(result.value)
            }
        }
    }

    private fun showLoading() {
        root.removeAllViews()
        root.gravity = Gravity.CENTER
        root.addView(ProgressBar(this))
        root.addView(
            TextView(this).apply {
                text = "Opening EPUB..."
                setTextColor(Color.WHITE)
                textSize = 15f
                gravity = Gravity.CENTER
                setPadding(0, 24, 0, 0)
            }
        )
    }

    private fun showReader(opened: OpenedPublication) {
        root.removeAllViews()
        root.gravity = Gravity.NO_GRAVITY

        val toolbar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(12.dp, 8.dp, 12.dp, 8.dp)
            setBackgroundColor(Color.rgb(14, 17, 23))
        }

        toolbar.addView(toolbarButton("Back") { finish() })
        toolbar.addView(
            TextView(this).apply {
                text = intent.getStringExtra(EXTRA_TITLE) ?: opened.publication.metadata.title ?: "Reader"
                setTextColor(Color.WHITE)
                textSize = 16f
                maxLines = 1
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
        )
        toolbar.addView(toolbarButton("TOC") { showTableOfContents() })

        val container = FrameLayout(this).apply {
            id = containerId
            setBackgroundColor(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f,
            )
        }

        root.addView(toolbar)
        root.addView(container)

        asset = opened.asset
        publication = opened.publication

        val initialLocator = parseInitialLocator(intent.getStringExtra(EXTRA_LOCATOR_JSON))
        val preferences = parsePreferences(intent.getStringExtra(EXTRA_SETTINGS_JSON))

        supportFragmentManager.fragmentFactory =
            EpubNavigatorFactory(opened.publication)
                .createFragmentFactory(
                    initialLocator = initialLocator,
                    initialPreferences = preferences,
                    listener = this,
                )

        supportFragmentManager.commit {
            replace(containerId, EpubNavigatorFragment::class.java, Bundle(), NAVIGATOR_TAG)
        }

        supportFragmentManager.executePendingTransactions()
        navigator = supportFragmentManager.findFragmentByTag(NAVIGATOR_TAG) as? EpubNavigatorFragment
        observeLocation()
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
                currentNavigator.go(items[index].link, animated = false)
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
                    .distinctUntilChanged()
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
            onFailure = { return Try.failure("Readium could not read the EPUB asset: ${it.message}") },
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
                return Try.failure("Readium could not open this EPUB: ${it.message}")
            },
        )

        return Try.success(OpenedPublication(retrievedAsset, openedPublication))
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

    private fun parsePreferences(raw: String?): EpubPreferences {
        val settings = try {
            raw?.let { JSONObject(it) }
        } catch (_: Exception) {
            null
        }

        val theme = when (settings?.optString("theme")) {
            "sepia" -> Theme.SEPIA
            "light" -> Theme.LIGHT
            else -> Theme.DARK
        }

        val fontFamily = when (settings?.optString("font")) {
            "sans" -> FontFamily.SANS_SERIF
            else -> FontFamily.SERIF
        }

        val fontSize = settings
            ?.optDouble("fontSize")
            ?.takeIf { !it.isNaN() && !it.isInfinite() && it > 0 }
            ?.let { (it / 16.0).coerceIn(0.75, 1.8) }

        return EpubPreferences(
            theme = theme,
            fontFamily = fontFamily,
            fontSize = fontSize,
            lineHeight = lineHeightScale(settings?.optString("lineSpacing")),
            pageMargins = marginScale(settings?.optString("margin")),
            publisherStyles = false,
            scroll = settings?.optString("scrollMode") == "vertical",
            textAlign = TextAlign.START,
        )
    }

    private fun marginScale(value: String?): Double? =
        when (value) {
            "narrow" -> 0.8
            "wide" -> 1.4
            else -> 1.0
        }

    private fun lineHeightScale(value: String?): Double? =
        when (value) {
            "compact" -> 1.4
            "wide" -> 2.2
            else -> 1.85
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

    private fun showError(message: String) {
        root.removeAllViews()
        root.gravity = Gravity.CENTER
        root.setPadding(24.dp, 24.dp, 24.dp, 24.dp)
        root.addView(
            TextView(this).apply {
                text = message
                setTextColor(Color.WHITE)
                textSize = 15f
                gravity = Gravity.CENTER
            }
        )
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
    }
}
