package {{PACKAGE_NAME}}.readiumhost

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil

class NativeReadiumModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "NativeReadiumHost"

    override fun initialize() {
        super.initialize()
        NativeReadiumEvents.attach(reactContext)
    }

    override fun invalidate() {
        NativeReadiumEvents.detach(reactContext)
        super.invalidate()
    }

    @ReactMethod
    fun openReader(options: ReadableMap, promise: Promise) {
        val activity: Activity = reactContext.currentActivity
            ?: return promise.reject("NO_ACTIVITY", "No active Android activity is available.")

        val libraryId = options.getInt("libraryId")
        val filePath = options.getString("filePath")
            ?: return promise.reject("NO_FILE", "No EPUB file path was provided.")

        val intent = Intent(activity, NativeReadiumActivity::class.java).apply {
            putExtra(NativeReadiumActivity.EXTRA_LIBRARY_ID, libraryId)
            putExtra(NativeReadiumActivity.EXTRA_FILE_PATH, filePath)
            putExtra(NativeReadiumActivity.EXTRA_LOCATOR_JSON, options.optionalString("locatorJson"))
            putExtra(NativeReadiumActivity.EXTRA_SETTINGS_JSON, options.optionalString("settingsJson"))
            putExtra(NativeReadiumActivity.EXTRA_TITLE, options.optionalString("title"))
        }

        activity.startActivity(intent)
        promise.resolve(null)
    }

    // -----------------------------------------------------------------
    // Commands targeting an embedded NativeReadiumView (by libraryId).
    // All view/navigator access must happen on the UI thread.
    // -----------------------------------------------------------------

    @ReactMethod
    fun submitPreferences(libraryId: Int, settingsJson: String, promise: Promise) {
        withView(libraryId, promise) { it.submitPreferences(settingsJson, promise) }
    }

    @ReactMethod
    fun goToLocator(libraryId: Int, locatorJson: String, promise: Promise) {
        withView(libraryId, promise) { it.goToLocator(locatorJson, promise) }
    }

    @ReactMethod
    fun goToHref(libraryId: Int, href: String, promise: Promise) {
        withView(libraryId, promise) { it.goToHref(href, promise) }
    }

    @ReactMethod
    fun applyDecorations(libraryId: Int, group: String, decorationsJson: String, promise: Promise) {
        withView(libraryId, promise) { it.applyDecorations(group, decorationsJson, promise) }
    }

    @ReactMethod
    fun clearSelection(libraryId: Int) {
        UiThreadUtil.runOnUiThread {
            NativeReadiumViewRegistry.get(libraryId)?.clearSelection()
        }
    }

    @ReactMethod
    fun findQuoteLocators(libraryId: Int, requestsJson: String, promise: Promise) {
        withView(libraryId, promise) { it.findQuoteLocators(requestsJson, promise) }
    }

    private inline fun withView(
        libraryId: Int,
        promise: Promise,
        crossinline block: (NativeReadiumView) -> Unit,
    ) {
        UiThreadUtil.runOnUiThread {
            val view = NativeReadiumViewRegistry.get(libraryId)
            if (view == null) {
                promise.reject("NO_VIEW", "No active reader view for library $libraryId.")
            } else {
                block(view)
            }
        }
    }
}

private fun ReadableMap.optionalString(key: String): String? =
    if (hasKey(key) && !isNull(key)) getString(key) else null
