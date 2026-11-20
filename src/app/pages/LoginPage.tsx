import { useState, type FormEvent } from 'react';
import { TrackwellWordmark } from '../shell/Logo';
import { useData } from '../providers/data';
import { ApiError } from '../api/client';
import { Button, Field, Input } from '../ui/forms';

/** Single-administrator sign-in. The same message for every wrong password (no hints). */
export function LoginPage() {
  const { signIn } = useData();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await signIn(password);
    } catch (err) {
      setPassword('');
      setError(
        err instanceof ApiError
          ? err.status === 401
            ? 'That password isn’t right.'
            : err.message
          : 'Couldn’t sign in. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-ground px-5">
      <form onSubmit={submit} className="w-full max-w-[22rem]" aria-labelledby="login-title">
        <TrackwellWordmark size={34} />
        <h1 id="login-title" className="mt-8 text-[1.375rem] font-semibold tracking-[-0.01em]">
          Sign in
        </h1>
        <p className="mt-1 text-[0.875rem] text-muted">Work. Earn. Understand.</p>
        <div className="mt-6 flex flex-col gap-4">
          <Field label="Password" error={error}>
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" busy={busy} disabled={!password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </main>
  );
}
