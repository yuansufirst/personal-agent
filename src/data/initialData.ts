import type {
  BriefingItem,
  ChatMessage,
  ConnectionConfig,
  MeshFileItem,
  MeshNode,
  QuickMacro,
  ReminderItem,
} from '../types/relay';

export const BRIEFING_IMAGES = {
  paperSystems: '/src/assets/images/briefing_paper_systems_1795619568605.jpg',
  newsDesk: '/src/assets/images/briefing_news_desk_1795619568085.jpg',
  brandEmblem: '/src/assets/images/relay_brand_emblem_1795619570533.jpg',
};

export const DEFAULT_CONNECTION_CONFIG: ConnectionConfig = {
  mode: 'dsh-bridge',
  serverUrl: 'https://izn4adpsp65vta6oli1hhcz.tail6e132f.ts.net/agent',
  wsEndpoint: '/api/remote.mux',
  token: '',
  model: 'deepseek-reasoner',
  workspace: '9000111a-7d73-453e-b69d-16d9b271a9f3',
  rpcMethod: 'session/prompt',
  sessionId: '',
  ntfyUrl: 'http://100.64.0.10:8085',
  ntfyTopic: 'relay-reminders',
};

export const INITIAL_MESH_NODES: MeshNode[] = [
  {
    id: 'node-cloud',
    role: 'cloud',
    name: '云服务器 · DeepSeek Harness',
    tailscaleIp: 'izn4adpsp65vta6oli1hhcz.tail6e132f.ts.net',
    os: 'Ubuntu 24.04 LTS',
    online: true,
    latencyMs: 28,
    activeService: 'Tailscale HTTPS · /agent/api/remote.mux',
  },
  {
    id: 'node-pc',
    role: 'pc',
    name: '个人工作站 PC',
    tailscaleIp: '100.64.0.21',
    os: 'Windows 11 / WSL2',
    online: true,
    latencyMs: 14,
    activeService: 'Taildrive · SSH · File Bridge',
  },
  {
    id: 'node-android',
    role: 'android',
    name: '主力手机 Android',
    tailscaleIp: '100.64.0.35',
    os: 'Android 15',
    online: true,
    latencyMs: 9,
    activeService: 'Termux:API · Local Controller',
  },
];

export const INITIAL_BRIEFINGS: BriefingItem[] = [
  {
    id: 'brief-paper-1',
    kind: 'paper',
    title: 'Long-Horizon Personal Agents with Episodic Memory Graphs',
    source: 'arXiv cs.AI',
    identifier: 'arXiv:2611.04821',
    publishedAt: '今天 08:15',
    readMinutes: 5,
    imageUrl: BRIEFING_IMAGES.paperSystems,
    summary:
      '提出基于情景记忆图的跨设备个人 Agent 架构，将用户的日程、文件系统变动与移动端上下文压缩为可检索的时间图谱，在 30 天连续个人任务基准中将误触发率降低 42%。',
    takeaways: [
      '采用双层记忆：工作记忆保留 48 小时工具状态，情景图谱按实体与设备节点建立索引。',
      '引入主动干预阈值（Proactive Gate），避免在专注时段打断用户，仅推送高价值卡片。',
      '开源了轻量级 SQLite 向量索引实现，单核云服务器内存占用低于 180 MB。',
    ],
    relevanceNote: '非常适合接入你当前的 DeepSeek Harness 记忆插件，优化每日提醒与跨设备文件检索。',
    saved: true,
    url: 'https://arxiv.org/abs/2611.04821',
  },
  {
    id: 'brief-news-1',
    kind: 'news',
    title: '每日科技速览：端云协同 Agent 协议与本地 Tailnet 工具更新',
    source: '晨间技术汇总',
    identifier: '今日 6 条精选',
    publishedAt: '今天 08:00',
    readMinutes: 3,
    imageUrl: BRIEFING_IMAGES.newsDesk,
    summary:
      '梳理过去 24 小时值得关注的 3 项进展：开源 Agent 前端事件流协议更新流式审批组件规范；Tailscale 移动端优化低功耗保活策略；DeepSeek Harness 社区发布多端文件同步插件 v0.4。',
    takeaways: [
      'DeepSeek Harness 社区新增异步任务卡片标准字段，便于移动端直接渲染批准/延后按钮。',
      'Tailscale Android 后台 DERP 心跳间隔优化，长期开启内网隧道续航影响降低约 18%。',
      '本地文档索引工具支持增量解析 PDF 与 Markdown，适合自动整理电脑下载目录。',
    ],
    relevanceNote: '已为你过滤掉重复资讯，保留与你自托管设备网和个人效率最相关的 3 条。',
    saved: false,
    url: 'https://github.com/deepseek-ai/deepseek-harness',
  },
  {
    id: 'brief-paper-2',
    kind: 'paper',
    title: 'Steering Interactive Tool Loops: Interruptible Execution for Autonomous Assistants',
    source: 'arXiv cs.HC',
    identifier: 'arXiv:2611.04109',
    publishedAt: '昨天 21:40',
    readMinutes: 4,
    summary:
      '研究了用户在移动场景下对长耗时 Agent 任务的“半途插话（Steering）”交互模式，证明细粒度审批卡片比纯文本确认对话减少 61% 的往返输入。',
    takeaways: [
      '将高风险系统操作（删文件、发外部消息）自动挂起为结构化审批卡片。',
      '允许用户在任务执行中发送增量指令，而无需中断已完成的上下文收集步骤。',
    ],
    relevanceNote: '对应你远程操控个人电脑执行批处理脚本时的安全确认流程。',
    saved: false,
    url: 'https://arxiv.org/abs/2611.04109',
  },
];

