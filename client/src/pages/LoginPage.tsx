import { Eye, EyeOff, LogIn, Mail, Sparkles } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { errorCode } from '@/api/client';
import { useLogin } from '@/api/hooks';
import { Button, IconButton } from '@/components/ui/Button';
import { Card, IconTile } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { PublicLayout } from '@/components/shell/AppShell';
import { Page } from '@/components/shell/Page';

/** Four user roles: Admin, Dr, Student, and Club Organizer */
const DEMO = [
  { email: 'admin@campusway.local', name: 'Admin', role: '👑 Admin' },
  { email: 'benali@campusway.local', name: 'Dr. Benali', role: '🎓 Dr' },
  { email: 'yacine@campusway.local', name: 'Yacine', role: '🎒 Student' },
  { email: 'riad@campusway.local', name: 'Riad (Club)', role: '👥 Club' },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Injected by Vite from server/.env SEED_PASSWORD (or VITE_DEMO_PASSWORD override). */
const DEMO_PASSWORD = __DEMO_PASSWORD__;

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const from = (location.state as { from?: string } | null)?.from ?? '/map';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!EMAIL.test(email.trim())) next.email = email.trim() ? t('login.emailInvalid') : t('common.required');
    if (!password) next.password = t('common.required');
    setErrors(next);
    if (next.email) return emailRef.current?.focus();
    if (next.password) return passwordRef.current?.focus();
    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: (session) => {
          toast.show(t('login.welcome', { name: session.user.displayName }), { tone: 'success' });
          const destination =
            session.user.role === 'ADMIN'
              ? '/admin'
              : session.user.role === 'TEACHER'
                ? '/rooms'
                : session.user.accessibilityProfile.updatedAt
                  ? from
                  : '/onboarding';
          navigate(destination, { replace: true });
        },
        onError: (err) => {
          const code = errorCode(err);
          setErrors({ form: code === 'INVALID_CREDENTIALS' ? t('login.invalid') : code === 'RATE_LIMITED' ? t('login.tooMany') : code === 'NETWORK' ? t('common.networkError') : t('common.error') });
        },
      },
    );
    return undefined;
  };

  return (
    <PublicLayout>
      <Page title={t('page.login')} className="max-w-md animate-fade-in">
        <Card className="rounded-card border border-line bg-card p-6 shadow-card desk:p-8">
          <div className="mb-6 flex items-start gap-3">
            <IconTile icon={LogIn} tone="primary" />
            <div>
              <h2 className="text-h2 text-ink">{t('page.login')}</h2>
              <p className="mt-1 text-sm text-muted">{t('login.subtitle')}</p>
            </div>
          </div>
          {errors.form ? (
            <div role="alert" className="mb-4 rounded-control border-2 border-danger bg-danger-bg p-4 text-base font-bold text-danger">
              {errors.form}
            </div>
          ) : null}
          <form noValidate onSubmit={submit} className="flex flex-col gap-4 desk:gap-5">
            <Input
              ref={emailRef}
              label={t('login.email')}
              type="email"
              autoComplete="username"
              inputMode="email"
              icon={Mail}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              required
            />
            <Input
              ref={passwordRef}
              label={t('login.password')}
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              required
              end={<IconButton icon={show ? EyeOff : Eye} label={show ? t('login.hidePassword') : t('login.showPassword')} aria-pressed={show} onClick={() => setShow((s) => !s)} />}
            />
            <Button type="submit" size="lg" icon={LogIn} loading={login.isPending} fullWidth>
              {login.isPending ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>
        </Card>
        <Card className="mt-4 rounded-card border border-line bg-card p-5 shadow-card desk:p-6">
          <div className="mb-4 flex items-start gap-3">
            <IconTile icon={Sparkles} tone="route" />
            <div>
              <h2 className="text-h3 text-ink">{t('login.demoTitle')}</h2>
              <p className="mt-1 text-sm text-muted">{t('login.demoText')}</p>
            </div>
          </div>
          <ul className="grid gap-2 tablet:grid-cols-2">
            {DEMO.map((d) => (
              <li key={d.email}>
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(DEMO_PASSWORD);
                  }}
                >
                  <span className="font-bold">{d.role}</span>: {d.name}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </Page>
    </PublicLayout>
  );
}
