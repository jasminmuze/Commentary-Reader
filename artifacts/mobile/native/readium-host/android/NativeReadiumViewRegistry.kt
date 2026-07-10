package {{PACKAGE_NAME}}.readiumhost

/**
 * Maps libraryId -> the currently mounted [NativeReadiumView], so module
 * commands (submitPreferences, applyDecorations, ...) can find their target.
 */
internal object NativeReadiumViewRegistry {
    private val views = mutableMapOf<Int, NativeReadiumView>()

    fun register(libraryId: Int, view: NativeReadiumView) {
        views[libraryId] = view
    }

    fun unregister(libraryId: Int, view: NativeReadiumView) {
        if (views[libraryId] === view) {
            views.remove(libraryId)
        }
    }

    fun get(libraryId: Int): NativeReadiumView? = views[libraryId]
}
