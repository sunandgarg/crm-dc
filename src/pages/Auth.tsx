import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, KeyRound, Loader2, LogIn, Mail, RefreshCw } from 'lucide-react';
import logo from '@/assets/logo.png';
import { supabase } from '@/integrations/supabase/client';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [developmentCode, setDevelopmentCode] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  const checkExistingSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) navigate(from, { replace: true });
    setCheckingSession(false);
  }, [from, navigate]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: string, session: any) => {
      if (session?.user) navigate(from, { replace: true });
      setCheckingSession(false);
    });
    void checkExistingSession();
    return () => subscription.unsubscribe();
  }, [checkExistingSession, from, navigate]);

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return setError('Enter a valid email address');
    setLoading(true);
    const { data, error: requestError } = await supabase.auth.requestOtp({ email: normalized });
    setLoading(false);
    if (requestError) return setError(requestError.message || 'Could not send the verification code');
    setEmail(normalized);
    setDevelopmentCode(data?.developmentCode || null);
    setStep('code');
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit verification code');
    setLoading(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    setLoading(false);
    if (verifyError) setError(verifyError.message || 'Invalid or expired verification code');
  };

  if (checkingSession) return <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4"><Loader2 className="h-8 w-8 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Checking your session...</p></div>;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="card-elevated p-8">
          <div className="mb-8 flex justify-center"><img src={logo} alt="DekhoCampus" className="h-16 w-auto" /></div>
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-foreground">{step === 'email' ? 'Sign in to CRM' : 'Check your email'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{step === 'email' ? 'A secure verification code will be sent by email.' : `Enter the code sent to ${email}.`}</p>
          </div>

          {error && <div className="mb-5 flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/10 p-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" /><p className="flex-1 text-sm text-destructive">{error}</p><button type="button" onClick={() => setError(null)} aria-label="Dismiss error" className="text-destructive">x</button></div>}

          {developmentCode && <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Development code: <strong className="font-mono">{developmentCode}</strong></div>}

          {step === 'email' ? (
            <form onSubmit={requestCode} className="space-y-5">
              <div><label className="mb-2 block text-sm font-medium text-foreground">Work email</label><div className="relative"><Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="input-field pl-11" placeholder="you@company.com" autoComplete="email" disabled={loading} autoFocus /></div></div>
              <button type="submit" disabled={loading} className="btn-primary flex w-full items-center justify-center gap-2">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Mail className="h-5 w-5" />Send code</>}</button>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-5">
              <div><label className="mb-2 block text-sm font-medium text-foreground">Verification code</label><div className="relative"><KeyRound className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" /><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="input-field pl-11 font-mono text-lg" placeholder="000000" disabled={loading} autoFocus /></div></div>
              <button type="submit" disabled={loading} className="btn-primary flex w-full items-center justify-center gap-2">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <><LogIn className="h-5 w-5" />Verify and sign in</>}</button>
              <div className="flex items-center justify-between"><button type="button" onClick={() => { setStep('email'); setCode(''); setDevelopmentCode(null); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Change email</button><button type="button" onClick={(event) => void requestCode(event as any)} className="flex items-center gap-1 text-sm text-primary hover:text-primary/80"><RefreshCw className="h-4 w-4" />Resend</button></div>
            </form>
          )}
          <p className="mt-6 text-center text-xs text-muted-foreground">Access is limited to approved CRM users.</p>
        </div>
      </div>
    </div>
  );
}
