import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import api from '../../lib/axios';
import { useAuth } from '../../context/AuthContext';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import PhoneVerification from '../../components/PhoneVerification';

export default function PersonalInfo() {
  const { user, updateUser } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  // Changing the login email needs the current password (only for accounts that have one)
  const [originalEmail, setOriginalEmail] = useState('');
  // Phone verification (OTP) is offered only where phone sign-in is switched on
  const phoneLoginEnabled = import.meta.env.VITE_ENABLE_PHONE_LOGIN === 'true';
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [savedPhone, setSavedPhone] = useState('');
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [emailVerified, setEmailVerified] = useState(true);
  const [verifyMsg, setVerifyMsg] = useState('');
  const [isSending, setIsSending] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let isMounted = true;
    const fetchProfile = async () => {
      try {
        const response = await api.get('/api/profile');
        if (isMounted && response.data?.user) {
          const u = response.data.user;
          const fName = u.first_name || (u.name ? u.name.split(' ')[0] : '');
          const lName = u.last_name || (u.name ? u.name.split(' ').slice(1).join(' ') : '');
          setFirstName(fName);
          setLastName(lName);
          setEmail(u.email || '');
          setOriginalEmail(u.email || '');
          setHasPassword(u.has_password === true);
          setPhoneVerified(u.phone_verified === true);
          setSavedPhone(u.phone_number || '');
          setFirebaseUid(u.firebase_uid || null);
          setPhone(u.phone_number || '');
          setAddress(u.address || '');
          setEmailVerified(u.email_verified === true);
          updateUser({
            first_name: fName,
            last_name: lName,
            email: u.email,
            phone_number: u.phone_number,
            address: u.address
          });
        }
      } catch (err) {
        console.error('Failed to load profile:', err);
        if (isMounted && user) {
          const fName = user.first_name || (user.name ? user.name.split(' ')[0] : '');
          const lName = user.last_name || (user.name ? user.name.split(' ').slice(1).join(' ') : '');
          setFirstName(fName);
          setLastName(lName);
          setEmail(user.email || '');
          setPhone(user.phone_number || '');
          setAddress(user.address || '');
        }
      } finally {
        if (isMounted) setIsFetching(false);
      }
    };

    fetchProfile();
    return () => {
      isMounted = false;
    };
  }, []);

  const resendVerification = async () => {
    setIsSending(true);
    setVerifyMsg('');
    try {
      const res = await api.post('/api/auth/resend-verification');
      if (res.data?.alreadyVerified) setEmailVerified(true);
      setVerifyMsg(res.data?.alreadyVerified ? 'Your email is already verified.' : 'Verification email sent. Please check your inbox and spam folder.');
    } catch (err: any) {
      setVerifyMsg(err.response?.data?.message || 'Could not send the email. Please try again later.');
    } finally {
      setIsSending(false);
    }
  };

  const emailChanging = hasPassword && !!originalEmail && email.trim().toLowerCase() !== originalEmail.trim().toLowerCase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailChanging && !currentPassword) {
      setErrorMsg('Enter your current password to change your email address.');
      return;
    }
    setIsLoading(true);
    setErrorMsg('');
    setIsSuccess(false);

    try {
      const response = await api.put('/api/profile', {
        first_name: firstName,
        last_name: lastName,
        email,
        phone_number: phone,
        address,
        ...(emailChanging ? { currentPassword } : {})
      });

      const updated = response.data?.user;
      if (updated) {
        setOriginalEmail(updated.email || '');
        setPhoneVerified(updated.phone_verified === true);
        setSavedPhone(updated.phone_number || '');
        setCurrentPassword('');
        setEmailVerified(updated.email_verified === true);
        setVerifyMsg(updated.email_verified === true ? '' : 'We sent a verification link to your email address.');
        updateUser({
          first_name: updated.first_name,
          last_name: updated.last_name,
          name: updated.name || `${firstName} ${lastName}`.trim(),
          email: updated.email,
          phone_number: updated.phone_number,
          address: updated.address
        });
      }

      setIsSuccess(true);
      setTimeout(() => setIsSuccess(false), 3000);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || 'Failed to save changes. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-2xl"
    >
      <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-8">Personal Info</h2>

      <div className="bg-white border border-black/10 rounded-[24px] p-8 md:p-10">
        {isFetching ? (
          <div className="py-8 text-center text-textSecondary text-sm font-medium">Loading personal info...</div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input
                label="First Name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
              <Input
                label="Last Name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <Input
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {emailChanging && (
              <Input
                label="Current password (required to change your email)"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            )}
            {email && !emailVerified && (
              <div className="-mt-3 flex flex-wrap items-center gap-3 text-sm text-amber-700 bg-amber-50 px-4 py-3 rounded-xl">
                <span>Your email is not verified yet.</span>
                <button type="button" onClick={resendVerification} disabled={isSending} className="underline font-medium disabled:opacity-50">
                  {isSending ? 'Sending…' : 'Resend verification email'}
                </button>
                {verifyMsg && <span className="w-full text-textSecondary">{verifyMsg}</span>}
              </div>
            )}
            <Input
              label="Phone Number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {phoneLoginEnabled && savedPhone && savedPhone === phone && (
              <PhoneVerification
                savedPhone={savedPhone}
                verified={phoneVerified}
                firebaseUid={firebaseUid}
                onVerified={(verifiedPhone) => {
                  setPhoneVerified(true);
                  setSavedPhone(verifiedPhone);
                  setPhone(verifiedPhone);
                  updateUser({ phone_number: verifiedPhone, phone_verified: true });
                }}
              />
            )}

            <div className="pt-4 border-t border-black/10 mt-4">
              <h3 className="text-sm font-medium mb-4">Saved Address</h3>
              <Input
                label="Default Shipping Address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>

            <AnimatePresence>
              {isSuccess && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-green-50 text-green-700 px-4 py-3 rounded-xl flex items-center gap-3 text-sm font-medium"
                >
                  <CheckCircle2 size={16} />
                  Profile details updated successfully.
                </motion.div>
              )}
              {errorMsg && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-red-50 text-red-700 px-4 py-3 rounded-xl flex items-center gap-3 text-sm font-medium"
                >
                  <AlertCircle size={16} />
                  {errorMsg}
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" isLoading={isLoading} className="w-full md:w-auto mt-4 self-end">
              Save Changes
            </Button>
          </form>
        )}
      </div>
    </motion.div>
  );
}
