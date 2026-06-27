/**
 * AgentMessageBus — typed event bus for inter-agent communication.
 *
 * Supports:
 *   - Direct messages (agent A → agent B)
 *   - Broadcast messages (agent A → all)
 *   - Topic subscriptions (subscribe to all messages of a type)
 *   - Replay (read all unread messages on disconnect/reconnect)
 *
 * Inspired by `Leonxlnx/taste-skill` patterns for skill communication and
 * `Donchitos/Claude-Code-Game-Studios` for multi-agent coordination.
 */

import { randomUUID } from "crypto";
import { AgentMessage, AgentMessageType } from "./agentBase.js";

type Listener = (msg: AgentMessage) => void | Promise<void>;

export class AgentMessageBus {
  private directListeners = new Map<string, Set<Listener>>(); // agent name → listeners
  private topicListeners = new Map<AgentMessageType, Set<Listener>>();
  private history: AgentMessage[] = [];
  private maxHistory = 500;
  private subscribers = new Set<Listener>(); // for all-message broadcast

  /** Send a message to a specific agent */
  send(to: string, type: AgentMessageType, from: string, payload: Record<string, unknown>): AgentMessage {
    const msg: AgentMessage = {
      id: `msg_${randomUUID().slice(0, 8)}`,
      from,
      to,
      type,
      payload,
      timestamp: Date.now(),
      consumed: false,
    };
    this.dispatch(msg);
    return msg;
  }

  /** Broadcast a message to all subscribed agents */
  broadcast(type: AgentMessageType, from: string, payload: Record<string, unknown>): AgentMessage {
    return this.send("*", type, from, payload);
  }

  /** Subscribe an agent to receive messages addressed to it */
  subscribe(agentName: string, listener: Listener): () => void {
    if (!this.directListeners.has(agentName)) {
      this.directListeners.set(agentName, new Set());
    }
    this.directListeners.get(agentName)!.add(listener);
    return () => this.directListeners.get(agentName)?.delete(listener);
  }

  /** Subscribe to messages of a specific type (regardless of recipient) */
  subscribeToTopic(type: AgentMessageType, listener: Listener): () => void {
    if (!this.topicListeners.has(type)) {
      this.topicListeners.set(type, new Set());
    }
    this.topicListeners.get(type)!.add(listener);
    return () => this.topicListeners.get(type)?.delete(listener);
  }

  /** Subscribe to all messages (for monitoring/observability) */
  subscribeToAll(listener: Listener): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /** Get unread messages for a specific agent (for replay on reconnect) */
  getUnreadFor(agentName: string): AgentMessage[] {
    return this.history.filter(
      (m) => (m.to === agentName || m.to === "*") && !m.consumed
    );
  }

  /** Mark a message as consumed */
  markConsumed(messageId: string): void {
    const msg = this.history.find((m) => m.id === messageId);
    if (msg) msg.consumed = true;
  }

  /** Clear history (e.g. between pipeline runs) */
  clearHistory(): void {
    this.history = [];
  }

  /** Total messages ever sent (for debugging) */
  totalMessages(): number {
    return this.history.length;
  }

  private async dispatch(msg: AgentMessage): Promise<void> {
    this.history.push(msg);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    // Direct delivery
    if (msg.to !== "*") {
      const listeners = this.directListeners.get(msg.to);
      if (listeners) {
        for (const listener of listeners) {
          try { await listener(msg); } catch { /* listener errors don't crash the bus */ }
        }
      }
    }

    // Broadcast delivery
    if (msg.to === "*") {
      for (const [, listeners] of this.directListeners) {
        for (const listener of listeners) {
          try { await listener(msg); } catch { /* listener errors don't crash the bus */ }
        }
      }
    }

    // Topic-based delivery
    const topicListeners = this.topicListeners.get(msg.type);
    if (topicListeners) {
      for (const listener of topicListeners) {
        try { await listener(msg); } catch { /* listener errors don't crash the bus */ }
      }
    }

    // All-message subscribers (observability)
    for (const subscriber of this.subscribers) {
      try { await subscriber(msg); } catch { /* subscriber errors don't crash the bus */ }
    }
  }
}
