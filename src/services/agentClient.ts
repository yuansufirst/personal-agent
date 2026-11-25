import { BRIEFING_IMAGES } from '../data/initialData';
import type {
  ChatMessage,
  ConnectionConfig,
  InteractiveCard,
} from '../types/relay';
import { streamDshMuxReply, testDshWebSocket } from './dshMuxClient';

export interface AgentReplyChunk {
  text: string;
  cards?: InteractiveCard[];
  done?: boolean;
}

/**
 * Parses ```relay-card ... ``` JSON blocks returned by a live DeepSeek Harness
 * or OpenAI-compatible agent so custom server responses render native interactive cards.
 */
export function extractRelayCards(rawText: string): {
  cleanText: string;
  cards: InteractiveCard[];
} {
  const cards: InteractiveCard[] = [];
  const blockRegex = /```relay-card\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(rawText)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && typeof parsed === 'object' && parsed.type && parsed.data) {
        cards.push(parsed as InteractiveCard);
      }
    } catch {
      // Ignore partial JSON while streaming
    }
  }

  const cleanText = rawText.replace(blockRegex, '').trim();
  return { cleanText, cards };
}

export async function testServerConnection(
  config: ConnectionConfig
): Promise<{ ok: boolean; latencyMs: number; message: string; rawFrame?: string }> {
  if (config.mode === 'sandbox') {
    return {
      ok: true,
      latencyMs: 12,
      message: '本地交互体验模式已就绪，可随时切换为 Tailscale 真实服务器地址。',
    };
  }

  if (config.mode === 'dsh-bridge') {
    return testDshWebSocket(config);
  }

  const base = config.serverUrl.replace(/\/$/, '');
  if (!base) {
    return { ok: false, latencyMs: 0, message: '请先填写服务器地址（支持 Tailscale IP 或 MagicDNS）。' };
  }

  const started = performance.now();
  try {
    const testUrl = `${base}/v1/models`;
    const headers: Record<string, string> = {};
    if (config.token.trim()) {
      headers['Authorization'] = `Bearer ${config.token.trim()}`;
    }

    const res = await fetch(testUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(6000),
    });
    const latencyMs = Math.round(performance.now() - started);

    if (res.ok) {
      return {
        ok: true,
        latencyMs,
        message: `连接成功（HTTP ${res.status}），延迟 ${latencyMs} ms。`,
      };
    }
    return {
      ok: false,
      latencyMs,
      message: `服务器已响应 HTTP ${res.status}，请检查鉴权 Token 或路径配置。`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const reason = err instanceof Error ? err.message : '网络请求失败';
    return {
      ok: false,
      latencyMs,
      message: `无法直连目标地址（${reason}）。若通过 Tailscale 访问，请确认手机已开启 Tailscale 且服务端开启了 CORS 或 Tailscale Serve HTTPS。`,
    };
  }
}

export async function sendNtfyNotification(
  config: ConnectionConfig,
  title: string,
  body: string
): Promise<{ ok: boolean; detail: string }> {
  const base = config.ntfyUrl.replace(/\/$/, '');
  const topic = config.ntfyTopic.trim();
  if (!base || !topic) {
    return { ok: false, detail: '未配置 ntfy 服务地址或主题。' };
  }

  try {
    const res = await fetch(`${base}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        Title: title,
        Priority: 'default',
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return { ok: true, detail: `已通过 ntfy (${topic}) 推送到手机通知栏。` };
    }
    return { ok: false, detail: `ntfy 返回 HTTP ${res.status}` };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : '无法连接 ntfy 服务',
    };
  }
}

