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
 *
 * This screen also tags the capture with a coarse GPS fix (best-effort,
 * same philosophy as the motion gate: it never blocks or delays a capture).
 * That backs a soft "scan location anomaly" signal in
 * backend/app/api/webhook.py -- the geographic counterpart to fraud.py's
 * Benford's-law/velocity signals nobody runs manually at a ₹1,000/month CA
 * retainer. Location is requested once on mount, in parallel with the
 * camera, so a fix is usually ready well before the steady-hold gate fires;
 * if it isn't (permission denied, GPS off, no fix yet), the capture
 * proceeds with no coordinates at all.
 *
 * Guide frame + zoom + review, added in a later pass: the corner-bracket
 * rectangle drawn on screen is a FIXED guide region ("put the invoice
 * roughly here"), not a computer-vision-detected document boundary -- this
 * screen does no edge/contour detection at all, and claiming it did would
 * be dishonest. What's real: on a successful steady-hold capture, the whole
 * camera view zooms toward that guide rectangle while its corner brackets
 * brighten, a haptic fires, and the captured photo lands on a review screen
 * with Retake/Use buttons instead of being sent onward immediately -- the
 * trader gets to see and reject a bad photo before it costs an OCR round
 * trip, same reasoning as the motion gate itself.
 */

import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Haptics from 'expo-haptics'
import * as Location from 'expo-location'
import { DeviceMotion } from 'expo-sensors'
import { useAudioPlayer } from 'expo-audio'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { setPendingCaptureLocation } from '../modules/bridge'

// Original, synthesized sine-wave chime (see the generating script in this
// commit's message/history, not a sourced/licensed sound file) -- a short,
// bright upward tick distinct from the frontend's own separate "verified"
// chime (frontend/public/verified-chime.wav), so the two are never confused.
const CAPTURE_CHIME = require('../assets/capture-chime.wav')

// Rotation rate (deg/s) and linear acceleration (m/s^2) must both be under
// these for a sample to count as "steady". Both signals matter: rotation
// alone misses translational shake (moving the phone sideways without
// tilting it), acceleration alone misses tilt/rotation blur.
const ROTATION_THRESHOLD_DEG_PER_S = 12
const ACCELERATION_THRESHOLD_MS2 = 0.3
// The motion gate only ever asks "is the phone physically still right now"
// -- it has no idea what's actually in frame, because this screen does no
// image/document detection at all (see the file header). A real-device test
// showed the honest consequence of that: leaving the phone resting on a
// table auto-"captured" whatever the lens happened to be pointed at (a
// watch, the tabletop) the moment the screen opened, since a motionless
// phone is trivially "steady" from frame one. This threshold requires at
// least one sample of real, deliberate motion -- clearly above sensor
// noise while sitting still -- before the steady-gate is even evaluated,
// so a phone that was already motionless when the screen opened can't
// auto-capture until it's actually been picked up and pointed somewhere.
// It doesn't know THAT "somewhere" is an invoice either -- no threshold on
// this signal alone can -- but it does close the specific failure mode
// observed: capturing before the trader ever moved the phone at all.
const MOVEMENT_ARM_THRESHOLD_MS2 = 1.5
// How long the signal must stay under both thresholds, continuously,
// before auto-capture fires -- long enough to filter out a momentary dip
// between shakes, short enough not to feel like a hang.
const STEADY_HOLD_MS = 500
const SAMPLE_INTERVAL_MS = 50
// How long the zoom-toward-the-guide-frame animation runs before the photo
// (already taken) is shown on the review screen -- long enough to read as
// a deliberate "locking on" moment, short enough not to feel laggy.
const ZOOM_ANIMATION_MS = 380

// Hinglish (Roman script) for Hindi, native script for Marathi/Gujarati --
// matches the convention backend/app/api/dashboard.py's own
// _get_fix_action()/_get_issue_label() already use for the same four
// languages. Best-effort phrasing, not reviewed by a native speaker of all
// four -- same honesty caveat as anything else translated by this codebase
// without native review.
type CaptureStrings = {
  holdSteady: string
  steadyCapturing: string
  capturing: string
  captureNow: string
  cameraNeeded: string
  grantAccess: string
  cancel: string
  retake: string
  usePhoto: string
  reviewTitle: string
}

const STRINGS: Record<string, CaptureStrings> = {
  en: {
    holdSteady: 'Hold steady…',
    steadyCapturing: 'Steady — capturing…',
    capturing: 'Capturing…',
    captureNow: 'Capture now',
    cameraNeeded: 'Camera access is needed to scan invoices.',
    grantAccess: 'Grant camera access',
    cancel: 'Cancel',
    retake: 'Retake',
    usePhoto: 'Use this photo',
    reviewTitle: 'Look good?',
  },
  hi: {
    holdSteady: 'Phone sthir rakhein…',
    steadyCapturing: 'Sthir hai — capture ho raha hai…',
    capturing: 'Capture ho raha hai…',
    captureNow: 'Abhi capture karein',
    cameraNeeded: 'Invoice scan karne ke liye camera access chahiye.',
    grantAccess: 'Camera access dein',
    cancel: 'Cancel karein',
    retake: 'Dobara kheenchein',
    usePhoto: 'Yeh photo istemal karein',
    reviewTitle: 'Sahi lag raha hai?',
  },
  mr: {
    holdSteady: 'फोन स्थिर धरा…',
    steadyCapturing: 'स्थिर आहे — कॅप्चर होत आहे…',
    capturing: 'कॅप्चर होत आहे…',
    captureNow: 'आत्ता कॅप्चर करा',
    cameraNeeded: 'इनव्हॉइस स्कॅन करण्यासाठी कॅमेरा अ‍ॅक्सेस आवश्यक आहे.',
    grantAccess: 'कॅमेरा अ‍ॅक्सेस द्या',
    cancel: 'रद्द करा',
    retake: 'पुन्हा घ्या',
    usePhoto: 'हा फोटो वापरा',
    reviewTitle: 'व्यवस्थित दिसतंय का?',
  },
  gu: {
    holdSteady: 'ફોન સ્થિર રાખો…',
    steadyCapturing: 'સ્થિર છે — કેપ્ચર થઈ રહ્યું છે…',
    capturing: 'કેપ્ચર થઈ રહ્યું છે…',
    captureNow: 'હમણાં કેપ્ચર કરો',
    cameraNeeded: 'ઇનવોઇસ સ્કેન કરવા માટે કેમેરા એક્સેસ જરૂરી છે.',
    grantAccess: 'કેમેરા એક્સેસ આપો',
    cancel: 'રદ કરો',
    retake: 'ફરીથી લો',
    usePhoto: 'આ ફોટો વાપરો',
    reviewTitle: 'બરાબર લાગે છે?',
  },
}

function getStrings(lang?: string): CaptureStrings {
  return STRINGS[lang || 'hi'] || STRINGS.hi
}

export type SteadyCameraCaptureProps = {
  onCaptured: (base64: string, mimeType: string) => void
  onCancel: () => void
  // Trader's language_pref, forwarded through the bridge from
  // trader/page.js -- controls only this screen's own fixed strings, see
  // this file's header. Defaults to Hindi if not provided.
  lang?: string
}

type CapturedPhoto = { base64: string; mimeType: string }

export default function SteadyCameraCapture({ onCaptured, onCancel, lang }: SteadyCameraCaptureProps) {
  const strings = getStrings(lang)
  const chimePlayer = useAudioPlayer(CAPTURE_CHIME)
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView>(null)
  const [steady, setSteady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [reviewPhoto, setReviewPhoto] = useState<CapturedPhoto | null>(null)
  const steadySinceRef = useRef<number | null>(null)
  const capturingRef = useRef(false)
  // See MOVEMENT_ARM_THRESHOLD_MS2's comment -- false until the phone has
  // shown real motion since this screen (re)armed, so a phone that was
  // already resting motionless can't immediately "steady" on whatever it
  // happens to be pointed at.
  const hasMovedRef = useRef(false)
  // Whatever the best-effort location request below has resolved by the
  // time a capture actually fires -- null until (if ever) a fix arrives.
  const locationRef = useRef<{ latitude: number; longitude: number } | null>(null)

  // Drives both the camera-container zoom and the guide-frame's "lock on"
  // brighten/tighten effect from one shared value -- 0 = resting state
  // (guide frame visible but dim), 1 = fully zoomed/locked at the moment
  // the photo is taken.
  const zoomAnim = useRef(new Animated.Value(0)).current

  const capture = useCallback(async () => {
    if (capturingRef.current) return
    capturingRef.current = true
    setCapturing(true)

    // Fires the instant we commit to capturing, not after the photo/zoom
    // finish -- a capture confirmation should feel immediate, not delayed
    // behind an animation or the camera hardware's own shutter latency.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {
      // No haptics hardware/permission -- never block a capture over it.
    })
    try {
      chimePlayer.seekTo(0)
      chimePlayer.play()
    } catch {
      // Never let a sound-effect failure block an actual capture.
    }

    const zoomIn = new Promise<void>((resolve) => {
      Animated.timing(zoomAnim, {
        toValue: 1,
        duration: ZOOM_ANIMATION_MS,
        useNativeDriver: true,
      }).start(() => resolve())
    })

    try {
      const [photo] = await Promise.all([
        cameraRef.current?.takePictureAsync({
          base64: true,
          quality: 0.85,
          skipProcessing: true,
        }),
        zoomIn,
      ])
      if (photo?.base64) {
        // Handed off through the bridge module rather than as extra
        // onCaptured args App.tsx would need to forward -- see
        // setPendingCaptureLocation's own comment in modules/bridge.ts.
        // Captured here (at the moment of taking the photo) even though
        // onCaptured() itself doesn't fire until the trader confirms on
        // the review screen below -- the GPS fix belongs to this exact
        // shutter moment, not to whenever "Use this photo" gets tapped.
        setPendingCaptureLocation(locationRef.current)
        setReviewPhoto({ base64: photo.base64, mimeType: 'image/jpeg' })
        return
      }
    } catch {
      // Fall through to re-arm below -- a failed capture (e.g. camera
      // hiccup) shouldn't strand the trader on a screen that can never
      // trigger again.
    }
    // Only reached on failure -- re-arm without ever having shown a review
    // screen. The success path re-arms in handleRetake() instead, once the
    // trader actually asks to try again.
    zoomAnim.setValue(0)
    capturingRef.current = false
    setCapturing(false)
  }, [zoomAnim, chimePlayer])

  const handleRetake = useCallback(() => {
    setReviewPhoto(null)
    zoomAnim.setValue(0)
    steadySinceRef.current = null
    capturingRef.current = false
    // Re-arm the movement gate too -- otherwise a phone that hasn't moved
    // since the first (bad) capture would immediately re-trigger on
    // whatever it's still pointed at, defeating the point of Retake.
    hasMovedRef.current = false
    setCapturing(false)
    setSteady(false)
  }, [zoomAnim])

  const handleUsePhoto = useCallback(() => {
    if (reviewPhoto) onCaptured(reviewPhoto.base64, reviewPhoto.mimeType)
  }, [reviewPhoto, onCaptured])

  // Best-effort, one-shot: fire as soon as this screen mounts so a fix has
  // the whole steady-hold window (and then some) to resolve, rather than
  // waiting until the shutter is about to fire and adding latency to the
  // capture itself. Denied permission, GPS off, or a fix that just never
  // arrives all leave locationRef.current at null -- capture() above
  // already treats that as "no location" rather than waiting on it.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted' || cancelled) return
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low })
        if (!cancelled) {
          locationRef.current = { latitude: position.coords.latitude, longitude: position.coords.longitude }
        }
      } catch {
        // No GPS hardware/permission/services -- proceed without a
        // location tag, same as any other best-effort signal on this screen.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!permission?.granted || reviewPhoto) return

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

      if (!hasMovedRef.current) {
        if (accelerationMagnitude > MOVEMENT_ARM_THRESHOLD_MS2) {
          hasMovedRef.current = true
        } else {
          steadySinceRef.current = null
          setSteady(false)
          return
        }
      }

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
  }, [permission?.granted, capture, reviewPhoto])

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
        <Text style={styles.permissionText}>{strings.cameraNeeded}</Text>
        <Pressable onPress={requestPermission} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{strings.grantAccess}</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.textButton}>
          <Text style={styles.textButtonText}>{strings.cancel}</Text>
        </Pressable>
      </View>
    )
  }

  // Zooms the whole camera view in toward the guide frame's center on
  // capture -- a plain scale transform on the CameraView's container, not a
  // real optical/digital crop of what's being recorded (takePictureAsync
  // above already ran by the time this finishes, using the camera's normal
  // full frame).
  const cameraScale = zoomAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] })
  // Corner brackets brighten and pull slightly outward as they "lock on".
  const bracketOpacity = zoomAnim.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] })
  const bracketColor = steady || capturing ? '#34C759' : '#ffffff'

  // CameraView is mounted exactly once for this whole screen's lifetime --
  // it used to live inside an `if (reviewPhoto) return (...)` branch that
  // rendered a completely different tree without it, so accepting a photo
  // and then retaking unmounted and remounted the camera. A real-device
  // test showed that reliably left the preview blank (a known category of
  // flakiness re-acquiring Android camera hardware right after releasing
  // it). The review UI is now just an overlay drawn on top of the still-
  // running camera, toggled with `reviewPhoto`, never touching CameraView's
  // own mount state.
  return (
    <View style={styles.container}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: cameraScale }] }]}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      </Animated.View>

      {reviewPhoto ? (
        <Image
          source={{ uri: `data:${reviewPhoto.mimeType};base64,${reviewPhoto.base64}` }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
        />
      ) : null}

      <View style={styles.overlay} pointerEvents="box-none">
        <Pressable onPress={onCancel} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </Pressable>

        {!reviewPhoto && (
          <>
            {/* Fixed guide rectangle -- "put the invoice roughly here", not
                a detected document boundary. Four independent corner
                brackets (two short bars each) rather than a full border,
                matching the scanner-app convention of marking corners
                only. */}
            <View style={styles.guideFrame} pointerEvents="none">
              <Animated.View style={[styles.corner, styles.cornerTopLeft, { opacity: bracketOpacity, borderColor: bracketColor }]} />
              <Animated.View style={[styles.corner, styles.cornerTopRight, { opacity: bracketOpacity, borderColor: bracketColor }]} />
              <Animated.View style={[styles.corner, styles.cornerBottomLeft, { opacity: bracketOpacity, borderColor: bracketColor }]} />
              <Animated.View style={[styles.corner, styles.cornerBottomRight, { opacity: bracketOpacity, borderColor: bracketColor }]} />
            </View>

            <View style={styles.bottomBar}>
              <View style={[styles.statusPill, steady ? styles.statusPillSteady : styles.statusPillUnsteady]}>
                <Text style={styles.statusText}>
                  {capturing ? strings.capturing : steady ? strings.steadyCapturing : strings.holdSteady}
                </Text>
              </View>
              <Pressable onPress={capture} style={styles.manualButton} disabled={capturing}>
                <Text style={styles.manualButtonText}>{capturing ? '…' : strings.captureNow}</Text>
              </Pressable>
            </View>
          </>
        )}

        {reviewPhoto && (
          <View style={styles.reviewOverlay} pointerEvents="box-none">
            <Text style={styles.reviewTitle}>{strings.reviewTitle}</Text>
            <View style={styles.reviewButtonRow}>
              <Pressable onPress={handleRetake} style={styles.reviewButtonSecondary}>
                <Text style={styles.reviewButtonSecondaryText}>{strings.retake}</Text>
              </Pressable>
              <Pressable onPress={handleUsePhoto} style={styles.reviewButtonPrimary}>
                <Text style={styles.reviewButtonPrimaryText}>{strings.usePhoto}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </View>
  )
}

const CORNER_SIZE = 32
const CORNER_THICKNESS = 4

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
    ...StyleSheet.absoluteFill,
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
  // Guide frame: an inset rectangle (80% width, tall aspect for a portrait
  // invoice) centered on screen, with only its four corners drawn.
  guideFrame: {
    position: 'absolute',
    top: '18%',
    bottom: '28%',
    left: '10%',
    right: '10%',
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderLeftWidth: CORNER_THICKNESS,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_THICKNESS,
    borderRightWidth: CORNER_THICKNESS,
  },
  bottomBar: {
    alignItems: 'center',
    paddingBottom: 36,
    gap: 12,
  },
  // Bigger and bolder than before -- this was flagged as too easy to miss.
  statusPill: {
    paddingVertical: 12,
    paddingHorizontal: 26,
    borderRadius: 24,
  },
  statusPillSteady: {
    backgroundColor: 'rgba(52, 199, 89, 0.95)',
  },
  statusPillUnsteady: {
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  statusText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
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
  reviewOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  reviewTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 6,
  },
  reviewButtonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  reviewButtonSecondary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
  },
  reviewButtonSecondaryText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  reviewButtonPrimary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 26,
    backgroundColor: '#34C759',
    alignItems: 'center',
  },
  reviewButtonPrimaryText: {
    color: '#000',
    fontWeight: 'bold',
  },
})
