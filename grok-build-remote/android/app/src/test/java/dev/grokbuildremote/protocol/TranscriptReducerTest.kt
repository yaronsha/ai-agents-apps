package dev.grokbuildremote.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TranscriptReducerTest {
    private fun apply(state: SessionState, vararg raw: String) =
        raw.fold(state) { s, r -> TranscriptReducer.apply(s, parseAcp(r)!!) }

    private fun update(u: String) =
        """{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":$u}}"""

    @Test
    fun mergesStreamedChunks() {
        val s = apply(
            SessionState("s1"),
            update("""{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"Add retries"}}"""),
            update("""{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Looking "}}"""),
            update("""{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"now."}}"""),
        )
        assertEquals(2, s.items.size)
        assertEquals("Looking now.", (s.items[1] as AgentText).text)
    }

    @Test
    fun toolCallsUpdateInPlaceWithDiffs() {
        val s = apply(
            SessionState("s1"),
            update("""{"sessionUpdate":"tool_call","toolCallId":"t1","title":"Edit src/a.ts","kind":"edit","status":"pending"}"""),
            update("""{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"x"}}"""),
            update("""{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"completed",
                "content":[{"type":"diff","path":"src/a.ts","oldText":"a","newText":"b"}]}"""),
        )
        val t = s.items[0] as ToolCall
        assertEquals("completed", t.status)
        assertEquals("Edit src/a.ts", t.title)
        assertEquals("src/a.ts", t.diffs.single().path)
    }

    @Test
    fun planReplacesItself() {
        val s = apply(
            SessionState("s1"),
            update("""{"sessionUpdate":"plan","entries":[{"content":"A","status":"pending"}]}"""),
            update("""{"sessionUpdate":"plan","entries":[{"content":"A","status":"completed"},{"content":"B","status":"in_progress"}]}"""),
        )
        val plan = s.items.single() as PlanItem
        assertEquals(listOf("completed", "in_progress"), plan.entries.map { it.status })
    }

    @Test
    fun permissionRequestOpensAndClosesWhenAnsweredElsewhere() {
        var s = apply(
            SessionState("s1"),
            update("""{"sessionUpdate":"tool_call","toolCallId":"t9","title":"git push","kind":"execute","status":"pending"}"""),
            """{"jsonrpc":"2.0","id":100,"method":"session/request_permission","params":{"sessionId":"s1",
              "toolCall":{"toolCallId":"t9","title":"git push","kind":"execute","rawInput":{"command":["git","push"]}},
              "options":[{"optionId":"allow","name":"Allow once","kind":"allow_once"},{"optionId":"no","name":"Reject","kind":"reject_once"}]}}""",
        )
        assertNotNull(s.pending)
        val p = s.pending!!
        assertEquals("git push", p.command)
        assertEquals(2, p.options.size)
        assertTrue(p.isPermission)

        // The terminal answered first: the tool starts running, so the sheet closes.
        s = apply(s, update("""{"sessionUpdate":"tool_call_update","toolCallId":"t9","status":"in_progress"}"""))
        assertNull(s.pending)
    }

    @Test
    fun ownPromptIsNotDuplicatedByTheEcho() {
        var s = SessionState("s1").withOwnPrompt(5, "push it")
        assertTrue(s.running)
        s = apply(
            s,
            update("""{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"push "}}"""),
            update("""{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"it"}}"""),
        )
        assertEquals(1, s.items.size)
        s = apply(s, """{"jsonrpc":"2.0","id":5,"result":{"stopReason":"end_turn"}}""")
        assertFalse(s.running)
    }

    @Test
    fun ignoresUnknownUpdates() {
        val s = apply(SessionState("s1"), update("""{"sessionUpdate":"x.ai/something_new","foo":1}"""))
        assertTrue(s.items.isEmpty())
    }
}
