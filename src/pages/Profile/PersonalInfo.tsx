import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import api from '../../lib/axios';
import { useAuth } from '../../context/AuthContext';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

export default function PersonalInfo() {
  const { user, updateUser } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

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
          setPhone(u.phone_number || '');
          setAddress(u.address || '');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');
    setIsSuccess(false);

    try {
      const response = await api.put('/api/profile', {
        first_name: firstName,
        last_name: lastName,
        email,
        phone_number: phone,
        address
      });

      const updated = response.data?.user;
      if (updated) {
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
            <Input
              label="Phone Number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />

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
