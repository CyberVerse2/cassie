import { CircleWalletAdapter } from "../adapters/circle/index.ts";
import { config } from "../core/config.ts";
import type { CassieStore } from "../core/db/store.ts";
import type {
  Chain,
  ExecutionFundingSource,
  ExecutionJob,
  TradeTicket,
} from "../core/schemas/index.ts";

export const VENUE_CHAINS: Record<string, Chain> = {
  hyperliquid: "arbitrum",
  polymarket: "polygon",
};

export type TreasuryFundingGateway = {
  getTreasuryWalletAddress(chain: Chain): string;
  getTreasuryWalletId(): string;
  getUsdcBalanceOnChain(input: { walletId: string; chain: Chain }): Promise<number>;
};

export function venueChainForTicket(ticket: TradeTicket): Chain {
  return VENUE_CHAINS[ticket.venue] ?? config.circle.defaultChain;
}

// Funds a trade for internal-ledger (Circle) users: debits the user's credited
// balance and allocates treasury USDC on the venue's chain. The Gateway
// unified balance keeps the treasury liquid across chains; this router only
// verifies and records the venue-chain allocation.
export class FundingRouter {
  constructor(
    private readonly circle: TreasuryFundingGateway = new CircleWalletAdapter(),
  ) {}

  async ensureVenueUsdc(input: {
    store: CassieStore;
    ticket: TradeTicket;
    job: ExecutionJob;
    walletBalanceUsd: number;
  }): Promise<ExecutionFundingSource> {
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

    await store.recordWalletPrefund({
      ticket,
      job,
      amountUsd,
      walletBalanceUsd: input.walletBalanceUsd,
      metadata: { source: "internal_ledger", venueChain },
    });
    await store.recordGatewayMint({
      ticket,
      job,
      amountUsd,
      chain: venueChain,
      metadata: { treasuryWalletId, treasuryBalanceUsd },
    });

    return {
      type: "cassie_treasury",
      userId: ticket.userId,
      treasuryWalletAddress: this.circle.getTreasuryWalletAddress(venueChain),
      prefundTransferId: `ledger:${job.jobId}`,
      prefundTransferStatus: "succeeded",
      amountUsd,
      chain: venueChain,
      venueChain,
    };
  }
}
