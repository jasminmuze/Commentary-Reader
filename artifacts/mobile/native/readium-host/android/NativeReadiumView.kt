package {{PACKAGE_NAME}}.readiumhost

import android.graphics.Rect
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.commitNow
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.ThemedReactContext
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import org.readium.r2.navigator.DecorableNavigator
import org.readium.r2.navigator.Decoration
import org.readium.r2.navigator.HyperlinkNavigator
import org.readium.r2.navigator.OverflowableNavigator
import org.readium.r2.navigator.SelectableNavigator
import org.readium.r2.navigator.VisualNavigator
import org.readium.r2.navigator.epub.EpubNavigatorFactory
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.navigator.input.InputListener
import org.readium.r2.navigator.input.TapEvent
import org.readium.r2.navigator.util.BaseActionModeCallback
import org.readium.r2.navigator.util.DirectionalNavigationAdapter
import org.readium.r2.shared.ExperimentalReadiumApi
import org.readium.r2.shared.publication.Link
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.publication.services.search.SearchService
import org.readium.r2.shared.publication.services.search.isSearchable
import org.readium.r2.shared.publication.services.search.search
import org.readium.r2.shared.util.AbsoluteUrl
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.Url
import org.readium.r2.shared.util.asset.Asset
import org.readium.r2.shared.util.asset.AssetRetriever
import org.readium.r2.shared.util.data.ReadError
import org.readium.r2.shared.util.http.DefaultHttpClient
import org.readium.r2.streamer.PublicationOpener
import org.readium.r2.streamer.parser.DefaultPublicationParser

/**
 * A React Native view that embeds the Readium EPUB navigator fragment inline,
 * so all reader chrome (toolbar, settings, TOC, comment sheet) can be rendered
 * by React Native as overlays.
 *
 * Follows the official readium/kotlin-toolkit test-app reader implementation
 * (EpubReaderFragment + VisualReaderFragment) for:
 * - Fragment creation through `createFragmentFactory` and tag lookup.
 * - `DirectionalNavigationAdapter` edge taps + center tap events.
 * - Community highlights as `Decoration.Style.Highlight` groups with a
 *   `DecorableNavigator.Listener` for tap activation.
 * - Text selection via a custom `selectionActionModeCallback`.
 * - Cross-edition quote matching through the publication's `SearchService`.
 *
 * The Expo `MainActivity` template calls `super.onCreate(null)`, so the host
 * activity never restores fragment state after process death — the navigator
 * fragment is always created fresh by this view (a stale fragment with our tag
 * is defensively removed before adding).
 */
