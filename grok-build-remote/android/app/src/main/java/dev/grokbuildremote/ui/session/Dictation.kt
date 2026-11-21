package dev.grokbuildremote.ui.session

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Dictation into the prompt field. Not a voice mode: you speak, the words land in the text field,
 * you edit and send. Prefers the on-device recognizer so audio stays on the phone; if the chosen
 * language isn't available on-device, the caller asks the user before using the online one.
 */
class Dictation(private val context: Context) {
    private var recognizer: SpeechRecognizer? = null

    interface Callback {
        fun onPartial(text: String)
        fun onFinal(text: String)
        fun onError(message: String)
        /** On-device recognition can't do this language; ask before going online. */
        fun onNeedsOnline(language: String)
    }

    val isAvailable get() = SpeechRecognizer.isRecognitionAvailable(context)

    fun start(language: String, allowOnline: Boolean, cb: Callback, forceOnline: Boolean = false) {
        stop()
        val onDevice = !forceOnline && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        if (!onDevice && !allowOnline) {
            cb.onNeedsOnline(language)
            return
        }
        val r = if (onDevice && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        } else {
            SpeechRecognizer.createSpeechRecognizer(context)
        }
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle?) {
                cb.onFinal(best(results))
                stop()
            }

            override fun onPartialResults(partialResults: Bundle?) {
                best(partialResults).takeIf { it.isNotBlank() }?.let(cb::onPartial)
            }

            override fun onError(error: Int) {
                val languageMissing = error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED ||
                    error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE
                stop()
                if (languageMissing && onDevice && !allowOnline) {
                    cb.onNeedsOnline(language)
                } else if (languageMissing && onDevice) {
                    start(language, allowOnline = true, cb = cb, forceOnline = true)
                } else if (error != SpeechRecognizer.ERROR_NO_MATCH) {
                    cb.onError(describe(error))
                } else {
                    cb.onFinal("")
                }
            }

            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, onDevice)
        r.startListening(intent)
    }

    fun stop() {
        recognizer?.destroy()
        recognizer = null
    }

    private fun best(b: Bundle?): String =
        b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()

    private fun describe(error: Int) = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "Microphone error"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is off"
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition needs the network for this language"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Didn't hear anything"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer is busy"
        else -> "Dictation failed ($error)"
    }
}
