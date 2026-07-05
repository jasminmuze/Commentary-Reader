package {{PACKAGE_NAME}}.readiumhost

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

internal object NativeReadiumEvents {
    private var reactContext: ReactApplicationContext? = null

    fun attach(context: ReactApplicationContext) {
        reactContext = context
    }

    fun detach(context: ReactApplicationContext) {
        if (reactContext === context) {
            reactContext = null
        }
    }

    fun send(name: String, payload: WritableMap = Arguments.createMap()) {
        reactContext
            ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit(name, payload)
    }
}
