import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../../lib/axios';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 72) return 'Password must be at most 72 characters';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain at least one letter and one number';
  return null;
}

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError('Passwords do not match');
    setError('');
    setIsLoading(true);
    try {
      await api.post('/api/auth/reset-password', { token, newPassword: password });
      setDone(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center px-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="w-full max-w-md mx-auto">
        <Link to="/" className="font-serif italic text-textPrimary text-[32px] tracking-[-2px] mb-12 inline-block">INFAMOUS</Link>
        <h1 className="font-serif italic text-[44px] md:text-[56px] leading-none mb-4">Choose a new password</h1>

        {!token ? (
          <div className="mt-8">
            <p className="text-textSecondary font-light text-sm mb-6">This reset link is incomplete. Please request a new one.</p>
            <Link to="/auth/forgot-password"><Button className="w-full">Request a new link</Button></Link>
          </div>
        ) : done ? (
          <div className="mt-8 bg-white/50 p-8 rounded-[24px] border border-black/10 text-center">
            <h3 className="font-serif text-2xl mb-3 text-textPrimary">Password updated</h3>
            <p className="text-textSecondary font-light text-sm mb-6">You have been signed out on all devices. Log in with your new password.</p>
            <Link to="/auth/login"><Button className="w-full">Go to login</Button></Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-6 mt-8">
            <p className="text-textSecondary font-light text-sm">At least 8 characters, with a letter and a number.</p>
            <Input label="New Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <Input label="Confirm Password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            {error && (
              <p className="text-sm text-red-600">
                {error}{' '}
                {/expired|invalid/i.test(error) && <Link to="/auth/forgot-password" className="underline">Request a new link</Link>}
              </p>
            )}
            <Button type="submit" isLoading={isLoading} className="w-full">Update Password</Button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
