import React, { useRef, useState } from 'react';
import {
  Check,
  Edit3,
  ExternalLink,
  Laptop,
  Link2,
  Server,
  Smartphone,
  Upload,
  X,
} from 'lucide-react';
import type {
  AgentProfile,
  BriefingItem,
  ConnectionConfig,
  DeviceContextConfig,
  MeshFileItem,
  MeshNode,
  QuickMacro,
} from '../types/relay';
import { DeviceHubView } from './DeviceHubView';
import { MuseAvatarHeader } from './MuseAvatarHeader';
import {
  ArrowUpRight,
  ArrowsClockwise,
  ComposerDeviceIcon,
  FeedBookmarkIcon,
  FileText,
  SpaceArchiveIcon,
  SpaceCloudIcon,
  SpaceDevicesIcon,
} from './AppIcons';

interface SpaceViewProps {
  config: ConnectionConfig;
  agentProfile?: AgentProfile;
  isVoiceActive?: boolean;
  onOpenDrawer?: () => void;
  onTapAvatar?: () => void;
  initialSubTab?: 'device' | 'environment' | 'library';
  deviceContextConfig: DeviceContextConfig;
  nodes: MeshNode[];
  macros: QuickMacro[];
  files: MeshFileItem[];
  briefings: BriefingItem[];
  selectedBriefing: BriefingItem | null;
  previewFile: MeshFileItem | null;
  isFetchingDigest: boolean;
  onUpdateDeviceContextConfig: (next: DeviceContextConfig) => void;
  onSendContextToAgent: (promptText: string) => void;
  onOpenConnection: () => void;
  onUpdateNodeIp: (nodeId: string, ip: string) => void;
  onRunMacro: (macro: QuickMacro) => void;
  onUploadLocalFile: (file: File) => void;
  onAskAboutFile: (file: MeshFileItem) => void;
  onSelectPreviewFile: (file: MeshFileItem | null) => void;
  onFetchFreshDigest: () => void;
  onToggleSaveBriefing: (item: BriefingItem) => void;
  onSelectBriefing: (item: BriefingItem | null) => void;
  onAskAboutBriefing: (item: BriefingItem) => void;
  onShowToast: (msg: string) => void;
}

type SpaceTab = 'device' | 'environment' | 'library';

