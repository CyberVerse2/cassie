"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useLogin, usePrivy } from "@privy-io/react-auth";

export function HomeAuthCta() {
  const router = useRouter();
  const { authenticated, getAccessToken, ready } = usePrivy();
  const [error, setError] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);
  const routeAuthenticatedUser = useCallback(async () => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error("Privy access token was not available.");
    }

    const response = await fetch("/api/account", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
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
  }, [getAccessToken, router]);
  const { login } = useLogin({
    onComplete: () => {
      void routeAuthenticatedUser().catch((caught) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    },
    onError: (code) => setError(`Twitter login failed: ${code}`),
  });

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
    login({ loginMethods: ["twitter"] });
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
