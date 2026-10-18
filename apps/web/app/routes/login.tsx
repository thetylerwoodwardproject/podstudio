import { useState } from "react";
import { redirect, useNavigate } from "react-router";
import { auth } from "~/lib/auth.server";
import { signIn } from "~/lib/auth-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Button } from "~/components/ui/button";

// Screen 01 (Sign in). Per README: two-column layout, hero/waveform left, 560px
// form panel right. "Sign in with SSO" stays hidden until OIDC lands in Stage 13;
// the 6-digit-code link stays hidden until remote sessions exist (Stage 08/04) —
// both per README's own instruction, not an oversight.
export async function loader({ request }: { request: Request }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (session) return redirect("/studio/episodes");
  return null;
}

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await signIn.email({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message ?? "Couldn't sign in — check your email and password.");
      return;
    }
    navigate("/studio/episodes");
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-background text-foreground md:grid-cols-2">
      <div className="hidden items-center justify-center bg-deep md:flex">
        <AnimatedWaveform />
      </div>

      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-[560px] border-border bg-card">
          <CardHeader>
            <CardTitle className="text-2xl">Podstudio</CardTitle>
            <CardDescription>Sign in to your studio.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && (
                <p role="alert" className="text-[13px] text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={submitting} className="mt-2">
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
            <Separator className="my-6" />
            <p className="text-center text-[12.5px] text-muted-foreground">
              Single-admin studio — invites and SSO arrive in later stages.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AnimatedWaveform() {
  const bars = Array.from({ length: 48 }, (_, i) => i);
  return (
    <svg
      viewBox="0 0 480 160"
      className="h-40 w-[480px]"
      role="img"
      aria-label="Podstudio"
    >
      {bars.map((i) => {
        const height = 20 + Math.abs(Math.sin(i * 0.5)) * 100;
        const color = i % 2 === 0 ? "var(--speaker-host)" : "var(--speaker-guest)";
        return (
          <rect
            key={i}
            x={i * 10}
            y={80 - height / 2}
            width={5}
            height={height}
            rx={2}
            fill={color}
          >
            <animate
              attributeName="height"
              values={`${height};${height * 0.4};${height}`}
              dur={`${1.2 + (i % 5) * 0.15}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="y"
              values={`${80 - height / 2};${80 - (height * 0.4) / 2};${80 - height / 2}`}
              dur={`${1.2 + (i % 5) * 0.15}s`}
              repeatCount="indefinite"
            />
          </rect>
        );
      })}
    </svg>
  );
}
