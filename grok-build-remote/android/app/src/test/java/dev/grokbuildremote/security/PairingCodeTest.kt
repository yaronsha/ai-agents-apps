package dev.grokbuildremote.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class PairingCodeTest {
    @Test
    fun matchesTheBridge() {
        // Same vector as bridge/src/pairing.rs `code_is_six_digits_and_depends_on_both_keys`.
        assertEquals("829775", PairingCode.compute("aa", "bb"))
    }

    @Test
    fun dependsOnBothKeys() {
        assertNotEquals(PairingCode.compute("s", "a"), PairingCode.compute("s", "b"))
    }

    @Test
    fun fingerprintIsLowercaseHexSha256() {
        assertEquals(
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            PairingCode.fingerprint("hello".toByteArray()),
        )
        assertEquals("2CF2 4DBA", PairingCode.display("2cf24dba"))
    }
}
