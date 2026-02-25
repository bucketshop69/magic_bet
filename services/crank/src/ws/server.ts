import { Server as HttpServer } from "node:http";
import WebSocket, { Server as WebSocketServer } from "ws";
import {
  RoundStateV1Event,
  RoundTransitionV1Event,
  SnapshotV1Event,
  WsServerEvent,
} from "./protocol";
import { parseClientMessage } from "./guards";

type GatewayOptions = {
  path: string;
  maxSubscriptionsPerSocket: number;
  maxConnectionsPerIpPerMin: number;
  log: any;
};

type RateBucket = { count: number; windowStartedAt: number };

const ONE_MINUTE_MS = 60_000;

export class RoundWsGateway {
  private readonly wss: WebSocketServer;
  private readonly topicSubscribers = new Map<string, Set<WebSocket>>();
  private readonly socketTopics = new Map<WebSocket, Set<string>>();
  private readonly latestSnapshotByTopic = new Map<string, SnapshotV1Event>();
  private readonly lastMoveCountByTopic = new Map<string, number>();
  private readonly ipRateBuckets = new Map<string, RateBucket>();

  constructor(private readonly options: GatewayOptions) {
    this.wss = new WebSocketServer({ noServer: true });
  }

  attach(server: HttpServer) {
    server.on("upgrade", (request, socket, head) => {
      const url = request.url ?? "";
      const pathname = url.split("?")[0] ?? "";
      if (pathname !== this.options.path) {
        socket.destroy();
        return;
      }

      const ip = this.getRemoteIp(request.socket.remoteAddress);
      if (!this.allowConnection(ip)) {
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(request, socket as any, head, (ws: WebSocket) => {
        this.wss.emit("connection", ws, request);
      });
    });

    this.wss.on("connection", (ws: WebSocket) => {
      this.socketTopics.set(ws, new Set());

      ws.on("message", (raw: WebSocket.Data) => {
        const text =
          typeof raw === "string" ? raw : (raw as Buffer).toString("utf8");
        const message = parseClientMessage(text);
        if (!message) {
          this.send(ws, {
            type: "error_v1",
            ts: Date.now(),
            code: "INVALID_MESSAGE",
            message: "Expected { type: 'subscribe', topic: 'round:<id>' }",
          });
          return;
        }

        const topics = this.socketTopics.get(ws);
        if (!topics) return;

        if (
          topics.size >= this.options.maxSubscriptionsPerSocket &&
          !topics.has(message.topic)
        ) {
          this.send(ws, {
            type: "error_v1",
            ts: Date.now(),
            code: "TOO_MANY_SUBSCRIPTIONS",
            message: "Exceeded per-socket subscription limit",
          });
          return;
        }

        topics.add(message.topic);
        const subscribers = this.topicSubscribers.get(message.topic) ?? new Set();
        subscribers.add(ws);
        this.topicSubscribers.set(message.topic, subscribers);

        this.send(ws, {
          type: "subscribed_v1",
          ts: Date.now(),
          topic: message.topic,
        });

        const snapshot = this.latestSnapshotByTopic.get(message.topic);
        if (snapshot) {
          this.send(ws, snapshot);
        }
      });

      ws.on("close", () => this.detachSocket(ws));
      ws.on("error", () => this.detachSocket(ws));
    });
  }

  publishRoundTransition(event: RoundTransitionV1Event) {
    this.broadcast(`round:${event.roundId}`, event);
  }

  publishRoundState(event: RoundStateV1Event) {
    const topic = `round:${event.roundId}`;
    const previous = this.latestSnapshotByTopic.get(topic)?.roundState;
    if (previous && event.moveCount < previous.moveCount) {
      return;
    }
    if (
      previous &&
      event.moveCount === previous.moveCount &&
      event.status === previous.status &&
      event.winner === previous.winner &&
      event.alphaScore === previous.alphaScore &&
      event.betaScore === previous.betaScore &&
      event.alphaAlive === previous.alphaAlive &&
      event.betaAlive === previous.betaAlive
    ) {
      return;
    }

    const lastMoveCount = this.lastMoveCountByTopic.get(topic) ?? -1;
    this.lastMoveCountByTopic.set(topic, Math.max(lastMoveCount, event.moveCount));
    this.latestSnapshotByTopic.set(topic, {
      type: "snapshot_v1",
      ts: Date.now(),
      topic,
      roundState: event,
    });
    this.broadcast(topic, event);
  }

  getStatus() {
    let subscriptions = 0;
    for (const set of this.topicSubscribers.values()) subscriptions += set.size;
    return {
      clients: this.wss.clients.size,
      topics: this.topicSubscribers.size,
      subscriptions,
      snapshots: this.latestSnapshotByTopic.size,
      path: this.options.path,
    };
  }

  private broadcast(topic: string, event: WsServerEvent) {
    const subscribers = this.topicSubscribers.get(topic);
    if (!subscribers || subscribers.size === 0) return;
    const payload = JSON.stringify(event);
    for (const ws of subscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  private send(ws: WebSocket, event: WsServerEvent) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(event));
  }

  private detachSocket(ws: WebSocket) {
    const topics = this.socketTopics.get(ws);
    if (!topics) return;
    for (const topic of topics) {
      const subscribers = this.topicSubscribers.get(topic);
      if (!subscribers) continue;
      subscribers.delete(ws);
      if (subscribers.size === 0) this.topicSubscribers.delete(topic);
    }
    this.socketTopics.delete(ws);
  }

  private allowConnection(ip: string): boolean {
    const now = Date.now();
    const bucket = this.ipRateBuckets.get(ip);
    if (!bucket || now - bucket.windowStartedAt > ONE_MINUTE_MS) {
      this.ipRateBuckets.set(ip, { count: 1, windowStartedAt: now });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= this.options.maxConnectionsPerIpPerMin;
  }

  private getRemoteIp(value: string | undefined): string {
    if (!value) return "unknown";
    if (value.startsWith("::ffff:")) return value.slice(7);
    return value;
  }
}
