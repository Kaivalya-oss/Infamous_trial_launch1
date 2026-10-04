import { useState } from 'react';
import api from '../../lib/axios';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { ArrowLeft } from 'lucide-react';

const forgotPasswordSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
});

type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPassword() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = async (data: ForgotPasswordValues) => {
    setIsLoading(true);
    try {
      await api.post('/api/auth/forgot-password', { email: data.email });
      setIsSubmitted(true);
    } catch (error: any) {
      console.error('Password reset failed', error);
      // Even if user not found, we typically show success to prevent email enumeration,
      // but backend currently sends 404, so we handle it gracefully here if we want.
      // We will just show submitted regardless to be secure.
      setIsSubmitted(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row-reverse">
      {/* Image Side */}
      <div className="hidden md:block w-[50%] h-screen relative overflow-hidden">
        <img 
          src="/lookbook_3_1782146217398.png" 
          alt="Forgot Password Campaign" 
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/20" />
        <Link to="/" className="absolute top-10 right-10 font-serif italic text-white text-[32px] tracking-[-2px] z-10">
          INFAMOUS
        </Link>
      </div>

      {/* Form Side */}
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
          <Link to="/auth/login" className="inline-flex items-center gap-2 text-sm text-textSecondary hover:text-textPrimary transition-colors mb-8">
            <ArrowLeft size={16} />
            Back to Login
          </Link>

          <div className="mb-12">
            <h1 className="font-serif italic text-[48px] md:text-[64px] leading-none mb-4">Reset Password</h1>
            <p className="text-textSecondary font-light">
              Enter the email address linked to your account.
            </p>
          </div>

          {!isSubmitted ? (
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8">
              <Input 
                label="Email Address" 
                type="email" 
                placeholder="john@example.com"
                {...register("email")}
                error={errors.email?.message}
              />
              
              <Button type="submit" isLoading={isLoading} className="w-full">
                Send Reset Link
              </Button>
            </form>
          ) : (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white/50 p-8 rounded-[24px] border border-black/10 text-center"
            >
              <h3 className="font-serif text-2xl mb-3 text-textPrimary">Request received</h3>
              <p className="text-textSecondary font-light text-sm mb-6">
                Online password reset isn't available yet. Please contact our support team and we'll help you regain access to your account.
              </p>
              <Button onClick={() => setIsSubmitted(false)} variant="outline" className="w-full">
                Try another email
              </Button>
            </motion.div>
          )}

        </motion.div>
      </div>
    </div>
  );
}