function buildSandboxResponse(prompt: string): {
  text: string;
  cards: InteractiveCard[];
} {
  const lower = prompt.toLowerCase();
  const idSuffix = Date.now().toString(36);

  if (lower.includes('论文') || lower.includes('paper') || lower.includes('/digest') || lower.includes('新闻')) {
    return {
      text: '已为你检索今天最新的研究与科技动态，整理成交互卡片。你可以直接展开核心要点，或点击收藏归档到简报页。',
      cards: [
        {
          type: 'briefing',
          data: {
            id: `brief-gen-${idSuffix}`,
            kind: lower.includes('新闻') ? 'news' : 'paper',
            title: lower.includes('新闻')
              ? '午间科技雷达：端侧 Android Agent 与轻量文件同步进展'
              : 'Adaptive Context Routing for Multi-Device Personal Assistants',
            source: lower.includes('新闻') ? '科技日报汇总' : 'arXiv cs.CL',
            identifier: lower.includes('新闻') ? '即时抓取 · 4 条' : 'arXiv:2611.05104',
            publishedAt: '刚刚',
            readMinutes: 4,
            imageUrl: lower.includes('新闻')
              ? BRIEFING_IMAGES.newsDesk
              : BRIEFING_IMAGES.paperSystems,
            summary: lower.includes('新闻')
              ? '汇总过去 6 小时高关注动态：轻量级 WebSocket 多路复用协议降低移动端断线重连耗时；主流 Android 自动化框架新增剪贴板隐私白名单。'
              : '针对手机、PC 与云服务器三端协同场景，提出按设备算力与网络延迟自动切分上下文的路由策略，端到端响应速度提升 37%。',
            takeaways: [
              '将高频轻指令（提醒、静音、查剪贴板）在边缘节点快速闭环，长文档分析路由至云端模型。',
              '卡片化结构输出使移动端阅读效率提升 2.1 倍，减少长段落翻屏。',
            ],
            relevanceNote: '与你当前的 Tailscale 三端协同高度契合，可作为下一版路由优化参考。',
            saved: false,
            url: 'https://arxiv.org/abs/2611.05104',
          },
        },
      ],
    };
  }

  if (lower.includes('提醒') || lower.includes('日程') || lower.includes('/remind') || lower.includes('明天') || lower.includes('点')) {
    const cleanedTitle = prompt
      .replace(/^\/remind\s*/i, '')
      .replace(/^(帮我)?(设置|创建|添加)?(一个)?提醒(我)?[:：]?\s*/i, '')
      .trim() || '整理个人工作站待办清单';

    return {
      text: '已解析你的时间与事项，生成一条可交互提醒卡片。你可以直接勾选完成、延后，或一键同步进提醒中心（支持 ntfy 推送）。',
      cards: [
        {
          type: 'reminder',
          data: {
            id: `rem-gen-${idSuffix}`,
            title: cleanedTitle,
            dueLabel: lower.includes('明天') ? '明天 09:00' : '今天 20:00',
            dayGroup: lower.includes('明天') ? 'tomorrow' : 'today',
            priority: lower.includes('重要') || lower.includes('紧急') ? 'high' : 'normal',
            channel: 'ntfy',
            completed: false,
            note: '由对话中枢自动创建，可点击卡片同步至日程表。',
          },
        },
      ],
    };
  }

  if (lower.includes('文件') || lower.includes('传输') || lower.includes('读取') || lower.includes('/files')) {
    return {
      text: '已扫描 Tailscale 设备网上的个人电脑工作目录，找到目标文件并准备好传输通道。点击下方卡片可直接预览内容或继续追问。',
      cards: [
        {
          type: 'file',
          data: {
            id: `file-gen-${idSuffix}`,
            name: 'weekly_experiment_report.md',
            size: '42.6 KB',
            sourceNode: 'pc',
            targetNode: 'android',
            path: 'D:/Workspace/Reports/weekly_experiment_report.md',
            updatedAt: '刚刚',
            status: 'ready',
            previewText:
              '# 实验周报摘要\n- 推理延迟：P95 下降至 410ms\n- 跨设备文件同步成功率：99.6%\n- 待办：补充移动端语音指令快捷入口。',
          },
        },
      ],
    };
  }

  if (lower.includes('电脑') || lower.includes('pc') || lower.includes('控制') || lower.includes('手机') || lower.includes('/pc') || lower.includes('/android')) {
    const isAndroid = lower.includes('手机') || lower.includes('/android') || lower.includes('静音');
    return {
      text: `已准备好向 ${isAndroid ? 'Android 手机节点' : '个人工作站 PC'} 下发操作指令。为保证安全，执行前请先在下方审批卡片中确认。`,
      cards: [
        {
          type: 'approval',
          data: {
            id: `appr-gen-${idSuffix}`,
            title: isAndroid ? '触发 Android 本地自动化动作' : '在个人电脑执行远程工作流',
            targetDevice: isAndroid
              ? '主力手机 Android (100.64.0.35)'
              : '个人工作站 PC (100.64.0.21)',
            commandPreview: isAndroid
              ? 'termux-volume ring 0 && termux-toast "Relay：已开启专注静音"'
              : prompt.startsWith('/') ? prompt : 'pwsh -Command "Get-Clipboard | Out-File ~/relay_clip.txt"',
            impactNote: '仅影响目标设备的当前状态或指定工作目录，全程经 Tailscale 加密通道传输。',
            status: 'pending',
          },
        },
      ],
    };
  }

  return {
    text: `收到你的指令：“${prompt}”。\n\n当前处于本地交互体验模式——你可以直接试试发送：\n1. 「帮我推送今天的 AI 论文和科技新闻」\n2. 「提醒我明天上午 9 点发周报」\n3. 「读取我电脑上的最新周报文件」\n4. 「帮我把手机调成专注静音」\n\n点击右上角「连接配置」填入你的 Tailscale 服务器地址或 DeepSeek Harness 桥接通道后，所有对话与卡片都会实时直连你的真实 Agent。`,
    cards: [],
  };
}

