import api from '../../lib/axios';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import axios from 'axios';
import { CheckCircle2 } from 'lucide-react';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters")
    .regex(/[A-Za-z]/, "Password must include at least one letter")
    .regex(/\d/, "Password must include at least one number"),
  confirmPassword: z.string()
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type PasswordFormValues = z.infer<typeof passwordSchema>;

export default function SecuritySettings() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const { register, handleSubmit, formState: { errors }, reset, setError } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema)
  });

  const onSubmit = async (data: PasswordFormValues) => {
    setIsLoading(true);
    try {
      await api.post('/api/auth/update-password', {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword
      });
      
      setIsSuccess(true);
      reset();
      setTimeout(() => setIsSuccess(false), 3000);
    } catch (error: any) {
      setError('currentPassword', { 
        type: 'manual', 
        message: error.response?.data?.message || 'Failed to update password' 
      });
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
      <h2 className="font-serif italic text-[36px] md:text-[48px] leading-none mb-8">Security Settings</h2>
      
      <div className="bg-white border border-black/10 rounded-[24px] p-8 md:p-10">
        
        {/* Change Password */}
        <div>
          <h3 className="text-sm font-medium tracking-[2px] text-textSecondary uppercase mb-6">Change Password</h3>
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
            <Input 
              label="Current Password" 
              type="password" 
              {...register("currentPassword")}
              error={errors.currentPassword?.message}
            />
            <Input 
              label="New Password" 
              type="password" 
              {...register("newPassword")}
              error={errors.newPassword?.message}
            />
            <Input 
              label="Confirm New Password" 
              type="password" 
              {...register("confirmPassword")}
              error={errors.confirmPassword?.message}
            />
            
            <AnimatePresence>
              {isSuccess && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-green-50 text-green-700 px-4 py-3 rounded-xl flex items-center gap-3 text-sm font-medium"
                >
                  <CheckCircle2 size={16} />
                  Password updated successfully.
                </motion.div>
              )}
            </AnimatePresence>

            <Button type="submit" isLoading={isLoading} className="w-full md:w-auto mt-2 self-start">
              Update Password
            </Button>
          </form>
        </div>
      </div>
    </motion.div>
  );
}
