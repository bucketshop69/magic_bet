import type { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

interface SolanaProviderLike {
  isPhantom?: boolean;
  publicKey?: PublicKey;
  providers?: SolanaProviderLike[];
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
}

declare global {
  interface Window {
    solana?: SolanaProviderLike;
    phantom?: {
      solana?: SolanaProviderLike;
    };
  }
}

export {};
