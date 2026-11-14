import { useEffect, useRef, useState } from 'react';
import api from '../lib/axios';
import { auth, googleProvider, signInWithPopup, signInWithPhoneNumber, linkWithPhoneNumber, RecaptchaVerifier } from '../lib/firebase';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { BUSINESS } from '../lib/business';

// Verify (and thereby link) a phone number to the signed-in account with a one-time code.
//
// A phone number typed into Personal Info proves nothing, so it is never used to sign in. Verifying it by OTP does:
//  - Google-linked accounts: the phone is linked to the SAME Firebase (Google) account, so Google sign-in and phone
//    sign-in then open the same customer account.
//  - Other accounts (email + password): the code proves the number belongs to this signed-in customer.
// Our server checks both proofs again (our session + the fresh Firebase token) before it records anything.

interface Props {
  savedPhone: string;
  verified: boolean;
  firebaseUid: string | null;
  onVerified: (phone: string) => void;
}

const toE164 = (raw: string) => {
  const cleaned = raw.replace(/[\s()-]/g, '');
  if (/^\+\d{10,15}$/.test(cleaned)) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^91\d{10}$/.test(cleaned)) return `+${cleaned}`;
  return cleaned;
};

const TAKEN_MESSAGE = `This phone number is already associated with another INFAMOUS account, so it cannot be added here. If the number is yours, please contact customer support at ${BUSINESS.supportEmail}.`;

export default function PhoneVerification({ savedPhone, verified, firebaseUid, onVerified }: Props) {
  const [phone, setPhone] = useState(toE164(savedPhone || ''));
  const [otp, setOtp] = useState('');
  const [confirmation, setConfirmation] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const verifierRef = useRef<any>(null);

  useEffect(() => { setPhone(toE164(savedPhone || '')); }, [savedPhone]);
  useEffect(() => () => { try { verifierRef.current?.clear(); } catch { /* nothing to clear */ } }, []);

  const explain = (err: any): string => {
    const code = err?.code as string | undefined;
    if (err?.response?.status === 409 || code === 'auth/credential-already-in-use' || code === 'auth/phone-number-already-exists' || code === 'auth/account-exists-with-different-credential') return TAKEN_MESSAGE;
    if (err?.message === 'WRONG_GOOGLE_ACCOUNT') return 'Please choose the same Google account you signed in with.';
    if (code === 'auth/invalid-phone-number') return 'Please enter a valid phone number with country code, for example +919876543210.';
    if (code === 'auth/too-many-requests') return 'Too many attempts. Please try again later.';
    if (code === 'auth/invalid-verification-code') return 'That code is not correct. Please try again.';
    if (code === 'auth/code-expired') return 'That code has expired. Please request a new one.';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Google sign-in was cancelled. Please try again.';
    if (err?.response?.data?.message) return err.response.data.message;
    return 'We could not complete the verification. Please try again.';
  };

  const sendCode = async () => {
    setError(''); setMessage('');
    const e164 = toE164(phone);
    if (!/^\+\d{10,15}$/.test(e164)) { setError('Enter your phone number with country code, for example +919876543210.'); return; }
    setBusy(true);
    try {
      try { verifierRef.current?.clear(); } catch { /* ignore */ }
      verifierRef.current = new RecaptchaVerifier(auth, 'phone-verify-recaptcha', { size: 'invisible' });
      let result;
      if (firebaseUid) {
        // The account is tied to a Google (Firebase) identity: the phone must be linked to that same identity.
        let fbUser = auth.currentUser;
        if (!fbUser || fbUser.uid !== firebaseUid) {
          const popup = await signInWithPopup(auth, googleProvider);
          fbUser = popup.user;
          if (fbUser.uid !== firebaseUid) throw new Error('WRONG_GOOGLE_ACCOUNT');
        }
        result = await linkWithPhoneNumber(fbUser, e164, verifierRef.current);
      } else {
        result = await signInWithPhoneNumber(auth, e164, verifierRef.current);
      }
      setConfirmation(result);
      setPhone(e164);
      setMessage(`We sent a 6-digit code to ${e164}.`);
    } catch (err: any) {
      console.error('Phone verification (send) failed:', err?.code || err?.message);
      try { verifierRef.current?.clear(); } catch { /* ignore */ }
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    setError('');
    if (!otp.trim()) return;
    setBusy(true);
    try {
      const credential = await confirmation.confirm(otp.trim());
      const idToken = await credential.user.getIdToken(true);
      const res = await api.post('/api/account/link-phone', { idToken });
      setConfirmation(null); setOtp(''); setMessage('');
      onVerified(res.data?.user?.phone_number || phone);
    } catch (err: any) {
      console.error('Phone verification (confirm) failed:', err?.code || err?.message);
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  if (verified) {
    return (
      <p className="-mt-3 text-sm text-green-700 bg-green-50 px-4 py-3 rounded-xl">
        Phone number verified. You can use it to sign in with a one-time code.
      </p>
    );
  }

  return (
    <div className="-mt-3 rounded-xl border border-black/10 p-4 text-sm">
      <p className="text-textSecondary mb-3">
        Your phone number is not verified yet. Entering a number is not enough to sign in with it: verify it with a one-time code
        so that phone sign-in opens this account.
      </p>
      {!confirmation ? (
        <div className="flex flex-col gap-3">
          <Input label="Phone number to verify" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
          <Button type="button" onClick={sendCode} isLoading={busy} className="self-start">Send verification code</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Input label="Verification code" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="123456" inputMode="numeric" autoComplete="one-time-code" />
          <div className="flex gap-3">
            <Button type="button" onClick={confirmCode} isLoading={busy}>Verify</Button>
            <Button type="button" variant="outline" onClick={() => { setConfirmation(null); setOtp(''); setMessage(''); }} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
      {message && <p className="mt-3 text-textSecondary">{message}</p>}
      {error && <p className="mt-3 text-red-600">{error}</p>}
      <div id="phone-verify-recaptcha" />
    </div>
  );
}
