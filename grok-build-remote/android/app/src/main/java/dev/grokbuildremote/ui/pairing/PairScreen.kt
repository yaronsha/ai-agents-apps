package dev.grokbuildremote.ui.pairing

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import dev.grokbuildremote.data.PairState
import dev.grokbuildremote.data.PairingClient
import dev.grokbuildremote.protocol.QrPayload
import dev.grokbuildremote.ui.card
import dev.grokbuildremote.ui.theme.Mono
import dev.grokbuildremote.ui.theme.Palette
import java.util.concurrent.Executors

@Composable
fun PairScreen(pairing: PairingClient, onPaired: () -> Unit) {
    val state by pairing.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var hasCamera by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { hasCamera = it }
    var manual by remember { mutableStateOf("") }
    var manualError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state) { if (state is PairState.Paired) onPaired() }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Text("Pair with your Mac", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = Palette.Text)
        Text(
            "On the Mac, run gbr pair and scan the code it shows. Both devices need to be on Tailscale.",
            fontSize = 14.sp,
            lineHeight = 21.sp,
            color = Palette.Muted,
        )

        when (val s = state) {
            PairState.Idle, is PairState.Failed -> {
                if (s is PairState.Failed) {
                    Text(
                        s.message,
                        color = Palette.Bad,
                        fontSize = 14.sp,
                        modifier = Modifier.fillMaxWidth().card(fill = Palette.Surface, stroke = Palette.BadBorder).padding(14.dp),
                    )
                }
                Box(Modifier.fillMaxWidth().height(300.dp).card(radius = 20.dp, fill = Palette.Code), contentAlignment = Alignment.Center) {
                    if (hasCamera) {
                        QrScanner { text -> QrPayload.parse(text)?.let { pairing.start(it) } }
                    } else {
                        Button(onClick = { cameraPermission.launch(Manifest.permission.CAMERA) }) { Text("Allow camera to scan") }
                    }
                }
                OutlinedTextField(
                    value = manual,
                    onValueChange = { manual = it; manualError = null },
                    label = { Text("Or paste the pairing text") },
                    textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Mono, fontSize = 12.sp),
                    modifier = Modifier.fillMaxWidth(),
                    isError = manualError != null,
                    supportingText = if (manualError != null) {
                        { Text(manualError ?: "") }
                    } else {
                        null
                    },
                )
                OutlinedButton(
                    onClick = {
                        val qr = QrPayload.parse(manual)
                        if (qr == null) manualError = "That isn't a Grok Build Remote pairing code" else pairing.start(qr)
                    },
                    enabled = manual.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Pair") }
            }
            PairState.Connecting -> Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(12.dp))
                Text("Connecting to your Mac…", color = Palette.Text)
            }
            is PairState.ConfirmOnMac -> Column(
                Modifier.fillMaxWidth().card().padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Palette.Good)
                    Spacer(Modifier.width(10.dp))
                    Text("Found your Mac", fontWeight = FontWeight.SemiBold, color = Palette.Text)
                }
                Text("Check that the Mac's terminal shows this code, then type y there:", color = Palette.Muted, fontSize = 13.sp)
                Text(
                    s.code.take(3) + " " + s.code.drop(3),
                    fontFamily = Mono,
                    fontSize = 32.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Palette.Text,
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                )
                Row(verticalAlignment = Alignment.Top) {
                    Icon(Icons.Filled.Lock, contentDescription = null, tint = Palette.Muted, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "This phone's key was created in the Android Keystore. It never leaves the phone.",
                        color = Palette.Muted,
                        fontSize = 12.sp,
                    )
                }
                TextButton(onClick = { pairing.cancel() }) { Text("Codes don't match · cancel") }
            }
            PairState.Paired -> Text("Paired.", color = Palette.Good)
        }
    }
}

@Composable
private fun QrScanner(onText: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember {
        BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build())
    }
    var found by remember { mutableStateOf(false) }

    DisposableEffect(Unit) {
        onDispose {
            scanner.close()
            executor.shutdown()
            runCatching { ProcessCameraProvider.getInstance(context).get().unbindAll() }
        }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            val view = PreviewView(ctx)
            val providerFuture = ProcessCameraProvider.getInstance(ctx)
            providerFuture.addListener({
                val provider = providerFuture.get()
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(view.surfaceProvider) }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(executor) { proxy ->
                    analyze(scanner, proxy) { text ->
                        if (!found && QrPayload.parse(text) != null) {
                            found = true
                            ContextCompat.getMainExecutor(ctx).execute { onText(text) }
                        }
                    }
                }
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            }, ContextCompat.getMainExecutor(ctx))
            view
        },
    )
}

@androidx.annotation.OptIn(ExperimentalGetImage::class)
private fun analyze(scanner: BarcodeScanner, proxy: ImageProxy, onText: (String) -> Unit) {
    val media = proxy.image
    if (media == null) {
        proxy.close()
        return
    }
    val input = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
    scanner.process(input)
        .addOnSuccessListener { codes -> codes.firstNotNullOfOrNull { it.rawValue }?.let(onText) }
        .addOnCompleteListener { proxy.close() }
}
