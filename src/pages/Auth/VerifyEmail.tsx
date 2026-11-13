import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../lib/axios';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/Button';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { user, updateUser } = useAuth();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(token ? 'loading' : 'error');
  const [message, setMessage] = useState(token ? '' : 'This verification link is incomplete.');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return; // run once (React strict mode double-invokes effects)
    started.current = true;
    api.post('/api/auth/verify-email', { token })
      .then(() => { setState('ok'); if (user) updateUser({ email_verified: true } as any); })
      .catch((err) => { setState('error'); setMessage(err.response?.data?.message || 'This link is invalid or has expired.'); });
  }, [token]);

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center px-8">
      <div className="w-full max-w-md mx-auto text-center">
        <Link to="/" className="font-serif italic text-textPrimary text-[32px] tracking-[-2px] mb-12 inline-block">INFAMOUS</Link>
        <div className="bg-white/50 p-8 rounded-[24px] border border-black/10">
          {state === 'loading' && <p className="text-textSecondary text-sm">Verifying your email…</p>}
          {state === 'ok' && (
            <>
              <h3 className="font-serif text-2xl mb-3 text-textPrimary">Email verified</h3>
              <p className="text-textSecondary font-light text-sm mb-6">Thank you. Your email address is confirmed.</p>
              <Link to="/"><Button className="w-full">Continue shopping</Button></Link>
            </>
          )}
          {state === 'error' && (
            <>
              <h3 className="font-serif text-2xl mb-3 text-textPrimary">Link not valid</h3>
              <p className="text-textSecondary font-light text-sm mb-6">{message} Log in and use “Resend verification email” on your profile to get a new link.</p>
              <Link to="/auth/login"><Button className="w-full">Go to login</Button></Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
