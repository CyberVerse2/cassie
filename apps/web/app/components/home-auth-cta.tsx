"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { authClient } from "../lib/auth-client";

export function HomeAuthCta() {
  const router = useRouter();
  // Privy is read-only here: existing Privy sessions still route to the
  // dashboard, but all new logins go through better-auth.
  const { authenticated: privyAuthenticated, getAccessToken } = usePrivy();
  const cookieSession = authClient.useSession();
  const [error, setError] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);

  const cookieAuthenticated = Boolean(cookieSession.data);
  const authenticated = cookieAuthenticated || privyAuthenticated;
  const ready = !cookieSession.isPending;

  const routeAuthenticatedUser = useCallback(async () => {
    let headers: Record<string, string> = {};
    if (!cookieAuthenticated && privyAuthenticated) {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error("Session was not available. Log in again.");
      }
      headers = { Authorization: `Bearer ${accessToken}` };
    }

    const response = await fetch("/api/account", { headers });
    if (response.ok) {
      router.push("/dashboard");
      return;
    }
    if (response.status === 404) {
      router.push("/onboarding");
      return;
    }

    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "Cassie account lookup failed.");
  }, [cookieAuthenticated, getAccessToken, privyAuthenticated, router]);

  async function continueWithTwitter() {
    setError(null);
    if (!ready) return;
    if (authenticated) {
      try {
        setRouting(true);
        await routeAuthenticatedUser();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setRouting(false);
      }
      return;
    }
    const { error: signInError } = await authClient.signIn.social({
      provider: "twitter",
      callbackURL: "/dashboard",
    });
    if (signInError) {
      setError(signInError.message ?? "Twitter login failed.");
    }
  }

  return (
    <div className="auth-cta">
      <button type="button" className="btn btn-x" onClick={continueWithTwitter} disabled={!ready || routing}>
        <span>{ready ? (authenticated ? (routing ? "Opening dashboard" : "Go to dashboard") : "Continue with") : "Loading"}</span>
        {!authenticated && (
          <svg className="x-logo" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        )}
        <span className="arrow" aria-hidden>→</span>
      </button>
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
