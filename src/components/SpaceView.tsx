import React, { useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  Check,
  Edit3,
  ExternalLink,
  FileText,
  Laptop,
  Link2,
  RefreshCw,
  Server,
  Smartphone,
  Upload,
  X,
} from 'lucide-react';
import type {
  BriefingItem,
  ConnectionConfig,
  MeshFileItem,
  MeshNode,
  QuickMacro,
} from '../types/relay';

interface SpaceViewProps {
  config: ConnectionConfig;
  nodes: MeshNode[];
  macros: QuickMacro[];
  files: MeshFileItem[];
  briefings: BriefingItem[];
  selectedBriefing: BriefingItem | null;
  previewFile: MeshFileItem | null;
  isFetchingDigest: boolean;
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
}

type SpaceTab = 'environment' | 'library';

export const SpaceView: React.FC<SpaceViewProps> = ({
  config,
  nodes,
  macros,
  files,
  briefings,
  selectedBriefing,
  previewFile,
  isFetchingDigest,
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
}) => {
  const [subTab, setSubTab] = useState<SpaceTab>('environment');
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
    <div className="mx-auto w-full max-w-4xl px-4 py-6 pb-28 sm:px-6 lg:py-10 lg:pb-14 space-y-6">
      {/* Header & Switcher */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            空间与环境
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            管理你的 Tailscale 节点、常用指令以及跨设备文件与简报归档。
          </p>
        </div>

        <div className="inline-flex rounded-2xl bg-stone-200/70 p-1 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setSubTab('environment')}
            className={`min-h-[38px] rounded-xl px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              subTab === 'environment'
                ? 'bg-white text-zinc-950 shadow-xs dark:bg-[#1A1D24] dark:text-zinc-50'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            设备与环境
          </button>
          <button
            type="button"
            onClick={() => setSubTab('library')}
            className={`min-h-[38px] rounded-xl px-4 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              subTab === 'library'
                ? 'bg-white text-zinc-950 shadow-xs dark:bg-[#1A1D24] dark:text-zinc-50'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            文件与简报
          </button>
        </div>
      </div>

      {subTab === 'environment' ? (
        <div className="space-y-6">
          {/* Active Agent Endpoint Card */}
          <div className="flex flex-col gap-3 rounded-3xl border border-stone-200/80 bg-white p-5 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800 dark:bg-[#15171C]">
            <div className="min-w-0">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                当前云端 Agent 通道
              </div>
              <div className="mt-1 truncate font-mono-tabular text-sm font-medium text-zinc-950 dark:text-zinc-50">
                {config.mode === 'sandbox'
                  ? '本地交互体验模式'
                  : config.serverUrl || '未配置服务器地址'}
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenConnection}
              className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-stone-200 bg-[#F8F7F4] px-4 text-xs font-medium text-zinc-800 transition-colors hover:border-stone-300 hover:bg-stone-100 dark:border-zinc-700 dark:bg-[#0E0F12] dark:text-zinc-200 dark:hover:bg-zinc-800 whitespace-nowrap"
            >
              <Link2 className="h-3.5 w-3.5 text-[#1B6EF3] dark:text-blue-400" />
              <span>连接与协议设置</span>
            </button>
          </div>

          {/* Tailscale Mesh Nodes */}
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              Tailscale 设备节点
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {nodes.map((node) => {
                const Icon =
                  node.role === 'cloud'
                    ? Server
                    : node.role === 'pc'
                      ? Laptop
                      : Smartphone;
                const isEditing = editingNodeId === node.id;

                return (
                  <div
                    key={node.id}
                    className="rounded-3xl border border-stone-200/80 bg-white p-4 dark:border-zinc-800 dark:bg-[#15171C]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-stone-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                        <Icon className="h-4 w-4" />
                      </div>
                      {!isEditing && (
                        <button
                          type="button"
                          onClick={() => startEdit(node)}
                          aria-label="编辑地址"
                          className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-400 hover:bg-stone-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="mt-3 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                      {node.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">{node.os}</div>

                    {isEditing ? (
                      <div className="mt-3 flex items-center gap-1.5">
                        <input
                          type="text"
                          value={ipDraft}
                          onChange={(e) => setIpDraft(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && commitEdit(node.id)}
                          className="min-h-[34px] min-w-0 flex-1 rounded-xl border border-[#1B6EF3] bg-[#F8F7F4] px-2.5 font-mono-tabular text-xs text-zinc-900 focus:outline-none dark:bg-[#0E0F12] dark:text-zinc-100"
                        />
                        <button
                          type="button"
                          onClick={() => commitEdit(node.id)}
                          aria-label="保存地址"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#1B6EF3] text-white"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 truncate font-mono-tabular text-xs text-zinc-600 dark:text-zinc-300">
                        {node.tailscaleIp}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Workflows */}
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              快捷指令（点击直接派发到对话）
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {macros.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onRunMacro(m)}
                  className="group flex items-center justify-between gap-3 rounded-2xl border border-stone-200/80 bg-white px-4 py-3.5 text-left transition-colors hover:border-[#1B6EF3]/50 dark:border-zinc-800 dark:bg-[#15171C] dark:hover:border-blue-500/50"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900 group-hover:text-[#1B6EF3] dark:text-zinc-100 dark:group-hover:text-blue-400">
                      {m.label}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-zinc-400">
                      {m.description}
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-300 transition-colors group-hover:text-[#1B6EF3] dark:text-zinc-600 dark:group-hover:text-blue-400" />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Briefings Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                简报与归档
              </h2>
              <button
                type="button"
                onClick={onFetchFreshDigest}
                disabled={isFetchingDigest}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-zinc-950 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-[#1B6EF3] dark:hover:bg-blue-600"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetchingDigest ? 'animate-spin' : ''}`} />
                <span>让 Agent 生成今日简报</span>
              </button>
            </div>

            {briefings.length === 0 ? (
              <div className="rounded-3xl border border-stone-200/80 bg-white px-6 py-10 text-center dark:border-zinc-800 dark:bg-[#15171C]">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  暂无已收藏简报
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  点击右上角按钮让云端 Agent 整理今日论文或资讯，收藏后会自动归档在这里。
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {briefings.map((item) => (
                  <article
                    key={item.id}
                    className="flex flex-col justify-between rounded-3xl border border-stone-200/80 bg-white p-4 dark:border-zinc-800 dark:bg-[#15171C]"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                        <span>{item.source} · {item.publishedAt}</span>
                        <button
                          type="button"
                          onClick={() => onToggleSaveBriefing(item)}
                          aria-label="收藏简报"
                          className={item.saved ? 'text-[#1B6EF3]' : 'text-zinc-400 hover:text-zinc-700'}
                        >
                          <Bookmark className={`h-4 w-4 ${item.saved ? 'fill-current' : ''}`} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectBriefing(item)}
                        className="mt-2 block text-left text-sm font-semibold leading-snug text-zinc-950 hover:text-[#1B6EF3] dark:text-zinc-50 dark:hover:text-blue-400"
                      >
                        {item.title}
                      </button>
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                        {item.summary}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => onAskAboutBriefing(item)}
                        className="text-xs font-medium text-[#1B6EF3] hover:underline dark:text-blue-400"
                      >
                        转入对话深读 →
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
              <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                跨设备文件
              </h2>
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
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-stone-50 dark:border-zinc-700 dark:bg-[#15171C] dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>添加本地文件</span>
              </button>
            </div>

            {files.length === 0 ? (
              <div className="rounded-3xl border border-stone-200/80 bg-white px-6 py-10 text-center dark:border-zinc-800 dark:bg-[#15171C]">
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  暂无文件记录
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  上传本地文档，或直接在对话输入框里发送图片/文件给云端 Agent。
                </p>
              </div>
            ) : (
              <div className="divide-y divide-stone-100 rounded-3xl border border-stone-200/80 bg-white dark:divide-zinc-800/80 dark:border-zinc-800 dark:bg-[#15171C]">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectPreviewFile(file)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {file.name}
                        </div>
                        <div className="mt-0.5 font-mono-tabular text-[11px] text-zinc-400">
                          {file.size} · {file.updatedAt}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onAskAboutFile(file)}
                      className="min-h-[34px] shrink-0 rounded-xl px-3 text-xs font-medium text-[#1B6EF3] hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                    >
                      交给 Agent
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
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs sm:items-center sm:p-4"
          onClick={() => onSelectBriefing(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-stone-200 bg-white dark:border-zinc-800 dark:bg-[#15171C] sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4 dark:border-zinc-800">
              <span className="text-xs font-medium text-zinc-500">
                {selectedBriefing.source} · {selectedBriefing.publishedAt}
              </span>
              <button
                type="button"
                onClick={() => onSelectBriefing(null)}
                aria-label="关闭"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              <h2 className="text-lg font-semibold leading-snug text-zinc-950 dark:text-zinc-50">
                {selectedBriefing.title}
              </h2>
              <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {selectedBriefing.summary}
              </p>
              {selectedBriefing.takeaways.length > 0 && (
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
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
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1B6EF3] hover:underline"
                >
                  <span>查看原文链接</span>
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
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs sm:items-center sm:p-4"
          onClick={() => onSelectPreviewFile(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-stone-200 bg-white dark:border-zinc-800 dark:bg-[#15171C] sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4 dark:border-zinc-800">
              <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {previewFile.name}
              </span>
              <button
                type="button"
                onClick={() => onSelectPreviewFile(null)}
                aria-label="关闭预览"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-5 font-mono-tabular text-xs leading-relaxed text-zinc-700 whitespace-pre-wrap dark:text-zinc-300">
              {previewFile.previewText || '暂无文本预览'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