export const INITIAL_REMINDERS: ReminderItem[] = [
  {
    id: 'rem-1',
    title: '同步本周项目周报并整理 PC 端会议纪要',
    dueLabel: '今天 18:30',
    dayGroup: 'today',
    repeat: '每周五',
    priority: 'high',
    channel: 'ntfy',
    completed: false,
    note: 'Agent 可提前从 PC /Documents/Notes 汇总本周提交记录。',
  },
  {
    id: 'rem-2',
    title: '阅读 arXiv 2611.04821 记忆图谱章节并记录批注',
    dueLabel: '今天 21:00',
    dayGroup: 'today',
    priority: 'normal',
    channel: 'browser',
    completed: false,
  },
  {
    id: 'rem-3',
    title: '检查云服务器 Tailscale 证书与备份脚本日志',
    dueLabel: '明天 09:30',
    dayGroup: 'tomorrow',
    repeat: '每月 26 日',
    priority: 'normal',
    channel: 'ntfy',
    completed: false,
  },
  {
    id: 'rem-4',
    title: '归档电脑桌面临时 PDF 到知识库目录',
    dueLabel: '本周日 15:00',
    dayGroup: 'week',
    priority: 'normal',
    channel: 'app',
    completed: true,
  },
];

export const INITIAL_FILES: MeshFileItem[] = [
  {
    id: 'file-1',
    name: '2026-11-25-晨间论文摘要.md',
    size: '18.4 KB',
    sourceNode: 'cloud',
    targetNode: 'android',
    path: '~/dsh-workspace/digests/2026-11-25.md',
    updatedAt: '08:16',
    status: 'synced',
    previewText:
      '# 晨间论文摘要 (2026-11-25)\n\n## 1. Episodic Memory Graphs\n- 关键点：双层记忆结构 + 主动干预阈值\n- 可落地建议：在 DeepSeek Harness 中为提醒任务加入静默时段规则。',
  },
  {
    id: 'file-2',
    name: 'Q4_架构评审草案.pdf',
    size: '2.4 MB',
    sourceNode: 'pc',
    targetNode: 'cloud',
    path: 'D:/Workspace/Docs/Q4_架构评审草案.pdf',
    updatedAt: '昨天 22:10',
    status: 'ready',
    previewText: 'PDF 文档（28 页）。可让 Agent 提取第 3 节的接口清单与性能指标汇总。',
  },
  {
    id: 'file-3',
    name: 'android_clipboard_log.txt',
    size: '4.2 KB',
    sourceNode: 'android',
    targetNode: 'pc',
    path: '/sdcard/Relay/clipboard_log.txt',
    updatedAt: '10 分钟前',
    status: 'synced',
    previewText: 'https://github.com/deepseek-ai/deepseek-harness\nTailscale Serve 端口映射记录：8080 -> 443',
  },
];

export const QUICK_MACROS: QuickMacro[] = [
  {
    id: 'macro-1',
    label: '拉取 PC 剪贴板',
    targetRole: 'pc',
    command: '/pc clipboard get',
    description: '读取个人电脑当前剪贴板并同步到手机',
  },
  {
    id: 'macro-2',
    label: '生成今日论文简报',
    targetRole: 'cloud',
    command: '/digest papers --limit 3',
    description: '抓取 arXiv 最新论文并输出结构化精读卡',
  },
  {
    id: 'macro-3',
    label: '整理电脑下载目录',
    targetRole: 'pc',
    command: '/pc organize ~/Downloads --dry-run',
    description: '按文档/图片/安装包分类并先生成审批卡片',
  },
  {
    id: 'macro-4',
    label: '手机切换专注静音',
    targetRole: 'android',
    command: '/android dnd enable --duration 90m',
    description: '通过本地 Android 控制器开启 90 分钟专注模式',
  },
];

export const SLASH_COMMANDS = [
  { cmd: '/digest', hint: '生成今日新闻与论文交互卡片' },
  { cmd: '/remind', hint: '创建一条带推送提醒的日程卡片' },
  { cmd: '/pc', hint: '向个人电脑派发工作或文件同步任务' },
  { cmd: '/files', hint: '列出 Tailscale 设备网最近文件' },
  { cmd: '/android', hint: '触发 Android 手机本地控制动作' },
  { cmd: '/new', hint: '开启新的 DeepSeek Harness 对话会话' },
];

export const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'msg-welcome',
    role: 'assistant',
    timestamp: '08:20',
    content:
      '早上好。Tailscale 设备网状态正常，我已按你的关注列表整理好今天的论文与科技简报，并准备了一条需要你确认的个人电脑整理任务。你可以直接点击卡片操作，或输入 `/` 调用快捷命令。',
    cards: [
      { type: 'briefing', data: INITIAL_BRIEFINGS[0] },
      {
        type: 'approval',
        data: {
          id: 'appr-init-1',
          title: '同步并归档 PC 端桌面论文 PDF',
          targetDevice: '个人工作站 PC (100.64.0.21)',
          commandPreview: 'mv ~/Desktop/*.pdf ~/Knowledge/Papers/2026-11/ && relay-sync --to cloud',
          impactNote: '共检测到 4 份未归档 PDF（总计 14.8 MB），不涉及删除操作。',
          status: 'pending',
        },
      },
    ],
  },
];
