import React, { useState } from 'react';
import { signUp, logIn, logOut, signInWithGoogle } from './firebase';
import { Mail, Lock, UserPlus, LogIn, LogOut, Chrome } from 'lucide-react';

interface AuthProps {
  user: { uid: string; email: string | null } | null;
  onAuthChange: () => void;
}

export const Auth: React.FC<AuthProps> = ({ user, onAuthChange }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await logIn(email, password);
      } else {
        await signUp(email, password);
      }
      onAuthChange();
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);

    try {
      await signInWithGoogle();
      onAuthChange();
    } catch (err: any) {
      setError(err.message || 'Google sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logOut();
      onAuthChange();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (user) {
    return (
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center text-white font-bold">
          {user.email?.[0].toUpperCase() || 'U'}
        </div>
        <div className="text-sm flex-1 min-w-0">
          <div className="text-white truncate">{user.email}</div>
          <div className="text-xs text-slate-500">Logged In</div>
        </div>
        <button
          onClick={handleLogout}
          className="p-2 text-slate-400 hover:text-red-400 transition-colors"
          title="Logout"
        >
          <LogOut size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 border-t border-slate-800">
      <h3 className="text-sm font-medium text-white mb-3">
        {isLogin ? 'Sign In' : 'Create Account'}
      </h3>
      
      {error && (
        <div className="mb-3 p-2 bg-red-900/30 border border-red-800 rounded text-red-400 text-xs">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white placeholder-slate-500 focus:border-indigo-500 outline-none"
            required
          />
        </div>
        
        <div className="relative">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white placeholder-slate-500 focus:border-indigo-500 outline-none"
            required
            minLength={6}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 text-white rounded text-sm font-medium transition-colors"
        >
          {loading ? (
            <span className="animate-spin">⌛</span>
          ) : isLogin ? (
            <><LogIn size={16} /> Sign In</>
          ) : (
            <><UserPlus size={16} /> Sign Up</>
          )}
        </button>
      </form>

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-700"></div>
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="px-2 bg-slate-800 text-slate-500">or</span>
        </div>
      </div>

      <button
        onClick={handleGoogleSignIn}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white hover:bg-slate-100 disabled:bg-slate-300 text-slate-700 rounded text-sm font-medium transition-colors"
      >
        <Chrome size={18} className="text-red-500" />
        Continue with Google
      </button>

      <button
        onClick={() => {
          setIsLogin(!isLogin);
          setError('');
        }}
        className="w-full mt-4 text-xs text-slate-400 hover:text-white transition-colors"
      >
        {isLogin ? 'Need an account? Sign Up' : 'Have an account? Sign In'}
      </button>
    </div>
  );
};
