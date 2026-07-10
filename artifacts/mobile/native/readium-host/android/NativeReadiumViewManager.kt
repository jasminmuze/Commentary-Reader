package {{PACKAGE_NAME}}.readiumhost

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class NativeReadiumViewManager : SimpleViewManager<NativeReadiumView>() {

    override fun getName(): String = REACT_CLASS

    override fun createViewInstance(reactContext: ThemedReactContext): NativeReadiumView =
        NativeReadiumView(reactContext)

    @ReactProp(name = "libraryId", defaultInt = -1)
    fun setLibraryId(view: NativeReadiumView, value: Int) {
        view.libraryId = value
    }

    @ReactProp(name = "filePath")
    fun setFilePath(view: NativeReadiumView, value: String?) {
        view.filePath = value
    }

    @ReactProp(name = "locatorJson")
    fun setLocatorJson(view: NativeReadiumView, value: String?) {
        view.locatorJson = value
    }

    @ReactProp(name = "settingsJson")
    fun setSettingsJson(view: NativeReadiumView, value: String?) {
        view.settingsJson = value
    }

    override fun onAfterUpdateTransaction(view: NativeReadiumView) {
        super.onAfterUpdateTransaction(view)
        view.maybeOpen()
    }

    override fun onDropViewInstance(view: NativeReadiumView) {
        super.onDropViewInstance(view)
        view.dispose()
    }

    companion object {
        const val REACT_CLASS = "NativeReadiumView"
    }
}
