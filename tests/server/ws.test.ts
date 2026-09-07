import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createWebSocketServer, type WebSocketManager } from '../../src/server/ws.js';

describe('WebSocket Channel Subscription Protocol & Liveness', () => {
  let server: http.Server;
  let wsManager: WebSocketManager;
  let port: number;

  beforeAll(async () => {
    server = http.createServer();
    wsManager = createWebSocketServer(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr !== null) {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    wsManager.close();
    if (server && server.listening) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it('handles client connection, initial welcome handshake, and PING/PONG', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const messages: any[] = [];

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Wait for initial CONNECTED message
    await new Promise((r) => setTimeout(r, 60));
    expect(messages.some((m) => m.type === 'CONNECTED')).toBe(true);
    const connectedMsg = messages.find((m) => m.type === 'CONNECTED');
    expect(connectedMsg?.channels).toContain('*');

    // Send PING
    ws.send(JSON.stringify({ type: 'PING' }));
    await new Promise((r) => setTimeout(r, 60));

    const pong = messages.find((m) => m.type === 'PONG');
    expect(pong).toBeDefined();
    expect(pong.timestamp).toBeDefined();

    ws.close();
  });

  it('manages channel subscriptions and delivers targeted broadcasts only to subscribed clients', async () => {
    const wsSolana = new WebSocket(`ws://localhost:${port}/ws`);
    const wsBase = new WebSocket(`ws://localhost:${port}/ws`);

    const solanaMessages: any[] = [];
    const baseMessages: any[] = [];

    await Promise.all([
      new Promise<void>((res) => wsSolana.on('open', res)),
      new Promise<void>((res) => wsBase.on('open', res)),
    ]);

    wsSolana.on('message', (d) => solanaMessages.push(JSON.parse(d.toString())));
    wsBase.on('message', (d) => baseMessages.push(JSON.parse(d.toString())));

    // Unsubscribe from wildcard '*' and subscribe to specific channels
    wsSolana.send(JSON.stringify({ type: 'UNSUBSCRIBE', channel: '*' }));
    wsSolana.send(JSON.stringify({ type: 'SUBSCRIBE', channel: 'signals:solana' }));

    wsBase.send(JSON.stringify({ type: 'UNSUBSCRIBE', channel: '*' }));
    wsBase.send(JSON.stringify({ type: 'SUBSCRIBE', channel: 'signals:base' }));

    await new Promise((r) => setTimeout(r, 50));

    // Broadcast targeted solana signal
    wsManager.broadcastToChannel('signals:solana', 'SWARM_SIGNAL_NEW', { token: 'SOL_PEPE' });

    // Broadcast targeted base signal
    wsManager.broadcastToChannel('signals:base', 'SWARM_SIGNAL_NEW', { token: 'BASE_NECTAR' });

    await new Promise((r) => setTimeout(r, 60));

    const solanaReceived = solanaMessages.filter((m) => m.type === 'SWARM_SIGNAL_NEW');
    const baseReceived = baseMessages.filter((m) => m.type === 'SWARM_SIGNAL_NEW');

    expect(solanaReceived).toHaveLength(1);
    expect(solanaReceived[0].data.token).toBe('SOL_PEPE');
    expect(solanaReceived[0].channel).toBe('signals:solana');

    expect(baseReceived).toHaveLength(1);
    expect(baseReceived[0].data.token).toBe('BASE_NECTAR');
    expect(baseReceived[0].channel).toBe('signals:base');

    expect(wsManager.getSubscribersCount('signals:solana')).toBeGreaterThanOrEqual(1);

    wsSolana.close();
    wsBase.close();
  });
});