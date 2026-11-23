package dev.grokbuildremote.ui.session

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Dictation into the prompt field. Not a voice mode: you speak, the words land in the text field,
 * you edit and send. Prefers the on-device recognizer so audio stays on the phone; if the chosen
 * language isn't available on-device, the caller asks the user before using the online one.
 *
 * It keeps listening through pauses until you tap stop (or after [IDLE_MS] of silence): on
 * Android 13+ as one segmented session, and on older phones (or recognizers that ignore
 * segmenting) by listening again after each sentence. Text arrives live, with punctuation where
 * the recognizer supports it.
 */
class Dictation(private val context: Context) {
    private var recognizer: SpeechRecognizer? = null
    private var session: Session? = null
    private val main = Handler(Looper.getMainLooper())

    interface Callback {
        /** Everything dictated so far in this session, including the words still being heard. */
        fun onText(text: String)
        /** Dictation ended on its own (long silence). */
        fun onStopped()
        fun onError(message: String)
        /** On-device recognition can't do this language; ask before going online. */
        fun onNeedsOnline(language: String)
    }

    private class Session(val language: String, val allowOnline: Boolean, val cb: Callback) {
        var onDevice = false
        val committed = StringBuilder()
        var lastSegment = ""
        var partial = ""
        var lastHeard = SystemClock.elapsedRealtime()

        fun text() = listOf(committed.toString(), partial).filter { it.isNotBlank() }.joinToString(" ")
    }

    val isAvailable get() = SpeechRecognizer.isRecognitionAvailable(context)

    fun start(language: String, allowOnline: Boolean, cb: Callback) {
        stop()
        val onDevice = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        if (!onDevice && !allowOnline) {
            cb.onNeedsOnline(language)
            return
        }
        val s = Session(language, allowOnline, cb)
        session = s
        open(s, onDevice)
    }

    fun stop() {
        session = null
        main.removeCallbacksAndMessages(null)
        recognizer?.destroy()
        recognizer = null
    }

    private fun open(s: Session, onDevice: Boolean) {
        recognizer?.destroy()
        s.onDevice = onDevice
        val r = if (onDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        } else {
            SpeechRecognizer.createSpeechRecognizer(context)
        }
        recognizer = r
        r.setRecognitionListener(listener(s))
        r.startListening(intent(s))
    }

    private fun listener(s: Session) = object : RecognitionListener {
        override fun onPartialResults(partialResults: Bundle?) {
            if (session !== s) return
            val text = best(partialResults)
            if (text.isBlank()) return
            s.partial = text
            s.lastHeard = SystemClock.elapsedRealtime()
            s.cb.onText(s.text())
        }

        override fun onSegmentResults(segmentResults: Bundle) {
            if (session === s) commit(s, best(segmentResults))
        }

        override fun onEndOfSegmentedSession() {
            if (session === s) listenAgainOrFinish(s)
        }

        override fun onResults(results: Bundle?) {
            if (session !== s) return
            commit(s, best(results))
            listenAgainOrFinish(s)
        }

        override fun onError(error: Int) {
            if (session !== s) return
            val languageMissing = error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ||
                error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE
            when {
                // A pause with nothing new: keep listening.
                error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
                    listenAgainOrFinish(s)
                languageMissing && s.onDevice && !s.allowOnline -> {
                    stop()
                    s.cb.onNeedsOnline(s.language)
                }
                languageMissing && s.onDevice -> open(s, onDevice = false)
                else -> {
                    stop()
                    s.cb.onError(describe(error))
                }
            }
        }

        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun commit(s: Session, text: String) {
        s.partial = ""
        if (text.isNotBlank() && text != s.lastSegment) {
            if (s.committed.isNotEmpty()) s.committed.append(' ')
            s.committed.append(text.trim())
            s.lastSegment = text
            s.lastHeard = SystemClock.elapsedRealtime()
        }
        s.cb.onText(s.text())
    }

    private fun listenAgainOrFinish(s: Session) {
        if (SystemClock.elapsedRealtime() - s.lastHeard > IDLE_MS) {
            stop()
            s.cb.onStopped()
            return
        }
        main.post { if (session === s) recognizer?.startListening(intent(s)) }
    }

    private fun intent(s: Session): Intent {
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, s.language)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, s.onDevice)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            i.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY)
            // One session that survives pauses; it ends only after IDLE_MS of silence.
            i.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS)
            i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, IDLE_MS)
        }
        return i
    }

    private fun best(b: Bundle?): String =
        b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()

    private fun describe(error: Int) = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "Microphone error"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is off"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition needs the network for this language"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer is busy"
        else -> "Dictation failed ($error)"
    }

    companion object {
        /** Stop by itself after this much silence, so a forgotten mic doesn't keep listening. */
        const val IDLE_MS = 60_000L
    }
}