export async function streamAgentReply(
  prompt: string,
  history: ChatMessage[],
  config: ConnectionConfig,
  onChunk: (chunk: AgentReplyChunk) => void,
  signal?: AbortSignal
): Promise<void> {
  if (config.mode === 'sandbox') {
    const simulated = buildSandboxResponse(prompt);
    let accumulated = '';
    const chars = Array.from(simulated.text);

    for (let i = 0; i < chars.length; i += 3) {
      if (signal?.aborted) return;
      accumulated += chars.slice(i, i + 3).join('');
      onChunk({ text: accumulated, done: false });
      await new Promise((r) => setTimeout(r, 18));
    }

    onChunk({ text: simulated.text, cards: simulated.cards, done: true });
    return;
  }

  const base = config.serverUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.token.trim()) {
    headers['Authorization'] = `Bearer ${config.token.trim()}`;
  }

  if (config.mode === 'openai-compatible') {
    const apiMessages = [
      {
        role: 'system',
        content:
          'You are a personal agent connected to Relay mobile hub over Tailscale. When returning structured briefings, reminders, file transfers, or command approvals, you may optionally append a ```relay-card JSON block.',
      },
      ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: prompt },
    ];

    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model || 'deepseek-reasoner',
        messages: apiMessages,
        stream: true,
      }),
      signal,
    });

    if (!res.ok) {
      throw new Error(`服务端返回 HTTP ${res.status}，请检查连接配置与 Token。`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let rawFull = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              rawFull += delta;
              const { cleanText, cards } = extractRelayCards(rawFull);
              onChunk({ text: cleanText, cards, done: false });
            }
          } catch {
            // Skip malformed SSE chunks
          }
        }
      }

      const { cleanText, cards } = extractRelayCards(rawFull);
      onChunk({ text: cleanText || '（已完成执行）', cards, done: true });
      return;
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || JSON.stringify(data);
    const { cleanText, cards } = extractRelayCards(rawContent);
    onChunk({ text: cleanText, cards, done: true });
    return;
  }

  // DeepSeek Harness (dsh) WebSocket /api/remote.mux client-request RPC
  return streamDshMuxReply(prompt, config, onChunk, signal);
}
