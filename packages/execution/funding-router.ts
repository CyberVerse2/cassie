import { CircleWalletAdapter } from "../adapters/circle/index.ts";
import { config } from "../core/config.ts";
import type { CassieStore } from "../core/db/store.ts";
import type {
  Chain,
  ExecutionJob,
  TradeTicket,
} from "../core/schemas/index.ts";

export const VENUE_CHAINS: Record<string, Chain> = {
  hyperliquid: "arbitrum",
  polymarket: "polygon",
};

export type TreasuryFundingGateway = {
  getTreasuryWalletId(): string;
  getUsdcBalanceOnChain(input: { walletId: string; chain: Chain }): Promise<number>;
};

export function venueChainForTicket(ticket: TradeTicket): Chain {
  return VENUE_CHAINS[ticket.venue] ?? config.circle.defaultChain;
}

// Real-execution venue funding: verifies the treasury holds USDC on the
// venue's settlement chain (kept liquid via the Gateway unified balance) and
// records the allocation. The user's prefund transfer into the treasury is
// handled by the execution job itself; simulated (paper) execution skips this
// router entirely because no venue settlement happens.
export class FundingRouter {
  constructor(
    private readonly circle: TreasuryFundingGateway = new CircleWalletAdapter(),
  ) {}

  async ensureVenueUsdc(input: {
    store: CassieStore;
    ticket: TradeTicket;
    job: ExecutionJob;
  }): Promise<{ venueChain: Chain }> {
    const { store, ticket, job } = input;
    const venueChain = venueChainForTicket(ticket);
    const amountUsd = ticket.sizeUsd;

    const treasuryWalletId = this.circle.getTreasuryWalletId();
    const treasuryBalanceUsd = await this.circle.getUsdcBalanceOnChain({
      walletId: treasuryWalletId,
      chain: venueChain,
    });
    if (treasuryBalanceUsd < amountUsd) {
      throw new Error(
        `Treasury holds $${treasuryBalanceUsd.toFixed(2)} USDC on ${venueChain} but the ticket needs $${amountUsd.toFixed(2)}. Mint USDC on ${venueChain} from the Gateway unified balance.`,
      );
    }

    await store.recordGatewayMint({
      ticket,
      job,
      amountUsd,
      chain: venueChain,
      metadata: { treasuryWalletId, treasuryBalanceUsd },
    });

    return { venueChain };
  }
}
