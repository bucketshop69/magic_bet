export const APP_CONFIG = {
  l1RpcUrl:
    import.meta.env.VITE_L1_RPC_URL ?? "https://api.devnet.solana.com",
  crankHttpUrl:
    import.meta.env.VITE_CRANK_HTTP_URL ?? "http://127.0.0.1:8787",
  wsUrl: import.meta.env.VITE_WS_URL ?? "ws://127.0.0.1:8787/ws",
  programId:
    import.meta.env.VITE_PROGRAM_ID ??
    "DXaehEyGPBunzm3X5p3tCwcZVhx9dX8mnU7cfekvm5D2",
};
