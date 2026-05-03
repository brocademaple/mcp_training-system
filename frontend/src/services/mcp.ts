import api from './api';
import type { ApiResponse, MCPContext } from '@/types';

export interface MCPSessionEvent {
  seq: number;
  ts: string;
  kind: 'system' | 'user' | 'mcp';
  phase?: number;
  text?: string;
  mcp?: {
    type: string;
    from: string;
    to: string;
    action: string;
    payload_preview?: string;
  };
}

export const mcpService = {
  getSessionContext: async (sessionID: string): Promise<ApiResponse<MCPContext>> => {
    return api.get(`/mcp/session/${encodeURIComponent(sessionID)}`);
  },

  /** 拉取 Redis 中持久化的 MCP 会话事件（含真实 MCP 消息），after 为上次最大 seq */
  getSessionEvents: async (
    sessionID: string,
    after: number
  ): Promise<{ events: MCPSessionEvent[]; next_after: number }> => {
    const res = (await api.get(`/mcp/session/${encodeURIComponent(sessionID)}/events`, {
      params: { after },
    })) as ApiResponse<{ events: MCPSessionEvent[]; next_after: number }>;
    return {
      events: res.data?.events ?? [],
      next_after: res.data?.next_after ?? after,
    };
  },

  /** 用户侧操作写入会话流（须与 X-Session-ID 一致） */
  postUserEvent: async (sessionID: string, phase: number, message: string): Promise<number | undefined> => {
    const res = (await api.post(`/mcp/session/${encodeURIComponent(sessionID)}/events/user`, {
      phase,
      message,
    })) as ApiResponse<{ seq: number }>;
    return res.data?.seq;
  },

  buildSessionEventsStreamUrl: (sessionID: string, after = 0): string => {
    const q = new URLSearchParams({ after: String(after) });
    return `/api/v1/mcp/session/${encodeURIComponent(sessionID)}/events/stream?${q.toString()}`;
  },
};
