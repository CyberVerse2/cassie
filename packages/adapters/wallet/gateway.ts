import { ChainSchema, type Chain } from "../../core/schemas/index.ts";

export { ChainSchema, type Chain };

export const SUPPORTED_CHAINS = ChainSchema.options;

export type UsdcTransfer = {
  transferId: string;
  referenceId: string;
  status: "pending" | "succeeded" | "rejected" | "failed";
  sourceWalletId: string;
  destinationAddress: string;
  amountUsd: number;
  asset: "usdc";
  chain: Chain;
  createdAt: string;
  raw: unknown;
};

export type TreasuryTransferInput = {
  userWalletId: string;
  amountUsd: number;
  referenceId: string;
  chain: Chain;
};

export type TreasuryRefundInput = {
  userWalletAddress: string;
  amountUsd: number;
  referenceId: string;
  chain: Chain;
};

export interface WalletGateway {
  getUsdcBalanceUsd(input: { walletId: string }): Promise<number>;
  getTreasuryWalletAddress(chain: Chain): string;
  transferUserUsdcToTreasury(input: TreasuryTransferInput): Promise<UsdcTransfer>;
  refundUserUsdcFromTreasury(input: TreasuryRefundInput): Promise<UsdcTransfer>;
}
