import { BRIEFING_IMAGES } from '../data/initialData';
import type {
  AgentToolStep,
  ChatAttachment,
  ChatMessage,
  ConnectionConfig,
  InteractiveCard,
} from '../types/relay';
import {
  streamDshMuxReply,
  testDshWebSocket,
  type StreamDshOptions,
} from './dshMuxClient';

import {
  extractRelayCards,
  RELAY_CARDS_PROTOCOL_PROMPT,
} from './cardProtocol';

export { extractRelayCards };

export interface AgentReplyChunk {
  text: string;
  cards?: InteractiveCard[];
  thinking?: string;
  toolSteps?: AgentToolStep[];
  elapsedMs?: number;
  done?: boolean;
}

export async function testServerConnection(
  config: ConnectionConfig
): Promise<{ ok: boolean; latencyMs: number; message: string; rawFrame?: string }> {
  if (config.mode === 'sandbox') {
    return {
      ok: true,
      latencyMs: 12,
      message: '本地交互体验模式已就绪，可随时切换为 Cloudflare Tunnel 云端域名。',
    };
  }

  if (config.mode === 'dsh-bridge') {
    return testDshWebSocket(config);
  }

  const base = config.serverUrl.replace(/\/$/, '');
  if (!base) {
    return { ok: false, latencyMs: 0, message: '请先填写服务器地址（支持 Cloudflare Tunnel 自定义 HTTPS 域名）。' };
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
      signal: AbortSignal.timeout(8000),
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
      message: `服务器已响应 HTTP ${res.status}，请检查鉴权 Token、Cloudflare Access 或路径配置。`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const reason = err instanceof Error ? err.message : '网络请求失败';
    return {
      ok: false,
      latencyMs,
      message: `无法直连目标地址（${reason}）。请确认 Cloudflare Tunnel 域名解析正常且源站已放行 CORS。`,
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

  if (
    lower.includes('地图') ||
    lower.includes('想去') ||
    lower.includes('怎么去') ||
    lower.includes('路线') ||
    lower.includes('导航') ||
    lower.includes('/map')
  ) {
    const destName =
      prompt
        .replace(/^\/map\s*/i, '')
        .replace(/^(我想去|帮我查|怎么去|导航到|去)\s*/i, '')
        .replace(/[？?。！!].*$/, '')
        .trim() || '上海外滩 · 观景平台';

    return {
      text: `已结合高德地图为你规划前往「${destName}」的位置与路线概览。你可以在下方地图卡片中直接缩放查看周边路网，或一键唤起高德 App 导航。`,
      cards: [
        {
          type: 'map',
          data: {
            id: `map-gen-${idSuffix}`,
            title: destName,
            address: '上海市黄浦区中山东一路（高德 GCJ-02 示例坐标）',
            lat: 31.2397,
            lng: 121.4906,
            zoom: 14,
            coordSystem: 'gcj02',
            origin: {
              label: '人民广场地铁站',
              lat: 31.2328,
              lng: 121.4754,
            },
            waypoints: [
              {
                label: '南京东路站 2 号口',
                lat: 31.2381,
                lng: 121.4846,
                kind: 'stop',
                note: '步行约 7 分钟直达',
              },
            ],
            travelMode: 'transit',
            distanceText: '2.1 km',
            durationText: '14 分钟',
            routeSummary: '地铁 2 号线（1 站）→ 南京东路站 2 号口步行 550m',
            overview:
              '沿南京东路向东直达目的地，全程路网清晰且换乘少；接入云端真实高德 MCP 后，将实时返回你的真实出发地、高德 POI 经纬度与实时路况。',
            highlights: ['高德 GCJ-02 坐标', '地铁直达', '支持一键唤起高德 App'],
            openHours: '全天开放',
          },
        },
      ],
    };
  }

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
              ? '午间科技雷达：Cloudflare Tunnel 移动端直连与端侧 Agent 进展'
              : 'Adaptive Context Routing for Multi-Device Personal Assistants',
            source: lower.includes('新闻') ? '科技日报汇总' : 'arXiv cs.CL',
            identifier: lower.includes('新闻') ? '即时抓取 · 4 条' : 'arXiv:2611.05104',
            publishedAt: '刚刚',
            readMinutes: 4,
            imageUrl: lower.includes('新闻')
              ? BRIEFING_IMAGES.newsDesk
              : BRIEFING_IMAGES.paperSystems,
            summary: lower.includes('新闻')
              ? '汇总过去 6 小时高关注动态：手机通过 Cloudflare Tunnel 免 VPN 直连云端 Agent，结合云端到 PC 的 Tailscale 内网实现三端低功耗协同。'
              : '针对手机、PC 与云服务器三端协同场景，提出按设备算力与网络延迟自动切分上下文的路由策略，端到端响应速度提升 37%。',
            takeaways: [
              '手机端经 Cloudflare Tunnel 轻量接入，无需常驻 VPN；电脑端由云端经 Tailscale 安全联动。',
              '卡片化结构输出使移动端阅读效率提升 2.1 倍，减少长段落翻屏。',
            ],
            relevanceNote: '与你当前的 Cloudflare Tunnel（手机）+ Tailscale（电脑）混合架构高度契合。',
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
            note: '由对话中枢自动创建，可点击卡片同步至目标提醒。',
          },
        },
      ],
    };
  }

  if (lower.includes('文件') || lower.includes('传输') || lower.includes('读取') || lower.includes('/files')) {
    return {
      text: '已通过云端经 Tailscale 扫描个人电脑工作目录，找到目标文件并准备好传输通道。点击下方卡片可直接预览内容或继续追问。',
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
            title: isAndroid ? '触发 Android 本地原生动作' : '经 Tailscale 在个人电脑执行远程工作流',
            targetDevice: isAndroid
              ? '主力手机 Android (本地执行)'
              : '个人工作站 PC (Tailscale 100.64.0.21)',
            commandPreview: isAndroid
              ? 'android-dnd enable --duration 90m'
              : prompt.startsWith('/') ? prompt : 'pwsh -Command "Get-Clipboard | Out-File ~/relay_clip.txt"',
            impactNote: isAndroid
              ? '仅调整本机专注状态，直接由手机原生能力执行。'
              : '仅影响个人电脑指定工作目录，确认后由云端经 Tailscale 加密通道下发。',
            status: 'pending',
          },
        },
      ],
    };
  }

  return {
    text: `收到你的指令：“${prompt}”。\n\n当前处于本地交互体验模式——你可以点击输入框左侧的「交互卡片」图标，直接体验全部 5 种卡片（高德地图、论文简报、日程提醒、电脑文件、指令审批）。\n\n在设置中填入你的 Cloudflare Tunnel 云端域名后，所有对话与卡片都会实时直连你的真实 Agent。`,
    cards: [],
  };
}

