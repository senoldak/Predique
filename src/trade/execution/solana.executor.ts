import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { isValidSolanaAddress } from '../../utils/sanitize.js';

export interface SolanaSwapParams {
  tokenAddress: string;
  amountSol: number;
  slippageBps: number;
  rpcUrl?: string;
}

export interface SolanaSwapResult {
  status: 'SUCCESS' | 'FAILED';
  txHash: string;
  tokensExpected?: number;
  error?: string;
}

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_API = 'https://quote-api.jup.ag/v6/swap';

export async function fetchJupiterQuote(
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  slippageBps: number
): Promise<any> {
  const url = `${JUPITER_QUOTE_API}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Jupiter quote failed with HTTP ${res.status}: ${errorText}`);
  }
  const text = await res.text();
  return JSON.parse(text);
}

export async function fetchJupiterSwapTransaction(
  quoteResponse: any,
  userPublicKey: string
): Promise<string> {
  const res = await fetch(JUPITER_SWAP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      prioritizationFeeLamports: 'auto',
    }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Jupiter swap transaction build failed with HTTP ${res.status}: ${errorText}`);
  }
  const text = await res.text();
  const data = JSON.parse(text) as { swapTransaction?: string };
  if (!data?.swapTransaction) {
    throw new Error('Jupiter swap API response did not contain swapTransaction');
  }
  return data.swapTransaction;
}

export async function executeSolanaSwap(
  keypair: Keypair,
  params: SolanaSwapParams,
  connectionOverride?: Connection
): Promise<SolanaSwapResult> {
  if (!isValidSolanaAddress(params.tokenAddress)) {
    throw new Error(`Invalid Solana tokenAddress: ${params.tokenAddress}`);
  }
  if (!Number.isFinite(params.amountSol) || params.amountSol <= 0) {
    throw new Error(`Invalid amountSol: ${params.amountSol}. Must be a positive number.`);
  }
  if (!Number.isInteger(params.slippageBps) || params.slippageBps < 10 || params.slippageBps > 5000) {
    throw new Error(`Invalid slippageBps: ${params.slippageBps}. Must be between 10 and 5000.`);
  }

  const amountLamports = Math.round(params.amountSol * 1e9);
  const quote = await fetchJupiterQuote(
    WSOL_MINT,
    params.tokenAddress,
    amountLamports,
    params.slippageBps
  );

  const swapTxBase64 = await fetchJupiterSwapTransaction(quote, keypair.publicKey.toBase58());
  const swapTransactionBuf = Buffer.from(swapTxBase64, 'base64');
  const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

  transaction.sign([keypair]);

  const connection = connectionOverride || new Connection(params.rpcUrl || 'https://api.mainnet-beta.solana.com', 'confirmed');
  const rawTx = transaction.serialize();

  const txHash = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    maxRetries: 3,
  });

  await connection.confirmTransaction(txHash, 'confirmed');

  return {
    status: 'SUCCESS',
    txHash,
    tokensExpected: Number(quote.outAmount) || undefined,
  };
}
