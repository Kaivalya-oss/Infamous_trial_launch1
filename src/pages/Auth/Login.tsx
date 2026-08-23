import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import api from '../../lib/axios';
import { auth, googleProvider, signInWithPopup, signInWithPhoneNumber, RecaptchaVerifier } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

declare global {
  interface Window {
    recaptchaVerifier: any;
  }
}

const loginSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string().min(8, { message: "Password must be at least 8 characters" }),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/profile/orders';
  const { login, isAuthenticated } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [loginMethod, setLoginMethod] = useState<'email' | 'phone'>('email');
  
  // Phone Auth State
  const [phoneNumber, setPhoneNumber] = useState('+91');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<any>(null);

  useEffect(() => {
    // Initialize recaptcha when switching to phone tab if not already initialized
    if (loginMethod === 'phone' && !window.recaptchaVerifier) {
      try {
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible'
        });
      } catch (e) {
        console.error('Failed to initialize recaptcha:', e);
      }
    }
    
    return () => {
      if (window.recaptchaVerifier && loginMethod === 'email') {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
      }
    };
  }, [loginMethod]);

  // Google Login Flow
  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      const response = await api.post('/api/auth/google', {
        email: user.email,
        firstName: user.displayName?.split(' ')[0] || 'Google',
        lastName: user.displayName?.split(' ').slice(1).join(' ') || 'User',
        googleId: user.uid,
        profileImage: user.photoURL
      });
      
      login(response.data.accessToken, response.data.refreshToken, response.data.user);
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error(err);
      setPhoneError(err.message || 'Google Auth Failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Phone OTP Flow
  const handleSendOtp = async () => {
    setPhoneError('');
    // Normalize to E.164 format: e.g. +919373860560
    const normalizedPhone = phoneNumber.replace(/[\s-]/g, '');
    
    if (!normalizedPhone.match(/^\+\d{10,15}$/)) {
      setPhoneError('Please enter a valid phone number with country code (e.g. +919876543210)');
      return;
    }
    
    setIsLoading(true);
    try {
      if (!window.recaptchaVerifier) {
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible'
        });
      }
      const appVerifier = window.recaptchaVerifier;
      const confirmation = await signInWithPhoneNumber(auth, normalizedPhone, appVerifier);
      setConfirmationResult(confirmation);
      setOtpSent(true);
    } catch (err: any) {
      console.error('Firebase Phone Auth Error:', err);
      
      // Reset recaptcha if it fails so user can try again
      if (window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
      }
      
      const errorCode = err.code;
      if (errorCode === 'auth/operation-not-allowed') {
        setPhoneError('SMS configuration error: Phone provider or region not allowed in Firebase.');
      } else if (errorCode === 'auth/invalid-phone-number') {
        setPhoneError('Invalid phone number format.');
      } else if (errorCode === 'auth/too-many-requests') {
        setPhoneError('Too many requests. Please try again later.');
      } else if (errorCode === 'auth/quota-exceeded') {
        setPhoneError('SMS quota exceeded. Please try again later.');
      } else if (errorCode === 'auth/captcha-check-failed') {
        setPhoneError('reCAPTCHA verification failed. Please try again.');
      } else {
        setPhoneError('Failed to send OTP. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setPhoneError('');
    if (!otp) return;
    setIsLoading(true);
    try {
      const result = await confirmationResult.confirm(otp);
      
      // Send verified phone to our backend to get JWT
      const response = await api.post('/api/auth/phone', {
        phoneNumber: result.user.phoneNumber
      });
      
      login(response.data.accessToken, response.data.refreshToken, response.data.user);
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-verification-code') {
        setPhoneError('Incorrect OTP. Please try again.');
      } else if (err.code === 'auth/code-expired') {
        setPhoneError('OTP has expired. Please request a new one.');
      } else {
        setPhoneError('Verification failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  const { register, handleSubmit, formState: { errors }, setError } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormValues) => {
    setIsLoading(true);
    try {
      const response = await api.post('/api/auth/login', {
        email: data.email,
        password: data.password
      });

      login(response.data.accessToken, response.data.refreshToken, response.data.user);
      navigate(from, { replace: true });
    } catch (error: any) {
      setError('password', { 
        type: 'manual',
        message: error.response?.data?.message || 'Failed to login. Please try again.' 
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <div id="recaptcha-container"></div>
      <div className="hidden md:block w-[50%] h-screen relative overflow-hidden">
        <img 
          src="/lookbook_1_1782146168251.png" 
          alt="Login Campaign" 
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/20" />
        <Link to="/" className="absolute top-10 left-10 font-serif italic text-white text-[32px] tracking-[-2px] z-10">
          INFAMOUS
        </Link>
      </div>

      <div className="w-full md:w-[50%] h-screen flex flex-col justify-center px-8 md:px-24">
        <Link to="/" className="md:hidden font-serif italic text-textPrimary text-[32px] tracking-[-2px] mb-12">
          INFAMOUS
        </Link>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="w-full max-w-md mx-auto"
        >
          <div className="mb-12">
            <h1 className="font-serif italic text-[48px] md:text-[64px] leading-none mb-4">Welcome Back</h1>
            <p className="text-textSecondary font-light">Enter your details to access your account.</p>
          </div>

          <div className="flex gap-4 mb-8">
            <button 
              onClick={() => setLoginMethod('email')}
              className={`pb-2 text-sm font-medium transition-colors border-b-2 ${loginMethod === 'email' ? 'border-textPrimary text-textPrimary' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}
            >
              Email
            </button>
            <button 
              onClick={() => setLoginMethod('phone')}
              className={`pb-2 text-sm font-medium transition-colors border-b-2 ${loginMethod === 'phone' ? 'border-textPrimary text-textPrimary' : 'border-transparent text-textSecondary hover:text-textPrimary'}`}
            >
              Phone OTP
            </button>
          </div>

          {loginMethod === 'email' ? (
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
              <Input 
                label="Email Address" 
                type="email" 
                placeholder="john@example.com"
                {...register("email")}
                error={errors.email?.message}
              />
              
              <div className="flex flex-col gap-2">
                <Input 
                  label="Password" 
                  type="password" 
                  placeholder="••••••••"
                  {...register("password")}
                  error={errors.password?.message}
                />
                <Link to="/auth/forgot-password" className="text-[11px] text-textSecondary font-medium text-right hover:text-textPrimary transition-colors">
                  Forgot Password?
                </Link>
              </div>

              <Button type="submit" isLoading={isLoading} className="mt-4 w-full">
                Sign In
              </Button>
            </form>
          ) : (
            <div className="flex flex-col gap-6">
              {!otpSent ? (
                <>
                  <Input 
                    label="Phone Number" 
                    type="tel" 
                    placeholder="+91 98765 43210"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    error={phoneError}
                  />
                  <Button type="button" onClick={handleSendOtp} isLoading={isLoading} className="mt-4 w-full">
                    Send OTP
                  </Button>
                </>
              ) : (
                <>
                  <Input 
                    label="Enter OTP" 
                    type="text" 
                    placeholder="123456"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    error={phoneError}
                  />
                  <Button type="button" onClick={handleVerifyOtp} isLoading={isLoading} className="mt-4 w-full">
                    Verify & Login
                  </Button>
                  <button onClick={() => { setOtpSent(false); setConfirmationResult(null); }} className="text-xs text-textSecondary text-center hover:text-textPrimary">
                    Change Phone Number
                  </button>
                </>
              )}
            </div>
          )}

          <div className="mt-8 pt-8 border-t border-black/10 text-center flex flex-col gap-4">
            <p className="text-sm text-textSecondary">
              Don't have an account? <Link to="/auth/register" className="text-textPrimary font-medium underline underline-offset-4">Register</Link>
            </p>
            <Button variant="outline" onClick={handleGoogleLogin} className="w-full flex gap-3 items-center justify-center bg-white hover:bg-black/5">
              <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </Button>
            {phoneError && <p className="text-red-500 text-sm">{phoneError}</p>}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