export const SpaceView: React.FC<SpaceViewProps> = ({
  config,
  agentProfile,
  isVoiceActive = false,
  onOpenDrawer,
  onTapAvatar,
  initialSubTab = 'device',
  deviceContextConfig,
  nodes,
  macros,
  files,
  briefings,
  selectedBriefing,
  previewFile,
  isFetchingDigest,
  onUpdateDeviceContextConfig,
  onSendContextToAgent,
  onOpenConnection,
  onUpdateNodeIp,
  onRunMacro,
  onUploadLocalFile,
  onAskAboutFile,
  onSelectPreviewFile,
  onFetchFreshDigest,
  onToggleSaveBriefing,
  onSelectBriefing,
  onAskAboutBriefing,
  onShowToast,
}) => {
  const [subTab, setSubTab] = useState<SpaceTab>(initialSubTab);
  React.useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [ipDraft, setIpDraft] = useState('');
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const startEdit = (node: MeshNode) => {
    setEditingNodeId(node.id);
    setIpDraft(node.tailscaleIp);
  };

  const commitEdit = (nodeId: string) => {
    const clean = ipDraft.trim();
    if (clean) onUpdateNodeIp(nodeId, clean);
    setEditingNodeId(null);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-3 pb-28 sm:px-6 lg:pt-7 lg:pb-14 space-y-5">
      {/* Shared Muse Header — tapping circular AI avatar starts in-place voice */}
      <MuseAvatarHeader
        agentProfile={agentProfile}
        isVoiceActive={isVoiceActive}
        onOpenDrawer={onOpenDrawer}
        onTapAvatar={onTapAvatar}
      />

      {/* Symbol-Led Sub-Tab Switcher */}
      <div className="flex items-center justify-center">
        <div className="inline-flex items-center gap-1 rounded-full border border-black/[0.07] bg-white p-1 shadow-xs dark:border-white/10 dark:bg-zinc-900">
          {(
            [
              { key: 'device', label: '手机', Icon: ComposerDeviceIcon },
              { key: 'environment', label: '设备', Icon: SpaceDevicesIcon },
              { key: 'library', label: '归档', Icon: SpaceArchiveIcon },
            ] as {
              key: SpaceTab;
              label: string;
              Icon: React.FC<{ className?: string }>;
            }[]
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key)}
              className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subTab === key
                  ? 'bg-zinc-900 text-white shadow-xs dark:bg-zinc-100 dark:text-zinc-950'
                  : 'text-[var(--relay-text-muted)] hover:text-[var(--relay-text)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {subTab === 'device' ? (
        <DeviceHubView
          contextConfig={deviceContextConfig}
          onUpdateContextConfig={onUpdateDeviceContextConfig}
          onSendContextToAgent={onSendContextToAgent}
          onShowToast={onShowToast}
        />
      ) : subTab === 'environment' ? (
        <div className="space-y-5">
          {/* Active Agent Endpoint Tile */}
          <div className="muse-card flex flex-col gap-3 rounded-[24px] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800">
                <SpaceCloudIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[var(--relay-text-muted)]">
                  Cloudflare Tunnel · Tailscale
                </div>
                <div className="mt-0.5 truncate font-mono-tabular text-sm font-semibold text-[var(--relay-text)]">
                  {config.mode === 'sandbox'
                    ? 'Sandbox'
                    : config.serverUrl || '未配置'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenConnection}
              className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-full border border-black/[0.09] bg-zinc-50 px-3.5 text-xs font-medium text-[var(--relay-text)] hover:bg-zinc-100 whitespace-nowrap dark:border-white/15 dark:bg-white/10 dark:hover:bg-white/16"
            >
              <Link2 className="h-3.5 w-3.5 text-[var(--accent-sky)]" />
              <span>连接</span>
            </button>
          </div>

          {/* Hybrid Node Magnetic Tiles */}
          <div
            className="grid grid-cols-2 sm:grid-cols-3"
            style={{ gap: 'var(--relay-gap)' }}
          >
            {nodes.map((node, idx) => {
              const Icon =
                node.role === 'cloud'
                  ? Server
                  : node.role === 'pc'
                    ? Laptop
                    : Smartphone;
              const tint =
                node.role === 'cloud'
                  ? 'var(--tint-blue)'
                  : node.role === 'pc'
                    ? 'var(--tint-violet)'
                    : 'var(--tint-emerald)';
              const nodeAngles = ['162deg', '184deg', '172deg'];
              const isEditing = editingNodeId === node.id;
              const transportLabel =
                node.role === 'pc'
                  ? 'Tailscale 内网'
                  : node.role === 'cloud'
                    ? 'CF Tunnel + Tailscale'
                    : 'Cloudflare Tunnel';
              const canEditAddress = node.role === 'pc' || node.role === 'cloud';
              const displayAddress =
                node.role === 'cloud' && config.serverUrl
                  ? config.serverUrl.replace(/^https?:\/\//i, '')
                  : node.role === 'android'
                    ? '免 Tailscale · 域名直连'
                    : node.tailscaleIp;

              return (
                <div
                  key={node.id}
                  style={
                    {
                      '--tile-tint': tint,
                      '--tile-angle': nodeAngles[idx % nodeAngles.length],
                    } as React.CSSProperties
                  }
                  className="board-tile flex flex-col justify-between gap-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 text-[var(--relay-text)] dark:bg-white/10">
                      <Icon className="h-4 w-4" />
                    </div>
                    {!isEditing && canEditAddress && (
                      <button
                        type="button"
                        onClick={() => startEdit(node)}
                        aria-label="编辑地址"
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--relay-text-muted)] hover:bg-black/[0.05] hover:text-[var(--relay-text)] dark:hover:bg-white/10"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-[var(--relay-text)]">
                      {node.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--accent-sky)]">
                      {transportLabel}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--relay-text-muted)]">
                      {node.os}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={ipDraft}
                        onChange={(e) => setIpDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && commitEdit(node.id)}
                        className="min-h-[34px] min-w-0 flex-1 rounded-xl border border-black/15 bg-zinc-50 px-2.5 font-mono-tabular text-xs text-[var(--relay-text)] focus:border-blue-500/60 focus:outline-none dark:border-white/25 dark:bg-zinc-900"
                      />
                      <button
                        type="button"
                        onClick={() => commitEdit(node.id)}
                        aria-label="保存地址"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-950"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="truncate font-mono-tabular text-xs text-[var(--relay-text-muted)]">
                      {displayAddress}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Quick Macro Magnetic Tiles */}
          <div
            className="grid grid-cols-1 sm:grid-cols-2"
            style={{ gap: 'var(--relay-gap)' }}
          >
            {macros.map((m, idx) => {
              const macroTints = ['var(--tint-cyan)', 'var(--tint-teal)', 'var(--tint-violet)', 'var(--tint-amber)'];
              const macroAngles = ['166deg', '188deg', '174deg', '160deg'];
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onRunMacro(m)}
                  style={
                    {
                      '--tile-tint': macroTints[idx % macroTints.length],
                      '--tile-angle': macroAngles[idx % macroAngles.length],
                    } as React.CSSProperties
                  }
                  className="mini-tile group flex items-center justify-between gap-3 rounded-[20px] px-4 py-3.5 text-left active:scale-[0.98]"
                >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--relay-text)]">
                    {m.label}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-[var(--relay-text-muted)]">
                    {m.description}
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--relay-text-faint)] group-hover:text-[var(--relay-text)]" />
              </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Briefings Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-[var(--relay-text-muted)]">简报</h2>
              <button
                type="button"
                onClick={onFetchFreshDigest}
                disabled={isFetchingDigest}
                className="mini-tile inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-[var(--relay-text)] disabled:opacity-60"
              >
                <ArrowsClockwise
                  weight="regular"
                  className={`h-3.5 w-3.5 text-zinc-700 dark:text-zinc-200 ${isFetchingDigest ? 'animate-spin' : ''}`}
                />
                <span>刷新</span>
              </button>
            </div>

            {briefings.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--relay-text-faint)]">—</div>
            ) : (
              <div
                className="grid grid-cols-1 sm:grid-cols-2"
                style={{ gap: 'var(--relay-gap)' }}
              >
                {briefings.map((item) => (
                  <article
                    key={item.id}
                    className="board-tile flex flex-col justify-between gap-2.5"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--relay-text-muted)]">
                        <span>
                          {item.source} · {item.publishedAt}
                        </span>
                        <button
                          type="button"
                          onClick={() => onToggleSaveBriefing(item)}
                          aria-label="收藏"
                        >
                          <FeedBookmarkIcon className="h-4 w-4" active={item.saved} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectBriefing(item)}
                        className="mt-2 block text-left text-sm font-semibold leading-snug text-[var(--relay-text)]"
                      >
                        {item.title}
                      </button>
                    </div>
                    <div className="flex items-center justify-end border-t border-[var(--relay-tile-border)] pt-2">
                      <button
                        type="button"
                        onClick={() => onAskAboutBriefing(item)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent-sky)]"
                      >
                        <span>追问</span>
                        <ArrowUpRight weight="bold" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* Files Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-[var(--relay-text-muted)]">文件</h2>
              <input
                ref={uploadRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadLocalFile(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => uploadRef.current?.click()}
                className="mini-tile inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-[var(--relay-text)]"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>上传</span>
              </button>
            </div>

            {files.length === 0 ? (
              <div className="py-10 text-center text-xs text-[var(--relay-text-faint)]">
                暂无文件
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {files.map((file) => (
                  <div
                    key={file.id}
                    style={{ '--tile-tint': 'var(--tint-emerald)' } as React.CSSProperties}
                    className="mini-tile flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectPreviewFile(file)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-[var(--accent-mint)]" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-[var(--relay-text)]">
                          {file.name}
                        </div>
                        <div className="mt-0.5 font-mono-tabular text-[10px] text-[var(--relay-text-muted)]">
                          {file.size} · {file.updatedAt}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onAskAboutFile(file)}
                      className="shrink-0 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[11px] font-medium text-[var(--relay-text)] hover:bg-zinc-200/80 dark:bg-white/12 dark:hover:bg-white/18"
                    >
                      助理
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Briefing Reader Modal */}
      {selectedBriefing && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 backdrop-blur-xs sm:items-center sm:p-4 dark:bg-black/60"
          onClick={() => onSelectBriefing(null)}
        >
          <div
            className="mac-card flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[26px] text-[var(--relay-text)] sm:rounded-[26px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--relay-tile-border)] px-5 py-4">
              <span className="text-xs font-medium text-[var(--relay-text-muted)]">
                {selectedBriefing.source} · {selectedBriefing.publishedAt}
              </span>
              <button
                type="button"
                onClick={() => onSelectBriefing(null)}
                aria-label="关闭"
                className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--relay-text-muted)] hover:bg-black/[0.05] dark:hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              <h2 className="text-lg font-semibold leading-snug text-[var(--relay-text)]">
                {selectedBriefing.title}
              </h2>
              <p className="text-sm leading-relaxed text-[var(--relay-text-muted)]">
                {selectedBriefing.summary}
              </p>
              {selectedBriefing.takeaways.length > 0 && (
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-[var(--relay-text-muted)]">
                  {selectedBriefing.takeaways.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
              {selectedBriefing.url && (
                <a
                  href={selectedBriefing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-sky)] hover:underline"
                >
                  <span>查看原文</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 backdrop-blur-xs sm:items-center sm:p-4 dark:bg-black/60"
          onClick={() => onSelectPreviewFile(null)}
        >
          <div
            className="mac-card flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[26px] text-[var(--relay-text)] sm:rounded-[26px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--relay-tile-border)] px-5 py-4">
              <span className="truncate text-sm font-semibold text-[var(--relay-text)]">
                {previewFile.name}
              </span>
              <button
                type="button"
                onClick={() => onSelectPreviewFile(null)}
                aria-label="关闭预览"
                className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--relay-text-muted)] hover:bg-black/[0.05] dark:hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-5 font-mono-tabular text-xs leading-relaxed text-[var(--relay-text-muted)] whitespace-pre-wrap">
              {previewFile.previewText || '暂无文本预览'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
