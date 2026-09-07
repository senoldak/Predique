export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghDgPump',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctemphxqWNmCc',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

export function getRandomJitoTipAccount(): string {
  const index = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
  return JITO_TIP_ACCOUNTS[index];
}

export function getProtectedEvmRpc(chain: 'BASE' | 'ETH' | 'BNB' | 'ROBINHOOD'): string {
  const c = chain.toUpperCase();
  if (c === 'ETH') {
    return 'https://rpc.flashbots.net/fast';
  }
  if (c === 'BASE') {
    return 'https://mainnet.base.org';
  }
  if (c === 'BNB') {
    return 'https://bsc-dataseed.binance.org';
  }
  return 'https://mainnet.base.org';
}

const JITO_BLOCK_ENGINE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

export async function sendJitoBundle(serializedTransactions: string[]): Promise<string> {
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [serializedTransactions],
  };

  const res = await fetch(JITO_BLOCK_ENGINE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Jito block engine error HTTP ${res.status}`);
  }

  const data = (await res.json()) as { result?: string; error?: { message: string } };
  if (data.error) {
    throw new Error(`Jito bundle error: ${data.error.message}`);
  }

  return data.result || 'bundle_submitted';
}
