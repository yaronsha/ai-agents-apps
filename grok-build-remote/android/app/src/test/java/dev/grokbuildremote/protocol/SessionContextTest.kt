package dev.grokbuildremote.protocol

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionContextTest {
    @Test
    fun parsesWhatTheBridgeSends() {
        val payload = Json.parseToJsonElement(
            """{"model":"grok-4.7","modelDisplayName":"Grok 4.7","turns":10,"context":{"used":161439,
            "total":256000,"systemPromptTokens":2643,"toolDefinitionsCount":25,"toolDefinitionsTokens":8501,
            "compactionCount":0,"messageCount":265,"messageTokens":141213,"freeTokens":94561,"usagePct":63,
            "autoCompactThresholdPercent":80,"usageCategories":[{"label":"Skills","tokens":3125,"detail":"30 skills"}]}}""",
        )
        val c = SessionContext.parse(payload)!!
        assertEquals("Grok 4.7", c.model)
        assertEquals(63, c.usagePct)
        assertEquals(94561L, c.free)
        assertEquals(80L, c.autoCompactPct)
        assertEquals(
            listOf("System prompt", "Tools", "Messages", "Skills"),
            c.parts.map { it.label },
        )
        assertEquals("25 tools", c.parts[1].detail)
        assertEquals("161k", SessionContext.tokens(161439))
        assertEquals("1.2k", SessionContext.tokens(1200))
    }

    @Test
    fun missingContextIsNull() {
        assertNull(SessionContext.parse(Json.parseToJsonElement("""{"model":"x"}""")))
    }

    @Test
    fun percentIsWorkedOutWhenMissing() {
        val c = SessionContext.parse(Json.parseToJsonElement("""{"context":{"used":64000,"total":256000}}"""))!!
        assertEquals(25, c.usagePct)
    }
}
