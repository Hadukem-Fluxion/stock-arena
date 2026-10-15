import type { Ticker } from "./config.js";

export type Asset = {
  symbol: `${Ticker}x`;
  token: `0x${string}`;
  wrapped: `0x${string}`;
  logo: string;
  pool?: `0x${string}`;
};

export const MANTLE_USDC = "0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9";

/** Public Mantle metadata; logo URLs come from the xStocks public assets API. */
export const ASSETS = {
  AAPL: {
    symbol: "AAPLx",
    token: "0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a",
    wrapped: "0x5aa7649fdbda47de64a07ac81d64b682af9c0724",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/AAPLx.png",
    pool: "0x2cc6a607f3445d826b9e29f507b3a2e3b9dae106",
  },
  MSFT: {
    symbol: "MSFTx",
    token: "0x5621737f42dae558b81269fcb9e9e70c19aa6b35",
    wrapped: "0x63ad27614231767c8c489745b9145272de50d09b",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/MSFTx.png",
  },
  GOOGL: {
    symbol: "GOOGLx",
    token: "0xe92f673ca36c5e2efd2de7628f815f84807e803f",
    wrapped: "0x1630f08370917e79df0b7572395a5e907508bbbc",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/GOOGLx.png",
    pool: "0x66960ed892daf022c5f282c5316c38cb6f0c1333",
  },
  AMZN: {
    symbol: "AMZNx",
    token: "0x3557ba345b01efa20a1bddc61f573bfd87195081",
    wrapped: "0xac85d37acbadca37545e21ab0fb991bce8c1187c",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/AMZNx.png",
  },
  META: {
    symbol: "METAx",
    token: "0x96702be57cd9777f835117a809c7124fe4ec989a",
    wrapped: "0x4e41a262caa93c6575d336e0a4eb79f3c67caa06",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/METAx.png",
    pool: "0x782bd3895a6ac561d0df11b02dd6f9e023f3a497",
  },
  NVDA: {
    symbol: "NVDAx",
    token: "0xc845b2894dbddd03858fd2d643b4ef725fe0849d",
    wrapped: "0x93e62845c1dd5822ebc807ab71a5fb750decd15a",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/NVDAx.png",
    pool: "0xa875ac23d106394d1baaae5bc42b951268bc04e2",
  },
  TSLA: {
    symbol: "TSLAx",
    token: "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0",
    wrapped: "0x43680abf18cf54898be84c6ef78237cfbd441883",
    logo: "https://xstocks-metadata.backed.fi/logos/tokens/TSLAx.png",
    pool: "0x5e7935d70b5d14b6cf36fbde59944533fab96b3c",
  },
} as const satisfies Record<Ticker, Asset>;
