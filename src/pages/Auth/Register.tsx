import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import api from '../../lib/axios';
import { useAuth } from '../../context/AuthContext';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

const registerSchema = z.object({
  name: z.string().min(2, { message: "Name must be at least 2 characters" }),
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters")
    .regex(/[A-Za-z]/, "Password must include at least one letter")
    .regex(/\d/, "Password must include at least one number"),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function Register() {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  React.useEffect(() => {
    if (isAuthenticated) {
      navigate('/profile/orders', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const { register, handleSubmit, formState: { errors }, setError } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
  });

  const onSubmit = async (data: RegisterFormValues) => {
    setIsLoading(true);
    try {
      const response = await api.post('/api/auth/register', {
        name: data.name,
        email: data.email,
        password: data.password
      });

      login(response.data.accessToken, response.data.refreshToken, response.data.user);
      navigate('/profile/orders', { replace: true });
    } catch (error: any) {
      setError('root', {
        type: 'manual',
        message: error.response?.data?.message || 'Failed to register. Please try again.'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Image Side */}
      <div className="hidden md:block w-[50%] h-screen relative overflow-hidden">
        <img
          src="/lookbook_2_1782146201135.png"
          alt="Register Campaign"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/20" />
        <Link to="/" className="absolute top-10 left-10 font-serif italic text-white text-[32px] tracking-[-2px] z-10">
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
          <div className="mb-12">
            <h1 className="font-serif italic text-[48px] md:text-[64px] leading-none mb-4">Create Account</h1>
            <p className="text-textSecondary font-light">Join INFAMOUS for exclusive access.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
            <Input
              label="Full Name"
              type="text"
              placeholder="John Doe"
              {...register("name")}
              error={errors.name?.message}
            />
            <Input
              label="Email Address"
              type="email"
              placeholder="john@example.com"
              {...register("email")}
              error={errors.email?.message}
            />
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              {...register("password")}
              error={errors.password?.message}
            />
            {errors.root && (
              <p className="text-red-500 text-sm mt-1">{errors.root.message}</p>
            )}

            <Button type="submit" isLoading={isLoading} className="mt-4 w-full">
              Register
            </Button>
          </form>

          <div className="mt-8 pt-8 border-t border-black/10 text-center">
            <p className="text-sm text-textSecondary">
              Already have an account? <Link to="/auth/login" className="text-textPrimary font-medium underline underline-offset-4">Sign In</Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
