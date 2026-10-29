package link.latr

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.ColorDrawable
import android.os.Build
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class LauncherIconTest {
    @Test fun installedIconHasMaskSafeForegroundAndThemedLayer() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        assertEquals(R.mipmap.ic_launcher, context.applicationInfo.icon)
        val installed = context.packageManager.getApplicationIcon(context.packageName)
        assertTrue(installed is AdaptiveIconDrawable)
        val adaptive = installed as AdaptiveIconDrawable
        assertNotNull(adaptive.background)
        assertNotNull(adaptive.foreground)

        // Test actual platform rasterization, including the stroke extent, against
        // the mask-safe central 66dp area of the full 108dp foreground layer.
        val foreground = context.getDrawable(R.drawable.ic_launcher_foreground)!!
        val pixels = Bitmap.createBitmap(108, 108, Bitmap.Config.ARGB_8888)
        foreground.setBounds(0, 0, 108, 108)
        foreground.draw(Canvas(pixels))
        var visiblePixels = 0
        for (y in 0 until 108) for (x in 0 until 108) {
            if (Color.alpha(pixels.getPixel(x, y)) > 0) {
                visiblePixels++
                assertTrue("Foreground exceeds safe area at $x,$y", x in 21..86 && y in 21..86)
            }
        }
        assertTrue(visiblePixels > 400)

        val destination = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
            ?: context.getExternalFilesDir("qa")!!.absolutePath
        fun render(name: String, drawable: AdaptiveIconDrawable) {
            val bitmap = Bitmap.createBitmap(432, 432, Bitmap.Config.ARGB_8888)
            drawable.setBounds(0, 0, 432, 432)
            drawable.draw(Canvas(bitmap))
            File(destination).mkdirs()
            File(destination, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        }
        render("android-icon-adaptive.png", adaptive)
        if (Build.VERSION.SDK_INT >= 33) {
            assertNotNull(adaptive.monochrome)
            val light = adaptive.monochrome!!.constantState!!.newDrawable().mutate()
            light.setTint(Color.rgb(31, 67, 53))
            render("android-icon-themed-light.png", AdaptiveIconDrawable(ColorDrawable(Color.rgb(198, 236, 215)), light))
            val dark = adaptive.monochrome!!.constantState!!.newDrawable().mutate()
            dark.setTint(Color.rgb(198, 236, 215))
            render("android-icon-themed-dark.png", AdaptiveIconDrawable(ColorDrawable(Color.rgb(31, 67, 53)), dark))
        }
    }
}
