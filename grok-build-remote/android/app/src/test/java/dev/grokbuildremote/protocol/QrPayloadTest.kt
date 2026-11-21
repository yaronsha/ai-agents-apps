package dev.grokbuildremote.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QrPayloadTest {
    private val fp = "ab".repeat(32)

    @Test
    fun parsesTheBridgeFormat() {
        val p = QrPayload.parse("""{"gbr":1,"addr":"100.64.0.1:7443","fp":"$fp","token":"abcdefghijklmnopqrstuvwxyz"}""")!!
        assertEquals("100.64.0.1:7443", p.addr)
    }

    @Test
    fun rejectsJunk() {
        assertNull(QrPayload.parse("https://example.com"))
        assertNull(QrPayload.parse("""{"gbr":1,"addr":"100.64.0.1:7443","fp":"short","token":"abcdefghijklmnopqrstuvwxyz"}"""))
        assertNull(QrPayload.parse("""{"gbr":2,"addr":"100.64.0.1:7443","fp":"$fp","token":"abcdefghijklmnopqrstuvwxyz"}"""))
        assertNull(QrPayload.parse("""{"gbr":1,"addr":"no port","fp":"$fp","token":"abcdefghijklmnopqrstuvwxyz"}"""))
    }
}