@OptIn(ExperimentalReadiumApi::class)
class NativeReadiumView(
    private val themedContext: ThemedReactContext,
) : FrameLayout(themedContext), EpubNavigatorFragment.Listener {

    var libraryId: Int = -1
    var filePath: String? = null
    var locatorJson: String? = null
    var settingsJson: String? = null

    private val fragmentContainer = FrameLayout(themedContext).apply {
        id = View.generateViewId()
    }
    private val fragmentTag: String get() = "native-readium-view-${fragmentContainer.id}"

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    // The open runs on its own scope that dispose() does NOT cancel: if the view
    // is disposed mid-open, the completion handler below still runs and closes
    // the freshly opened publication/asset instead of leaking them.
    private val openScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var opening = false
    private var disposed = false
    // On a cold start the view can attach before the Activity is registered on
    // the React context, so we poll briefly instead of failing immediately.
    private var activityWaitAttempts = 0
    private var publication: Publication? = null
    private var asset: Asset? = null
    private var navigator: EpubNavigatorFragment? = null
    private var locationJob: Job? = null
    private val listenedGroups = mutableSetOf<String>()

    // ------------------------------------------------------------------
    // Chapter pull (scroll mode only): observe-only overscroll tracking.
    // Touch events are NEVER consumed or intercepted here — dispatchTouchEvent
    // just watches the stream and forwards everything to super, so text
    // selection, decoration taps, edge taps and normal scrolling are untouched.
    // Any unexpected error permanently disables the detector for this view
    // (pullDetectionBroken) and the reader keeps working as before.
    // ------------------------------------------------------------------
    private var scrollModeEnabled = false
    private var selectionModeActive = false
    private var pullDetectionBroken = false
    private var lastChapterJumpAtMs = 0L

    // Per-gesture state (reset on ACTION_DOWN).
    private var pullGestureActive = false
    private var pullInProgress = false
    private var pullDirection = 0 // +1 next chapter, -1 previous chapter
    private var pullAnchorY = 0f
    private var pullLastY = 0f
    private var pullTargetIndex = -1
    private var pullTargetTitle: String? = null
    private var pullLastSentProgress = -1f

    init {
        addView(
            fragmentContainer,
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
        )
    }

    // React Native does not run a traditional Android layout pass for native
    // children added outside of React (the fragment's view), so re-measure and
    // re-layout manually whenever a layout is requested. This is the standard
    // pattern for hosting fragments inside React Native views.
    private val measureAndLayout = Runnable {
        measure(
            MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
        )
        layout(left, top, right, bottom)
    }

    override fun requestLayout() {
        super.requestLayout()
        post(measureAndLayout)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        activityWaitAttempts = 0
        maybeOpen()
    }

    /** Called when props are committed and when the view attaches. */
    fun maybeOpen() {
        if (opening || disposed || !isAttachedToWindow) return
        val path = filePath
        if (libraryId < 0 || path.isNullOrBlank()) return
        val activity = themedContext.currentActivity as? FragmentActivity ?: run {
            // Cold start: the Activity may not be attached to the React context
            // yet. Retry for a few seconds before giving up.
            if (activityWaitAttempts < MAX_ACTIVITY_WAIT_ATTEMPTS) {
                activityWaitAttempts += 1
                sendDebug("view: host activity not ready, retrying ($activityWaitAttempts)")
                postDelayed({ maybeOpen() }, ACTIVITY_WAIT_INTERVAL_MS)
            } else {
                sendError("Reader could not find the host activity.")
            }
            return
        }
        activityWaitAttempts = 0

        opening = true
        NativeReadiumViewRegistry.register(libraryId, this)
        sendDebug("view: opening $path")

        openScope.launch {
            val result = try {
                openPublication(File(path))
            } catch (t: Throwable) {
                Try.failure("Reader crashed while opening the EPUB:\n${describeThrowable(t)}")
            }

            UiThreadUtil.runOnUiThread {
                if (disposed) {
                    if (result is Try.Success) {
                        result.value.publication.close()
                        result.value.asset.close()
                    }
                    return@runOnUiThread
                }

                when (result) {
                    is Try.Success -> {
                        // Re-resolve the activity: the one captured before the
                        // async open may have been destroyed in the meantime.
                        val hostActivity =
                            (themedContext.currentActivity as? FragmentActivity) ?: activity
                        if (hostActivity.isDestroyed || hostActivity.isFinishing) {
                            opening = false
                            result.value.publication.close()
                            result.value.asset.close()
                            sendError("Reader lost the host activity while opening the EPUB.")
                            return@runOnUiThread
                        }
                        try {
                            attachNavigator(hostActivity, result.value)
                        } catch (t: Throwable) {
                            // Allow a retry (remount / prop update) instead of
                            // wedging the view in a permanent "opening" state.
                            opening = false
                            navigator = null
                            publication?.close()
                            publication = null
                            asset?.close()
                            asset = null
                            sendError("Reader crashed while starting the navigator:\n${describeThrowable(t)}")
                        }
                    }
                    is Try.Failure -> {
                        // Allow a retry (e.g. after a prop update) instead of
                        // wedging the view in a permanent "opening" state.
                        opening = false
                        sendError(result.value)
                    }
                }
            }
        }
    }

    private fun attachNavigator(activity: FragmentActivity, opened: OpenedPublication) {
        asset = opened.asset
        publication = opened.publication

        val initialLocator = parseInitialLocator(locatorJson)
        val preferences = ReaderPreferencesMapper.parse(parseSettingsJson())

        // Official pattern (EpubReaderFragment.onCreate): fragment factory with a
        // custom selection ActionMode callback. The factory instance is used
        // directly to instantiate the fragment, so the activity's global
        // fragmentFactory is left untouched.
        val factory = EpubNavigatorFactory(opened.publication)
            .createFragmentFactory(
                initialLocator = initialLocator,
                initialPreferences = preferences,
                listener = this,
                configuration = EpubNavigatorFragment.Configuration(
                    selectionActionModeCallback = selectionCallback,
                ),
            )

        val fragmentManager = activity.supportFragmentManager
        fragmentManager.findFragmentByTag(fragmentTag)?.let { stale ->
            fragmentManager.commitNow(allowStateLoss = true) { remove(stale) }
        }

        val fragment = factory.instantiate(
            activity.classLoader,
            EpubNavigatorFragment::class.java.name,
        ) as EpubNavigatorFragment

        fragmentManager.commitNow(allowStateLoss = true) {
            add(fragmentContainer.id, fragment, fragmentTag)
        }
        navigator = fragment

        // Official pattern (VisualReaderFragment.onViewCreated): edge taps and
        // arrow keys turn pages; a center tap is forwarded to React Native so it
        // can toggle its overlay chrome.
        (fragment as OverflowableNavigator).apply {
            addInputListener(DirectionalNavigationAdapter(this))
        }
        (fragment as VisualNavigator).apply {
            addInputListener(object : InputListener {
                override fun onTap(event: TapEvent): Boolean {
                    val payload = Arguments.createMap().apply {
                        putInt("libraryId", libraryId)
                    }
                    NativeReadiumEvents.send("NativeReadiumHost.centerTapped", payload)
                    return true
                }
            })
        }

        scrollModeEnabled = isScrollModeEnabled()

        observeLocation(fragment)
        sendOpened(opened.publication)
    }

    // ---------------------------------------------------------------------
    // Chapter pull detection (observe-only).
    // ---------------------------------------------------------------------

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (!pullDetectionBroken) {
            try {
                observeChapterPull(ev)
            } catch (t: Throwable) {
                // Fail closed: disable the detector, keep the reader working.
                pullDetectionBroken = true
                if (pullInProgress) sendChapterPull("cancel", pullDirection, 0f, pullTargetTitle)
                resetPullGesture()
                sendDebug("chapter pull disabled after error: ${describeThrowable(t)}")
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    private fun observeChapterPull(ev: MotionEvent) {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                resetPullGesture()
                pullGestureActive = scrollModeEnabled &&
                    !selectionModeActive &&
                    navigator != null &&
                    (System.currentTimeMillis() - lastChapterJumpAtMs) > CHAPTER_JUMP_COOLDOWN_MS
                pullLastY = ev.y
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                // Multi-touch (pinch/zoom): abort until the next gesture.
                if (pullInProgress) sendChapterPull("cancel", pullDirection, 0f, pullTargetTitle)
                resetPullGesture()
            }
            MotionEvent.ACTION_MOVE -> {
                if (!pullGestureActive) return
                if (selectionModeActive) {
                    // Text selection started mid-gesture: bail out entirely.
                    if (pullInProgress) sendChapterPull("cancel", pullDirection, 0f, pullTargetTitle)
                    resetPullGesture()
                    return
                }
                val y = ev.y
                val dy = y - pullLastY
                pullLastY = y
                if (!pullInProgress) {
                    maybeStartPull(dy, y)
                } else {
                    val distance = (pullAnchorY - y) * pullDirection
                    if (distance <= 0f) {
                        // Dragged back past the anchor: cancel, but keep watching —
                        // the same gesture may pull again.
                        sendChapterPull("cancel", pullDirection, 0f, pullTargetTitle)
                        pullInProgress = false
                        pullDirection = 0
                        pullTargetIndex = -1
                        pullTargetTitle = null
                        pullLastSentProgress = -1f
                        return
                    }
                    val progress = (distance / pullThresholdPx()).coerceAtMost(1.5f)
                    if (kotlin.math.abs(progress - pullLastSentProgress) >= 0.01f) {
                        pullLastSentProgress = progress
                        sendChapterPull("pull", pullDirection, progress, pullTargetTitle)
                    }
                }
            }
            MotionEvent.ACTION_UP -> {
                if (pullInProgress) {
                    val distance = (pullAnchorY - ev.y) * pullDirection
                    if (distance >= pullThresholdPx()) {
                        commitChapterJump()
                    } else {
                        sendChapterPull("cancel", pullDirection, 0f, pullTargetTitle)
                    }
                }
                resetPullGesture()
            }
            MotionEvent.ACTION_CANCEL -> {
                if (pullInProgress) sendChapterPull("cancel", pullDirection, 0f, pullTargetTitle)
                resetPullGesture()
            }
        }
    }

    private fun maybeStartPull(dy: Float, y: Float) {
        if (kotlin.math.abs(dy) < 0.5f) return
        val webView = findVisibleWebView() ?: return
        val direction = when {
            // Finger moving up while the content can no longer scroll down -> pull for NEXT.
            dy < 0 && !webView.canScrollVertically(1) -> 1
            // Finger moving down while the content can no longer scroll up -> pull for PREVIOUS.
            dy > 0 && !webView.canScrollVertically(-1) -> -1
            else -> return
        }
        val target = resolveAdjacentChapter(direction) ?: return
        pullInProgress = true
        pullDirection = direction
        pullAnchorY = y
        pullTargetIndex = target.first
        pullTargetTitle = target.second
        pullLastSentProgress = 0f
        sendChapterPull("pull", direction, 0f, pullTargetTitle)
    }

    /** Returns (readingOrder index, chapter title) of the adjacent resource, or null at the book boundary. */
    private fun resolveAdjacentChapter(direction: Int): Pair<Int, String?>? {
        val pub = publication ?: return null
        val nav = navigator ?: return null
        val currentHref = nav.currentLocator.value.href.toString().substringBefore('#')
        val index = pub.readingOrder.indexOfFirst {
            it.href.toString().substringBefore('#') == currentHref
        }
        if (index < 0) return null
        val targetIndex = index + direction
        if (targetIndex < 0 || targetIndex > pub.readingOrder.lastIndex) return null
        return targetIndex to chapterTitleFor(pub, pub.readingOrder[targetIndex])
    }

    private fun chapterTitleFor(publication: Publication, link: Link): String? {
        link.title?.takeIf { it.isNotBlank() }?.let { return it }
        val target = link.href.toString().substringBefore('#')
        fun search(links: List<Link>): String? {
            for (candidate in links) {
                if (candidate.href.toString().substringBefore('#') == target) {
                    candidate.title?.takeIf { it.isNotBlank() }?.let { return it }
                }
                search(candidate.children)?.let { return it }
            }
            return null
        }
        return search(publication.tableOfContents)
    }

    private fun commitChapterJump() {
        val pub = publication ?: return
        val nav = navigator ?: return
        val targetIndex = pullTargetIndex
        if (targetIndex < 0 || targetIndex > pub.readingOrder.lastIndex) return
        val link = pub.readingOrder[targetIndex]
        var locator = pub.locatorFromLink(link) ?: return
        if (pullDirection < 0) {
            // Going backwards lands at the END of the previous chapter.
            locator = locator.copy(locations = locator.locations.copy(progression = 1.0))
        }
        sendChapterPull("commit", pullDirection, 1f, pullTargetTitle)
        lastChapterJumpAtMs = System.currentTimeMillis()
        nav.go(locator, animated = true)
    }

    /** The currently visible resource WebView inside the navigator, found via view-tree walk only. */
    private fun findVisibleWebView(): WebView? {
        val root = navigator?.view ?: return null
        val visibleRect = Rect()
        fun search(view: View): WebView? {
            if (view is WebView) {
                // The pager keeps offscreen neighbours attached; require actual
                // on-screen coverage so we only inspect the current resource.
                return if (
                    view.isShown &&
                    view.getGlobalVisibleRect(visibleRect) &&
                    visibleRect.width() > this.width / 2
                ) {
                    view
                } else {
                    null
                }
            }
            if (view is ViewGroup) {
                for (i in 0 until view.childCount) {
                    search(view.getChildAt(i))?.let { return it }
                }
            }
            return null
        }
        return search(root)
    }

    private fun resetPullGesture() {
        pullGestureActive = false
        pullInProgress = false
        pullDirection = 0
        pullAnchorY = 0f
        pullLastY = 0f
        pullTargetIndex = -1
        pullTargetTitle = null
        pullLastSentProgress = -1f
    }

    private fun pullThresholdPx(): Float =
        PULL_THRESHOLD_DP * resources.displayMetrics.density

    private fun isScrollModeEnabled(): Boolean =
        parseSettingsJson().optString("scrollMode") == "vertical"

    private fun sendChapterPull(phase: String, direction: Int, progress: Float, title: String?) {
        val payload = Arguments.createMap().apply {
            putInt("libraryId", libraryId)
            putString("phase", phase)
            putString("direction", if (direction > 0) "next" else "prev")
            putDouble("progress", progress.toDouble())
            if (title == null) putNull("targetTitle") else putString("targetTitle", title)
        }
        NativeReadiumEvents.send("NativeReadiumHost.chapterPull", payload)
    }

    private fun observeLocation(fragment: EpubNavigatorFragment) {
        locationJob?.cancel()
        locationJob = scope.launch {
            fragment.currentLocator.collect { locator -> sendLocation(locator) }
        }
    }

    // ---------------------------------------------------------------------
    // Commands from the React Native module (dispatched on the UI thread).
    // ---------------------------------------------------------------------

    fun submitPreferences(newSettingsJson: String, promise: Promise?) {
        val currentNavigator = navigator ?: run {
            promise?.reject("NOT_READY", "The reader is not open yet.")
            return
        }
        settingsJson = newSettingsJson
        try {
            currentNavigator.submitPreferences(ReaderPreferencesMapper.parse(parseSettingsJson()))
            scrollModeEnabled = isScrollModeEnabled()
            if (!scrollModeEnabled && pullInProgress) {
                sendChapterPull("cancel", pullDirection, 0f, pullTargetTitle)
                resetPullGesture()
            }
            promise?.resolve(true)
        } catch (t: Throwable) {
            promise?.reject("SETTINGS_ERROR", describeThrowable(t))
        }
    }

    fun goToLocator(locatorJsonString: String, promise: Promise?) {
        val currentNavigator = navigator ?: run {
            promise?.reject("NOT_READY", "The reader is not open yet.")
            return
        }
        val locator = try {
            Locator.fromJSON(JSONObject(locatorJsonString))
        } catch (_: Exception) {
            null
        }
        if (locator == null) {
            promise?.reject("BAD_LOCATOR", "Could not parse the locator JSON.")
            return
        }
        val moved = currentNavigator.go(locator, animated = true)
        promise?.resolve(moved)
    }

    fun goToHref(href: String, promise: Promise?) {
        val currentPublication = publication
        val currentNavigator = navigator
        if (currentPublication == null || currentNavigator == null) {
            promise?.reject("NOT_READY", "The reader is not open yet.")
            return
        }
        // Official pattern (NavigationFragment.onLinkSelected): locatorFromLink -> go.
        val link = findLinkByHref(currentPublication, href) ?: run {
            promise?.reject("NO_LINK", "No TOC entry matches href: $href")
            return
        }
        val locator = currentPublication.locatorFromLink(link) ?: run {
            promise?.reject("NO_LOCATOR", "No locator for href: $href")
            return
        }
        val moved = currentNavigator.go(locator, animated = true)
        promise?.resolve(moved)
    }

    /**
     * Applies highlight decorations from JSON:
     * `[{ "id": string, "tint": int(ARGB), "style"?: "highlight"|"underline",
     *     "isActive"?: bool, "locator": {...} }]`
     *
     * A `DecorableNavigator.Listener` is registered per group (once) so taps on
     * decorations are forwarded to React Native with the decoration id.
     */
    fun applyDecorations(group: String, decorationsJson: String, promise: Promise?) {
        val currentNavigator = navigator ?: run {
            promise?.reject("NOT_READY", "The reader is not open yet.")
            return
        }
        scope.launch {
            try {
                val array = JSONArray(decorationsJson)
                val decorations = mutableListOf<Decoration>()
                for (i in 0 until array.length()) {
                    val item = array.getJSONObject(i)
                    val locator = Locator.fromJSON(item.optJSONObject("locator")) ?: continue
                    val tint = item.getInt("tint")
                    val isActive = item.optBoolean("isActive", false)
                    val style = when (item.optString("style", "highlight")) {
                        "underline" -> Decoration.Style.Underline(tint = tint, isActive = isActive)
                        else -> Decoration.Style.Highlight(tint = tint, isActive = isActive)
                    }
                    decorations.add(
                        Decoration(
                            id = item.getString("id"),
                            locator = locator,
                            style = style,
                        ),
                    )
                }
                if (listenedGroups.add(group)) {
                    currentNavigator.addDecorationListener(group, decorationListener)
                }
                currentNavigator.applyDecorations(decorations, group)
                promise?.resolve(decorations.size)
            } catch (t: Throwable) {
                promise?.reject("DECORATION_ERROR", describeThrowable(t))
            }
        }
    }

    fun clearSelection() {
        scope.launch {
            (navigator as? SelectableNavigator)?.clearSelection()
        }
    }

    /**
     * Locates quotes in this edition by searching for their leading text.
     * Input: `[{ "quoteId": int, "searchText": string }]`.
     *
     * Emits an incremental `quoteLocated` event per match (so decorations can be
     * painted progressively) and resolves the promise with the full result JSON:
     * `[{ "quoteId": int, "locator": {...} }]`.
     */
    fun findQuoteLocators(requestsJson: String, promise: Promise) {
        val currentPublication = publication ?: run {
            promise.reject("NOT_READY", "The reader is not open yet.")
            return
        }
        if (!currentPublication.isSearchable) {
            promise.reject("NOT_SEARCHABLE", "This publication has no search service.")
            return
        }
        scope.launch {
            try {
                val requests = JSONArray(requestsJson)
                val results = JSONArray()
                for (i in 0 until requests.length()) {
                    if (disposed) break
                    val request = requests.getJSONObject(i)
                    val quoteId = request.getInt("quoteId")
                    val searchText = request.getString("searchText").trim()
                    if (searchText.isEmpty()) continue

                    val locator = searchFirstLocator(currentPublication, searchText) ?: continue
                    results.put(
                        JSONObject()
                            .put("quoteId", quoteId)
                            .put("locator", locator.toJSON()),
                    )
                    val payload = Arguments.createMap().apply {
                        putInt("libraryId", libraryId)
                        putInt("quoteId", quoteId)
                        putString("locatorJson", locator.toJSON().toString())
                    }
                    NativeReadiumEvents.send("NativeReadiumHost.quoteLocated", payload)
                }
                promise.resolve(results.toString())
            } catch (t: Throwable) {
                promise.reject("SEARCH_ERROR", describeThrowable(t))
            }
        }
    }

    private suspend fun searchFirstLocator(publication: Publication, query: String): Locator? {
        val iterator = publication.search(
            query,
            SearchService.Options(caseSensitive = false, diacriticSensitive = false),
        ) ?: return null
        try {
            while (true) {
                val page = iterator.next().getOrNull() ?: return null
                val locator = page.locators.firstOrNull()
                if (locator != null) return locator
            }
        } finally {
            iterator.close()
        }
    }

    // ---------------------------------------------------------------------
    // Decoration taps -> React Native.
    // ---------------------------------------------------------------------

    private val decorationListener = object : DecorableNavigator.Listener {
        override fun onDecorationActivated(event: DecorableNavigator.OnActivatedEvent): Boolean {
            val payload = Arguments.createMap().apply {
                putInt("libraryId", libraryId)
                putString("decorationId", event.decoration.id)
                putString("group", event.group)
            }
            NativeReadiumEvents.send("NativeReadiumHost.highlightTapped", payload)
            return true
        }
    }

    // ---------------------------------------------------------------------
    // Text selection ActionMode -> React Native.
    // ---------------------------------------------------------------------

    private val selectionCallback = object : BaseActionModeCallback() {
        override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
            selectionModeActive = true
            menu.add(Menu.NONE, MENU_ID_HIGHLIGHT, 0, "하이라이트")
            menu.add(Menu.NONE, MENU_ID_COMMENT, 1, "댓글")
            return true
        }

        override fun onDestroyActionMode(mode: ActionMode) {
            selectionModeActive = false
        }

        override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
            val action = when (item.itemId) {
                MENU_ID_HIGHLIGHT -> "highlight"
                MENU_ID_COMMENT -> "comment"
                else -> return false
            }
            scope.launch {
                val selectable = navigator as? SelectableNavigator ?: return@launch
                val selection = selectable.currentSelection()
                if (selection != null) {
                    val payload = Arguments.createMap().apply {
                        putInt("libraryId", libraryId)
                        putString("action", action)
                        putString("text", selection.locator.text.highlight ?: "")
                        putString("locatorJson", selection.locator.toJSON().toString())
                    }
                    NativeReadiumEvents.send("NativeReadiumHost.textSelected", payload)
                }
                selectable.clearSelection()
            }
            mode.finish()
            return true
        }
    }

    // ---------------------------------------------------------------------
    // Publication opening (mirrors NativeReadiumActivity).
    // ---------------------------------------------------------------------

    private suspend fun openPublication(file: File): Try<OpenedPublication, String> {
        if (!file.exists()) {
            return Try.failure("EPUB file does not exist: ${file.absolutePath}")
        }

        val httpClient = DefaultHttpClient()
        val assetRetriever = AssetRetriever(themedContext.contentResolver, httpClient)
        val retrievedAsset = assetRetriever.retrieve(file).fold(
            onSuccess = { it },
            onFailure = { return Try.failure("Readium could not read the EPUB asset:\n${describeError(it)}") },
        )

        val parser = DefaultPublicationParser(
            themedContext,
            httpClient = httpClient,
            assetRetriever = assetRetriever,
            pdfFactory = null,
        )
        val opener = PublicationOpener(parser)
        val openedPublication = opener.open(retrievedAsset, allowUserInteraction = false).fold(
            onSuccess = { it },
            onFailure = {
                retrievedAsset.close()
                return Try.failure("Readium could not open this EPUB:\n${describeError(it)}")
            },
        )

        return Try.success(OpenedPublication(retrievedAsset, openedPublication))
    }

    // ---------------------------------------------------------------------
    // Events -> React Native.
    // ---------------------------------------------------------------------

    private fun sendOpened(publication: Publication) {
        val toc = JSONArray()
        fun walk(links: List<Link>, depth: Int) {
            links.forEach { link ->
                toc.put(
                    JSONObject()
                        .put("title", link.title?.takeIf { it.isNotBlank() } ?: link.href.toString())
                        .put("href", link.href.toString())
                        .put("depth", depth),
                )
                walk(link.children, depth + 1)
            }
        }
        walk(publication.tableOfContents, 0)

        val payload = Arguments.createMap().apply {
            putInt("libraryId", libraryId)
            putString("title", publication.metadata.title)
            putString("tocJson", toc.toString())
            putBoolean("searchable", publication.isSearchable)
        }
        NativeReadiumEvents.send("NativeReadiumHost.opened", payload)
        sendDebug(
            "view opened \"${publication.metadata.title}\" " +
                "(toc=${publication.tableOfContents.size}, searchable=${publication.isSearchable})",
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

    private fun sendError(message: String) {
        sendDebug("view error: $message")
        val payload = Arguments.createMap().apply {
            putInt("libraryId", libraryId)
            putString("message", message)
        }
        NativeReadiumEvents.send("NativeReadiumHost.error", payload)
    }

    private fun sendDebug(message: String) {
        val payload = Arguments.createMap().apply {
            putInt("libraryId", libraryId)
            putString("message", message)
        }
        NativeReadiumEvents.send("NativeReadiumHost.debug", payload)
    }

    // ---------------------------------------------------------------------
    // EpubNavigatorFragment.Listener
    // ---------------------------------------------------------------------

    override fun onResourceLoadFailed(href: Url, error: ReadError) {
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
            themedContext.currentActivity?.startActivity(
                android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url.toString())),
            )
        }
    }

    // ---------------------------------------------------------------------
    // Teardown.
    // ---------------------------------------------------------------------

    fun dispose() {
        if (disposed) return
        disposed = true
        locationJob?.cancel()
        scope.cancel()
        if (libraryId >= 0) {
            NativeReadiumViewRegistry.unregister(libraryId, this)
        }
        navigator?.let { fragment ->
            val fragmentManager = (themedContext.currentActivity as? FragmentActivity)?.supportFragmentManager
            if (fragmentManager != null && !fragmentManager.isDestroyed) {
                try {
                    fragmentManager.commitNow(allowStateLoss = true) { remove(fragment) }
                } catch (_: Throwable) {
                    // The activity may be tearing down; the fragment dies with it.
                }
            }
        }
        navigator = null
        publication?.close()
        publication = null
        asset?.close()
        asset = null
    }

    // ---------------------------------------------------------------------
    // Parsing helpers (mirroring NativeReadiumActivity).
    // ---------------------------------------------------------------------

    private fun parseSettingsJson(): JSONObject =
        try {
            JSONObject(settingsJson ?: "")
        } catch (_: Exception) {
            JSONObject()
        }

    private fun parseInitialLocator(raw: String?): Locator? {
        val text = raw?.trim().takeUnless { it.isNullOrBlank() } ?: return null
        return try {
            val root = JSONObject(text)
            val locatorObject = root.optJSONObject("locator") ?: root
            Locator.fromJSON(locatorObject)
        } catch (_: Exception) {
            null
        }
    }

    private fun findLinkByHref(publication: Publication, href: String): Link? {
        fun search(links: List<Link>): Link? {
            for (link in links) {
                if (link.href.toString() == href) return link
                search(link.children)?.let { return it }
            }
            return null
        }
        return search(publication.tableOfContents)
            ?: search(publication.readingOrder)
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

    private data class OpenedPublication(
        val asset: Asset,
        val publication: Publication,
    )

    companion object {
        private const val READIUM_LOCATION_VERSION = 4
        private const val MENU_ID_HIGHLIGHT = 0x5241
        private const val MENU_ID_COMMENT = 0x5242
        private const val PULL_THRESHOLD_DP = 80f
        private const val CHAPTER_JUMP_COOLDOWN_MS = 700L
        private const val MAX_ACTIVITY_WAIT_ATTEMPTS = 20
        private const val ACTIVITY_WAIT_INTERVAL_MS = 250L
    }
}