export async function streamAgentReply(
  prompt: string,
  history: ChatMessage[],
  config: ConnectionConfig,
  onChunk: (chunk: AgentReplyChunk) => void,
  signal?: AbortSignal,
  options?: StreamDshOptions
): Promise<void> {
  const attachments = options?.attachments;

  if (config.mode === 'sandbox') {
    const simulated = buildSandboxResponse(prompt);
    const attachmentNote =
      attachments && attachments.length > 0
        ? `\n\n已收到附件：${attachments.map((a) => `${a.name} (${a.size})`).join('、')}。`
        : '';
    const finalText = `${simulated.text}${attachmentNote}`;
    let accumulated = '';
    const chars = Array.from(finalText);

    for (let i = 0; i < chars.length; i += 3) {
      if (signal?.aborted) return;
      accumulated += chars.slice(i, i + 3).join('');
      onChunk({ text: accumulated, done: false });
      await new Promise((r) => setTimeout(r, 18));
    }

    onChunk({ text: finalText, cards: simulated.cards, done: true });
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
    const textBlocks: string[] = [];
    const imageParts: { type: 'image_url'; image_url: { url: string } }[] = [];

    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (att.textContent) {
          textBlocks.push(`[附件文件: ${att.name}]\n\`\`\`\n${att.textContent.slice(0, 40000)}\n\`\`\``);
        } else if (att.mimeType.startsWith('image/') && att.dataUrl) {
          imageParts.push({ type: 'image_url', image_url: { url: att.dataUrl } });
        }
      }
    }

    const fullUserText = textBlocks.length > 0 ? `${prompt}\n\n${textBlocks.join('\n\n')}` : prompt;
    const userContent: unknown =
      imageParts.length > 0
        ? [{ type: 'text', text: fullUserText }, ...imageParts]
        : fullUserText;

    const priorHistory = history.slice(0, -1).slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const apiMessages = [
      {
        role: 'system',
        content: `You are a personal agent connected to Relay mobile hub via Cloudflare Tunnel (and connected to the user's PC via Tailscale). ${RELAY_CARDS_PROTOCOL_PROMPT}`,
      },
      ...priorHistory,
      { role: 'user', content: userContent },
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

  // DeepSeek Harness (dsh) HTTP unary + WebSocket /api/remote.mux
  return streamDshMuxReply(prompt, config, onChunk, signal, options);
}
