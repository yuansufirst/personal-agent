import type { InteractiveCard, MapCardItem } from '../types/relay';

/**
 * Full 5-card protocol prompt for teaching a live cloud Agent (DeepSeek Harness / OpenAI-compatible)
 * to output structured ```relay-card blocks that Relay renders natively.
 */
export const RELAY_CARDS_PROTOCOL_PROMPT = `请将以下「Relay 移动端交互卡片协议」记住并写入长期偏好：当你的回复涉及以下 5 类场景时，请在正常文字回复末尾附加对应的 \`\`\`relay-card 代码块（合法 JSON，可输出单个对象或数组），前端会自动渲染为可交互卡片。

1. 高德地图与出行路线卡片（用户问想去哪里、查地点、查路线、高德 POI 规划时优先输出，坐标请直接使用高德 GCJ-02 经纬度）：
\`\`\`relay-card
{
  "type": "map",
  "data": {
    "id": "map-001",
    "title": "目的地名称",
    "address": "高德详细地址",
    "lat": 31.2397,
    "lng": 121.4998,
    "zoom": 14,
    "coordSystem": "gcj02",
    "origin": { "label": "出发点（可选）", "lat": 31.2304, "lng": 121.4737 },
    "travelMode": "transit",
    "distanceText": "4.2 km",
    "durationText": "18 分钟",
    "routeSummary": "地铁 2 号线直达 · 陆家嘴站 1 号口步行 400m",
    "overview": "简要概括该地点环境、周边特点与路线情况",
    "highlights": ["高德实时路况畅通", "地铁口步行 5 分钟"],
    "openHours": "全天开放"
  }
}
\`\`\`

2. 论文 / 新闻简报卡片（type: "briefing"）：
\`\`\`relay-card
{
  "type": "briefing",
  "data": {
    "id": "brief-001",
    "kind": "paper",
    "title": "标题",
    "source": "arXiv cs.AI",
    "identifier": "arXiv:2611.04821",
    "publishedAt": "今天 08:30",
    "readMinutes": 4,
    "summary": "一句话核心结论",
    "takeaways": ["要点 1", "要点 2"],
    "relevanceNote": "与当前研究的关联",
    "saved": false,
    "url": "https://arxiv.org/abs/..."
  }
}
\`\`\`

3. 日常提醒 / 日程卡片（type: "reminder"）：
\`\`\`relay-card
{
  "type": "reminder",
  "data": {
    "id": "rem-001",
    "title": "提醒事项",
    "dueLabel": "明天 09:00",
    "dayGroup": "tomorrow",
    "priority": "high",
    "channel": "ntfy",
    "completed": false,
    "note": "补充说明"
  }
}
\`\`\`

4. 远程指令审批卡片（需要经云端 → Tailscale 下发至个人电脑执行命令前确认，type: "approval"）：
\`\`\`relay-card
{
  "type": "approval",
  "data": {
    "id": "appr-001",
    "title": "在个人电脑执行整理任务",
    "targetDevice": "个人工作站 PC (Tailscale)",
    "commandPreview": "ls -la ~/Downloads",
    "impactNote": "仅读取目录，不删除文件",
    "status": "pending"
  }
}
\`\`\`

5. 跨设备文件卡片（电脑/云端文件预览与传输，type: "file"）：
\`\`\`relay-card
{
  "type": "file",
  "data": {
    "id": "file-001",
    "name": "weekly_report.md",
    "size": "32 KB",
    "sourceNode": "pc",
    "targetNode": "android",
    "path": "D:/Workspace/weekly_report.md",
    "updatedAt": "刚刚",
    "status": "ready",
    "previewText": "文件前几行摘要..."
  }
}
\`\`\`

规则：JSON 必须严格合法、不含注释；每次可按需输出 1 张或多张卡片。`;

const VALID_CARD_TYPES = new Set([
  'briefing',
  'reminder',
  'approval',
  'file',
  'map',
  'device-action',
]);

