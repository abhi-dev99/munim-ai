/**
 * Biometric confirmation gate for one specific decision: dismissing a
 * FRAUD_FLAGGED scan result in frontend/src/app/trader/page.js. See
 * mobile/BRIDGE.md for the wire protocol (MUNIM_BIOMETRIC_REQUEST /
 * MUNIM_BIOMETRIC_RESULT) that carries the outcome of this module back to
 * the web page.
 *
 * This does NOT gate app access, login, or anything else, and it never
 * decides fraud -- that's backend/app/domain/fraud.py, 100% server-side.
 * A wrong call here just leaves an already-flagged invoice's alert open a
 * little longer; it can never lose data or block the trader from using the
 * app, which is why the two "not success" outcomes below get different
 * treatment:
 *
 *  - `reason: 'not_available'` -- the device itself can't do biometric auth
 *    right now (no fingerprint/face sensor, or one with nothing enrolled).
 *    The trader did nothing wrong here, and there is no prompt they could
 *    retry -- the caller (mobile/modules/bridge.ts, then the web page) is
 *    expected to treat this the same as "no native bridge at all" and fall
 *    back to an immediate dismiss instead of stranding them.
 *  - any other `reason` -- an actual system prompt appeared and didn't
 *    succeed (cancelled, wrong finger, lockout, timeout, ...). The caller
 *    should leave the alert open so the trader can look again or retry.
 */

import * as LocalAuthentication from 'expo-local-authentication'

export type BiometricOutcome = {
  success: boolean
  reason?: string
}

// expo-local-authentication's own LocalAuthenticationError already includes
// 'not_available' and 'not_enrolled' as possible authenticateAsync() error
// codes, but we check hasHardwareAsync()/isEnrolledAsync() up front anyway
// so the common case (no sensor at all) never has to open a prompt just to
// find that out. This set folds authenticateAsync()'s own equivalent codes
// (reachable only in the rare race where enrollment changes between our
// check and the call) into the same 'not_available' bucket, so the caller
// only has to special-case one string, not the library's whole error enum.
const NOT_AVAILABLE_ERRORS = new Set(['not_available', 'not_enrolled'])

export async function authenticateBiometric(promptMessage: string): Promise<BiometricOutcome> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync()
    if (!hasHardware) {
      return { success: false, reason: 'not_available' }
    }

    const isEnrolled = await LocalAuthentication.isEnrolledAsync()
    if (!isEnrolled) {
      return { success: false, reason: 'not_available' }
    }

    const result = await LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: false })
    if (result.success) {
      return { success: true }
    }
    return { success: false, reason: NOT_AVAILABLE_ERRORS.has(result.error) ? 'not_available' : result.error }
  } catch (err) {
    // A thrown error here means something broke before we got a resolved
    // LocalAuthenticationResult (e.g. native module misconfiguration) --
    // never report this as 'not_available', since we don't actually know
    // that's true; treat it like any other failed attempt.
    return { success: false, reason: err instanceof Error ? err.message : 'unknown' }
  }
}
