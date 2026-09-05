/**
 * Full-screen invoice-capture camera with a motion-gated shutter.
 *
 * Problem: the previous capture path was a plain HTML `<input type="file"
 * capture="environment">` in the web PWA, which hands off entirely to the
 * OS's own camera app — there is no way to read device motion or influence
 * *when* the shutter fires from inside a WebView for that flow. This screen
 * replaces it (native-shell only; the plain-browser PWA still uses the file
 * input unchanged) with our own camera view so we can gate the shutter on
 * device motion, directly targeting the actual failure mode motion causes:
 * a blurry invoice photo that wastes a Gemini OCR round trip.
 *
 * Motion signal: expo-sensors' DeviceMotion, which is Android's fused sensor
 * output (accelerometer + gyroscope combined, gravity already subtracted
 * from `acceleration`) rather than two raw sensors we'd have to fuse
 * ourselves — both translational jitter (`acceleration`) and rotational
 * jitter (`rotationRate`) have to be low at once for a frame to count as
 * "steady", since either alone can blur a close-up shot of a piece of paper.
 *
 * Thresholds below are a first pass, not a measured calibration — they were
 * picked to *feel* right in a few seconds of handheld testing on the iQOO 15
 * this was built against, not derived from a blur-vs-motion dataset. Treat
 * them as the first thing to tune if real invoice scans show they're too
 * strict (never goes steady) or too loose (still blurry captures).
 */

import { CameraView, useCameraPermissions } from 'expo-camera'
import { DeviceMotion } from 'expo-sensors'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

// Rotation rate (deg/s) and linear acceleration (m/s^2) must both be under
// these for a sample to count as "steady". Both signals matter: rotation
// alone misses translational shake (moving the phone sideways without
// tilting it), acceleration alone misses tilt/rotation blur.
const ROTATION_THRESHOLD_DEG_PER_S = 12
const ACCELERATION_THRESHOLD_MS2 = 0.3
// How long the signal must stay under both thresholds, continuously,
// before auto-capture fires -- long enough to filter out a momentary dip
// between shakes, short enough not to feel like a hang.
const STEADY_HOLD_MS = 500
const SAMPLE_INTERVAL_MS = 50

export type SteadyCameraCaptureProps = {
  onCaptured: (base64: string, mimeType: string) => void
  onCancel: () => void
}

export default function SteadyCameraCapture({ onCaptured, onCancel }: SteadyCameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)
  const [steady, setSteady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const steadySinceRef = useRef<number | null>(null)
  const capturingRef = useRef(false)

  const capture = useCallback(async () => {
    if (capturingRef.current) return
    capturingRef.current = true
    setCapturing(true)
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        base64: true,
        quality: 0.85,
        skipProcessing: true,
      })
      if (photo?.base64) {
        onCaptured(photo.base64, 'image/jpeg')
        return
      }
    } catch {
      // Fall through to re-arm below -- a failed capture (e.g. camera
      // hiccup) shouldn't strand the trader on a screen that can never
      // trigger again.
    }
    capturingRef.current = false
    setCapturing(false)
  }, [onCaptured])

  useEffect(() => {
    if (!permission?.granted) return

    DeviceMotion.setUpdateInterval(SAMPLE_INTERVAL_MS)
    const subscription = DeviceMotion.addListener((data) => {
      const rotation = data.rotationRate
      const acceleration = data.acceleration
      // Either reading can be null on a device/OS combo without the fused
      // sensor -- treat "no data" as "not steady" rather than guessing.
      if (!rotation || !acceleration) {
        steadySinceRef.current = null
        setSteady(false)
        return
      }

      const rotationMagnitude = Math.sqrt(
        rotation.alpha * rotation.alpha + rotation.beta * rotation.beta + rotation.gamma * rotation.gamma,
      )
      const accelerationMagnitude = Math.sqrt(
        acceleration.x * acceleration.x + acceleration.y * acceleration.y + acceleration.z * acceleration.z,
      )
      const isSteadyNow =
        rotationMagnitude < ROTATION_THRESHOLD_DEG_PER_S && accelerationMagnitude < ACCELERATION_THRESHOLD_MS2

      const now = Date.now()
      if (!isSteadyNow) {
        steadySinceRef.current = null
        setSteady(false)
        return
      }

      if (steadySinceRef.current === null) steadySinceRef.current = now
      const heldFor = now - steadySinceRef.current
      setSteady(heldFor >= STEADY_HOLD_MS)
      if (heldFor >= STEADY_HOLD_MS) capture()
    })

    return () => subscription.remove()
  }, [permission?.granted, capture])

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    )
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Camera access is needed to scan invoices.</Text>
        <Pressable onPress={requestPermission} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Grant camera access</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.textButton}>
          <Text style={styles.textButtonText}>Cancel</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.overlay} pointerEvents="box-none">
        <Pressable onPress={onCancel} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </Pressable>

        <View style={styles.bottomBar}>
          <View style={[styles.statusPill, steady ? styles.statusPillSteady : styles.statusPillUnsteady]}>
            <Text style={styles.statusText}>
              {capturing ? 'Capturing…' : steady ? 'Steady — capturing…' : 'Hold steady…'}
            </Text>
          </View>
          <Pressable onPress={capture} style={styles.manualButton} disabled={capturing}>
            <Text style={styles.manualButtonText}>{capturing ? '…' : 'Capture now'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  permissionText: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  primaryButtonText: {
    color: '#000',
    fontWeight: 'bold',
  },
  textButton: {
    marginTop: 16,
  },
  textButtonText: {
    color: '#aaa',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  closeButton: {
    alignSelf: 'flex-end',
    margin: 20,
    marginTop: 48,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  bottomBar: {
    alignItems: 'center',
    paddingBottom: 36,
    gap: 12,
  },
  statusPill: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 20,
  },
  statusPillSteady: {
    backgroundColor: 'rgba(52, 199, 89, 0.9)',
  },
  statusPillUnsteady: {
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  statusText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  manualButton: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 26,
  },
  manualButtonText: {
    color: '#000',
    fontWeight: 'bold',
  },
})