function normalizeCard(raw: unknown): InteractiveCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type.trim() : '';
  if (!VALID_CARD_TYPES.has(type) || !obj.data || typeof obj.data !== 'object') {
    return null;
  }

  if (type === 'map') {
    const d = obj.data as Record<string, unknown>;
    const lat = Number(d.lat);
    const lng = Number(d.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const normalized: MapCardItem = {
      id: String(d.id || `map-${Date.now().toString(36)}`),
      title: String(d.title || '目标地点'),
      address: typeof d.address === 'string' ? d.address : undefined,
      lat,
      lng,
      zoom: typeof d.zoom === 'number' && Number.isFinite(d.zoom) ? d.zoom : 14,
      coordSystem: d.coordSystem === 'wgs84' ? 'wgs84' : 'gcj02',
      origin:
        d.origin &&
        typeof d.origin === 'object' &&
        Number.isFinite(Number((d.origin as Record<string, unknown>).lat)) &&
        Number.isFinite(Number((d.origin as Record<string, unknown>).lng))
          ? {
              label: String((d.origin as Record<string, unknown>).label || '出发地'),
              lat: Number((d.origin as Record<string, unknown>).lat),
              lng: Number((d.origin as Record<string, unknown>).lng),
            }
          : undefined,
      waypoints: Array.isArray(d.waypoints)
        ? d.waypoints
            .filter(
              (w): w is Record<string, unknown> =>
                Boolean(w && typeof w === 'object') &&
                Number.isFinite(Number((w as Record<string, unknown>).lat)) &&
                Number.isFinite(Number((w as Record<string, unknown>).lng))
            )
            .map((w) => ({
              label: String(w.label || '途经点'),
              lat: Number(w.lat),
              lng: Number(w.lng),
              kind:
                w.kind === 'origin' || w.kind === 'destination' || w.kind === 'stop'
                  ? w.kind
                  : 'stop',
              note: typeof w.note === 'string' ? w.note : undefined,
            }))
        : undefined,
      polyline: Array.isArray(d.polyline)
        ? d.polyline.filter(
            (pt): pt is [number, number] =>
              Array.isArray(pt) &&
              pt.length >= 2 &&
              Number.isFinite(Number(pt[0])) &&
              Number.isFinite(Number(pt[1]))
          )
        : undefined,
      travelMode:
        d.travelMode === 'transit' ||
        d.travelMode === 'driving' ||
        d.travelMode === 'walking' ||
        d.travelMode === 'cycling'
          ? d.travelMode
          : 'transit',
      distanceText: typeof d.distanceText === 'string' ? d.distanceText : undefined,
      durationText: typeof d.durationText === 'string' ? d.durationText : undefined,
      routeSummary: typeof d.routeSummary === 'string' ? d.routeSummary : undefined,
      overview: String(d.overview || d.description || d.summary || '高德地点与路线概览'),
      highlights: Array.isArray(d.highlights)
        ? d.highlights.map((h) => String(h)).filter(Boolean)
        : undefined,
      openHours: typeof d.openHours === 'string' ? d.openHours : undefined,
    };
    return { type: 'map', data: normalized };
  }

  return obj as unknown as InteractiveCard;
}

/**
 * Parses ```relay-card ... ``` (and forgiving ```relay_card / structured ```json card blocks)
 * plus ```relay-action ... ``` blocks returned by a live DeepSeek Harness or OpenAI-compatible agent.
 */
export function extractRelayCards(rawText: string): {
  cleanText: string;
  cards: InteractiveCard[];
} {
  const cards: InteractiveCard[] = [];
  const blocksToStrip: string[] = [];

  const cardRegex = /```(?:relay[-_]card|json)\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = cardRegex.exec(rawText)) !== null) {
    const fullMatch = match[0];
    const isExplicitRelayBlock = /^```relay[-_]card/i.test(fullMatch);
    const body = match[1].trim();
    try {
      const parsed = JSON.parse(body);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      let matchedAny = false;
      for (const item of items) {
        const normalized = normalizeCard(item);
        if (normalized) {
          cards.push(normalized);
          matchedAny = true;
        }
      }
      if (matchedAny || isExplicitRelayBlock) {
        blocksToStrip.push(fullMatch);
      }
    } catch {
      // Ignore incomplete JSON while streaming, but hide explicit relay-card fence once started
      if (isExplicitRelayBlock) {
        blocksToStrip.push(fullMatch);
      }
    }
  }

  const actionRegex = /```relay[-_]action\s*([\s\S]*?)```/gi;
  let actionIdx = 0;
  while ((match = actionRegex.exec(rawText)) !== null) {
    blocksToStrip.push(match[0]);
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && typeof parsed === 'object' && typeof parsed.action === 'string') {
        cards.push({
          type: 'device-action',
          data: {
            id: `dev-act-${actionIdx++}-${parsed.action}`,
            action: parsed.action,
            title: String(parsed.title || '手机设备操作'),
            summary: String(parsed.summary || ''),
            params:
              parsed.params && typeof parsed.params === 'object'
                ? (parsed.params as Record<string, unknown>)
                : {},
            status: 'pending',
          },
        });
      }
    } catch {
      // Ignore partial JSON while streaming
    }
  }

  let cleanText = rawText;
  for (const block of blocksToStrip) {
    cleanText = cleanText.replace(block, '');
  }
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
  return { cleanText, cards };
}

export interface CardQuickTrigger {
  key: 'map' | 'briefing' | 'reminder' | 'file' | 'approval';
  label: string;
  shortHint: string;
  tint: string;
  promptPrefix: string;
  protocolHint: string;
}

