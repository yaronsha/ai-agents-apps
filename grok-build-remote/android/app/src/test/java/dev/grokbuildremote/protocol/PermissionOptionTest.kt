package dev.grokbuildremote.protocol

import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PermissionOptionTest {
    /** The options real Grok Build 1.0.89 offered for a file edit (same list as the bridge test). */
    private val grokOptions = listOf(
        PermissionOption("allow-always", "Yes, allow edits in ai-agents-apps/ for this session", "allow_always"),
        PermissionOption("allow-once", "Yes", "allow_once"),
        PermissionOption("reject-once", "No, and tell Grok what to do differently", "reject_once"),
        PermissionOption("yolo", "Yes, and don't ask again for anything (always-approve mode)", "allow_once"),
        PermissionOption("reject-always", "Never allow: rm x", "reject_always"),
    )

    private fun request(method: String, options: List<PermissionOption>) =
        PendingRequest(JsonPrimitive(1), method, "t1", "Edit file", "edit", null, options)

    @Test
    fun phoneOffersOnlyOneOffAnswers() {
        val shown = request("session/request_permission", grokOptions).phoneOptions
        assertEquals(listOf("allow-once", "reject-once"), shown.map { it.optionId })
    }

    @Test
    fun alwaysApproveIsRefusedWhateverItsIdOrKind() {
        assertFalse(PermissionOption("opt3", "Yes, and don’t ask again for anything", "allow_once").phoneAllowed)
        assertFalse(PermissionOption("bypass", "Yes", "allow_once").phoneAllowed)
        assertTrue(PermissionOption("allow", "Allow once", "allow_once").phoneAllowed)
    }

    @Test
    fun otherQuestionsHaveNoPhoneOptions() {
        val question = request("x.ai/ask_user_question", listOf(PermissionOption("a", "A", "allow_once")))
        assertTrue(question.phoneOptions.isEmpty())
    }
}
