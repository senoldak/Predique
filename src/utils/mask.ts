export function maskToken(token: string): string {
  if (!token || typeof token !== 'string' || token.length < 10) {
    return '**********';
  }
  const prefix = token.slice(0, 6);
  const suffix = token.slice(-4);
  return `${prefix}${'*'.repeat(Math.max(6, token.length - 10))}${suffix}`;
}