export const INTERACTIVE_CARD_TRIGGERS: CardQuickTrigger[] = [
  {
    key: 'map',
    label: '高德地图',
    shortHint: '地点与路线概览',
    tint: 'var(--tint-cyan)',
    promptPrefix: '我想去 ',
    protocolHint:
      '请结合高德地图 POI 与路线信息回答，并在末尾附带一个 ```relay-card (type: "map", coordSystem: "gcj02") JSON 卡片，包含 lat/lng、路线耗时距离和简明地图概览。',
  },
  {
    key: 'briefing',
    label: '论文简报',
    shortHint: '精读要点卡片',
    tint: 'var(--tint-blue)',
    promptPrefix: '帮我整理今天的论文/新闻简报：',
    protocolHint:
      '请在回复末尾附带 ```relay-card (type: "briefing") JSON 卡片。',
  },
  {
    key: 'reminder',
    label: '日程提醒',
    shortHint: '可勾选与延后',
    tint: 'var(--tint-amber)',
    promptPrefix: '提醒我 ',
    protocolHint:
      '请在回复末尾附带 ```relay-card (type: "reminder") JSON 卡片。',
  },
  {
    key: 'file',
    label: '设备文件',
    shortHint: '电脑/云端预览',
    tint: 'var(--tint-emerald)',
    promptPrefix: '读取我电脑(Tailscale)上的文件：',
    protocolHint:
      '请在回复末尾附带 ```relay-card (type: "file") JSON 卡片。',
  },
  {
    key: 'approval',
    label: '电脑审批',
    shortHint: '确认后远程执行',
    tint: 'var(--tint-rose)',
    promptPrefix: '准备在我的电脑(Tailscale)上执行：',
    protocolHint:
      '执行前请先在回复末尾附带 ```relay-card (type: "approval") JSON 审批卡片待我确认。',
  },
];

/**
 * Generates an instant local preview set containing all 5 interactive cards
 * (Briefing, Reminder, Approval, File, and Amap Map) so the user can inspect and test them anytime.
 */
export function buildFiveCardsShowcase(): InteractiveCard[] {
  const ts = Date.now().toString(36);
  return [
    {
      type: 'map',
      data: {
        id: `map-demo-${ts}`,
        title: '上海外滩 · 观景平台',
        address: '上海市黄浦区中山东一路（近南京东路）',
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
            note: '步行约 7 分钟直达江边',
          },
        ],
        travelMode: 'transit',
        distanceText: '2.1 km',
        durationText: '14 分钟',
        routeSummary: '地铁 2 号线（1 站）→ 南京东路站 2 号口步行 550m',
        overview:
          '从人民广场向东沿南京东路直达黄浦江畔，全程地势平坦；傍晚 18:00–20:30 陆家嘴天际线亮灯视角最佳，高德实时人流偏高建议从 2 号口绕行九江路进入。',
        highlights: ['高德 GCJ-02 精准定位', '地铁直达免换乘', '支持一键唤起高德导航'],
        openHours: '全天开放 · 18:00 亮灯',
      },
    },
    {
      type: 'briefing',
      data: {
        id: `brief-demo-${ts}`,
        kind: 'paper',
        title: 'Adaptive Context Routing for Hybrid-Tunnel Personal Agents',
        source: 'arXiv cs.AI',
        identifier: 'arXiv:2611.05104',
        publishedAt: '今天 08:30',
        readMinutes: 4,
        summary:
          '针对手机经公网隧道直连云端、云端再经内网 Mesh 协同个人电脑的混合架构，提出按延迟与算力动态分流上下文的路由方案。',
        takeaways: [
          '移动端直接通过边缘隧道接入，消除手机常驻 VPN 带来的续航损耗。',
          '高耗时文件分析与本地命令仍由云端安全路由至 PC 内网节点闭环。',
        ],
        relevanceNote: '与你当前的 Cloudflare Tunnel（手机）+ Tailscale（电脑）混合架构完全一致。',
        saved: false,
        url: 'https://arxiv.org/abs/2611.05104',
      },
    },
    {
      type: 'reminder',
      data: {
        id: `rem-demo-${ts}`,
        title: '整理本周实验记录并同步到云端知识库',
        dueLabel: '今天 21:00',
        dayGroup: 'today',
        repeat: '每周五',
        priority: 'high',
        channel: 'ntfy',
        completed: false,
        note: '支持直接勾选完成、延后 30 分钟或同步到目标提醒列表。',
      },
    },
    {
      type: 'file',
      data: {
        id: `file-demo-${ts}`,
        name: 'experiment_ablation_summary.md',
        size: '36.8 KB',
        sourceNode: 'pc',
        targetNode: 'android',
        path: 'D:/Workspace/Research/experiment_ablation_summary.md',
        updatedAt: '刚刚',
        status: 'ready',
        previewText:
          '# 消融实验汇总\n- Baseline: 78.4%\n- +Context Routing: 84.1% (+5.7%)\n- 移动端平均首字延迟: 420ms',
      },
    },
    {
      type: 'approval',
      data: {
        id: `appr-demo-${ts}`,
        title: '归档个人电脑桌面 PDF 至论文库',
        targetDevice: '个人工作站 PC (Tailscale 100.64.0.21)',
        commandPreview: 'mv ~/Desktop/*.pdf ~/Knowledge/Papers/2026-11/',
        impactNote: '仅移动桌面 3 份 PDF 文件，不涉及删除操作；确认后由云端经 Tailscale 下发至电脑。',
        status: 'pending',
      },
    },
  ];
}
