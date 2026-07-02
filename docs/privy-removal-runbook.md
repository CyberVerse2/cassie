# Privy removal runbook

Privy now runs in overlap mode: better-auth cookies + Circle deposit wallets are
live alongside Privy auth and Privy embedded wallets. This runbook is the final
step — run it only when the preconditions hold.

## Preconditions

1. `NEXT_PUBLIC_BETTER_AUTH_ENABLED=1` has been on long enough that all active
   users have an X-cookie session (check `auth_sessions`).
2. Legacy rows are matched: no `user_settings` row with `settings.x.userId`
   null that still has activity (else first backfill from `profile.handle`).
3. Privy embedded-wallet balances are drained: for every row with
   `privy_wallet_id`, `PrivyAdapter.getUsdcBalanceUsd` ≈ 0 — users move funds
   out via the dashboard Withdraw card (`/api/withdraw`), or long-tail funds
   are accepted as user-recoverable via Privy's export (`exportKeys` flow).
4. All open positions opened under the Privy funding mode are closed (their
   close refunds go on-chain to the Privy wallet address).

## Removal checklist

- Web: remove `PrivyProvider` from `apps/web/app/providers.tsx`, Privy hooks in
  `apps/web/app/lib/use-cassie-account.ts` (`usePrivy`, `useWallets`,
  `useSigners`, `useExportWallet`, `getAccessToken` fetch paths), `useLogin` in
  `apps/web/app/components/home-auth-cta.tsx`, and the
  `NEXT_PUBLIC_BETTER_AUTH_ENABLED` flag (cookie auth becomes the only path).
- API: remove the Privy Bearer fallback in
  `packages/adapters/auth/session.ts` (`authenticatePrivyRequest` branch) and
  the Privy branch in `apps/web/app/api/session/sync/route.ts`.
- Money layer: remove the `privy_wallet` funding mode from
  `packages/jobs/execution-job.ts` (keep only `internal_ledger` +
  `FundingRouter`), the on-chain refund path in
  `packages/positions/close.ts` (`refundClosedPosition`), and
  `prefundTreasurySpend`/`refundPrefundedSpend`.
- Adapter: delete `packages/adapters/privy/`, drop `@privy-io/node` and
  `@privy-io/react-auth` from package.json.
- Config: remove `readPrivyEnv`/`assertPrivyEnv`/`assertPrivySettlementEnv` and
  the `privy` key from `CassieRuntimeConfig` in `packages/core/config.ts`;
  delete `PRIVY_*`, `NEXT_PUBLIC_PRIVY_*` from `.env.example` and deploy env.
- Store: remove `syncPrivyUser`/`getUserSettingsByPrivyUserId` from
  `CassieStore`, `DrizzleCassieStore`, and `InMemoryCassieStore`.
- Schema: migration `0017_drop_privy.sql` dropping
  `user_settings.privy_user_id`, `user_settings.privy_wallet_id`, and their
  indexes (`user_settings_privy_user_idx`, `user_settings_privy_wallet_idx`).
  Keep `wallet_address` only if still used for display. Keep existing
  `user_id` values (Privy DIDs) — they are opaque identifiers, not lookups.
- Tests: delete `tests/privy.test.ts`; strip Privy mocks/fixtures
  (`privyUserId`/`privyWalletId`) from money-flow tests; keep
  `tests/funding-router.test.ts` as the canonical execution-funding suite.

## Note on user identity

`user_settings.user_id` keeps its historical Privy-DID values forever — they
are primary keys referenced by positions, tickets, and the ledger. Only the
lookup columns and the Privy API dependency are removed.
