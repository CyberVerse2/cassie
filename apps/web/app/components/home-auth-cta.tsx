"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLogin, usePrivy } from "@privy-io/react-auth";

export function HomeAuthCta() {
  const router = useRouter();
  const { authenticated, ready } = usePrivy();
  const [error, setError] = useState<string | null>(null);
  const { login } = useLogin({
    onComplete: () => router.push("/onboarding"),
    onError: (code) => setError(`Twitter login failed: ${code}`),
  });

  function continueWithTwitter() {
    setError(null);
    if (!ready) return;
    if (authenticated) {
      router.push("/onboarding");
      return;
    }
    login({ loginMethods: ["twitter"] });
  }

  return (
    <div className="auth-cta">
      <button type="button" className="btn btn-x" onClick={continueWithTwitter} disabled={!ready}>
        <span>{ready ? "Continue with Twitter" : "Loading"}</span>
        <svg className="x-logo" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        <span className="arrow" aria-hidden>→</span>
      </button>
      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}
