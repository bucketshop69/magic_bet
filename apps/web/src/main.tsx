import React from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { TrustWalletAdapter } from "@solana/wallet-adapter-trust";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { APP_CONFIG } from "./lib/config";
import { applyLcdThemeTokens } from "./theme/tokens";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./styles.css";

// Anchor/web3 rely on Node-like globals in browser runtimes.
(window as any).Buffer = Buffer;
(window as any).global = window;
(window as any).process = (window as any).process ?? { env: {} };
applyLcdThemeTokens();

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new CoinbaseWalletAdapter(),
  new TrustWalletAdapter(),
];

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={APP_CONFIG.l1RpcUrl}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>
);
