package dev.grokbuildremote.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EnvelopeTest {
    @Test
    fun encodesLikeTheBridge() {
        assertEquals("""{"v":1,"type":"ping"}""", Wire.encode(Envelope(type = Types.PING)))
    }

    @Test
    fun decodesAcpAndIgnoresUnknownFields() {
        val e = Wire.decode("""{"v":1,"type":"acp","sid":"s1","seq":7,"payload":"{}","extra":true}""")!!
        assertEquals("s1", e.sid)
        assertEquals(7L, e.seq)
    }

    @Test
    fun rejectsOtherVersions() {
        assertNull(Wire.decode("""{"v":2,"type":"hello"}"""))
        assertNull(Wire.decode("nope"))
    }

    @Test
    fun readsPayloadStrings() {
        val e = Wire.decode("""{"v":1,"type":"error","payload":{"code":"refused","message":"no"}}""")!!
        assertEquals("refused", e.payloadString("code"))
    }
}
