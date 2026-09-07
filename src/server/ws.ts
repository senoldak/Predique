import { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

export interface WebSocketManager {
  broadcast: (event: string, data: unknown, channel?: string) => void;
  broadcastToChannel: (channel: string, event: string, data: unknown) => void;
  getSubscribersCount: (channel?: string) => number;
  close: () => void;
  wss: WebSocketServer;
}

const MAX_WS_PER_IP = 10;
const ipConnections = new Map<string, number>();

function getWsIp(req: import('node:http').IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function createWebSocketServer(server: HttpServer): WebSocketManager {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();
  const clientIps = new Map<WebSocket, string>();
  const subscriptions = new Map<WebSocket, Set<string>>();

  wss.on('connection', (ws: WebSocket, req) => {
    const ip = getWsIp(req);
    const currentCount = ipConnections.get(ip) || 0;

    if (currentCount >= MAX_WS_PER_IP) {
      console.warn(`security blocked: ws connection rejected for ip=${ip} (limit=${MAX_WS_PER_IP} exceeded)`);
      ws.close(1008, 'Max connections per IP exceeded');
      return;
    }

    ipConnections.set(ip, currentCount + 1);
    clientIps.set(ws, ip);
    clients.add(ws);
    subscriptions.set(ws, new Set<string>(['*'])); // default subscribe to wildcard all

    ws.send(
      JSON.stringify({
        type: 'CONNECTED',
        timestamp: Date.now(),
        message: 'Predique Swarm WebSocket connection established',
        channels: ['*'],
      })
    );

    ws.on('message', (rawData) => {
      try {
        const text = rawData.toString();
        const msg = JSON.parse(text);

        if (msg.type === 'PING') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
          }
          return;
        }

        if (msg.type === 'SUBSCRIBE' && msg.channel) {
          const subs = subscriptions.get(ws) || new Set<string>();
          subs.add(String(msg.channel).toLowerCase());
          subscriptions.set(ws, subs);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'SUBSCRIBED',
              channel: msg.channel,
              activeChannels: Array.from(subs),
              timestamp: Date.now(),
            }));
          }
          return;
        }

        if (msg.type === 'UNSUBSCRIBE' && msg.channel) {
          const subs = subscriptions.get(ws);
          if (subs) {
            subs.delete(String(msg.channel).toLowerCase());
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'UNSUBSCRIBED',
                channel: msg.channel,
                activeChannels: Array.from(subs),
                timestamp: Date.now(),
              }));
            }
          }
          return;
        }
      } catch {
        // Ignore malformed incoming JSON
      }
    });

    const cleanupWs = () => {
      clients.delete(ws);
      subscriptions.delete(ws);
      const ip = clientIps.get(ws);
      if (ip) {
        clientIps.delete(ws);
        const count = ipConnections.get(ip) || 1;
        if (count <= 1) {
          ipConnections.delete(ip);
        } else {
          ipConnections.set(ip, count - 1);
        }
      }
    };

    ws.on('close', cleanupWs);
    ws.on('error', cleanupWs);
  });

  const broadcastToChannel = (channel: string, event: string, data: unknown) => {
    const payload = JSON.stringify({ type: event, channel, data, timestamp: Date.now() });
    const target = channel.toLowerCase();
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        const subs = subscriptions.get(client);
        if (subs && (subs.has('*') || subs.has(target))) {
          client.send(payload);
        }
      }
    }
  };

  const broadcast = (event: string, data: unknown, channel?: string) => {
    if (channel) {
      broadcastToChannel(channel, event, data);
      return;
    }
    const payload = JSON.stringify({ type: event, data, timestamp: Date.now() });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };

  return {
    broadcast,
    broadcastToChannel,
    getSubscribersCount: (channel?: string) => {
      if (!channel) return clients.size;
      const target = channel.toLowerCase();
      let count = 0;
      for (const subs of subscriptions.values()) {
        if (subs.has('*') || subs.has(target)) count++;
      }
      return count;
    },
    close: () => {
      for (const client of clients) {
        try { client.terminate(); } catch {}
      }
      clients.clear();
      subscriptions.clear();
      wss.close();
    },
    wss,
  };
}
