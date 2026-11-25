import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Edit3,
  FileText,
  Laptop,
  MessageSquarePlus,
  Play,
  Server,
  Smartphone,
  Upload,
  X,
} from 'lucide-react';
import type { MeshFileItem, MeshNode, QuickMacro } from '../types/relay';

interface MeshViewProps {
  nodes: MeshNode[];
  onUpdateNodeIp: (nodeId: string, newIp: string) => void;
  macros: QuickMacro[];
  onRunMacro: (macro: QuickMacro) => void;
  files: MeshFileItem[];
  onUploadLocalFile: (file: File) => void;
  onAskAboutFile: (file: MeshFileItem) => void;
  previewFile: MeshFileItem | null;
  onSelectPreviewFile: (file: MeshFileItem | null) => void;
}

const ROLE_META: Record<
  MeshNode['role'],
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  cloud: { label: '云端节点', Icon: Server },
  pc: { label: '个人电脑', Icon: Laptop },
  android: { label: 'Android 手机', Icon: Smartphone },
};

export const MeshView: React.FC<MeshViewProps> = ({
  nodes,
  onUpdateNodeIp,
  macros,
  onRunMacro,
  files,
  onUploadLocalFile,
  onAskAboutFile,
  previewFile,
  onSelectPreviewFile,
}) => {
  const [fileFilter, setFileFilter] = useState<'all' | 'pc' | 'cloud' | 'android'>('all');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [draftIp, setDraftIp] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredFiles = useMemo(() => {
    if (fileFilter === 'all') return files;
    return files.filter((f) => f.sourceNode === fileFilter || f.targetNode === fileFilter);
  }, [files, fileFilter]);

  const handleStartEdit = (node: MeshNode) => {
    setEditingNodeId(node.id);
    setDraftIp(node.tailscaleIp);
  };

  const handleSaveIp = (nodeId: string) => {
    const trimmed = draftIp.trim();
    if (trimmed) {
      onUpdateNodeIp(nodeId, trimmed);
    }
    setEditingNodeId(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      onUploadLocalFile(selected);
      e.target.value = '';
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 pb-28 sm:px-6 lg:py-8 lg:pb-12 space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Tailscale 设备网与文件
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            管理云端 Agent、个人电脑与 Android 手机之间的快捷控制和文件流转。
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
        >
          <Upload className="h-4 w-4" />
          <span>从本机上传文件到设备网</span>
        </button>
      </div>

      {/* Tailscale Nodes Grid */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            在线设备节点
          </h2>
          <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
            {nodes.filter((n) => n.online).length} / {nodes.length} 已连接
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
          {nodes.map((node) => {
            const { label, Icon } = ROLE_META[node.role];
            const isEditing = editingNodeId === node.id;

            return (
              <div
                key={node.id}
                className="rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-slate-800 dark:bg-[#131822]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {label} · {node.online ? '在线' : '离线'}
                      </div>
                      <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {node.name}
                      </h3>
                    </div>
                  </div>
                  <span className="font-mono-tabular text-xs text-slate-500 dark:text-slate-400 shrink-0">
                    {node.latencyMs} ms
                  </span>
                </div>

                <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs dark:border-slate-800/80">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400">Tailscale IP</span>
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={draftIp}
                          onChange={(e) => setDraftIp(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveIp(node.id);
                          }}
                          className="w-32 rounded-lg border border-blue-500 bg-white px-2 py-1 font-mono-tabular text-xs text-slate-900 focus:outline-none dark:bg-slate-900 dark:text-slate-100"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveIp(node.id)}
                          aria-label="保存 IP"
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleStartEdit(node)}
                        className="inline-flex items-center gap-1.5 font-mono-tabular text-slate-800 hover:text-blue-600 dark:text-slate-200 dark:hover:text-blue-400"
                      >
                        <span>{node.tailscaleIp}</span>
                        <Edit3 className="h-3 w-3 opacity-60" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400">系统</span>
                    <span className="truncate text-slate-700 dark:text-slate-300">{node.os}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400">服务</span>
                    <span className="truncate font-mono-tabular text-slate-600 dark:text-slate-400">
                      {node.activeService}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick Control Macros */}
      <section>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          常用跨设备快捷指令
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {macros.map((macro) => {
            const targetLabel = ROLE_META[macro.targetRole].label;
            return (
              <button
                key={macro.id}
                type="button"
                onClick={() => onRunMacro(macro)}
                className="group flex min-h-[72px] items-center justify-between gap-4 rounded-2xl border border-slate-200/90 bg-white p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30 dark:border-slate-800 dark:bg-[#131822] dark:hover:border-blue-800/80 dark:hover:bg-blue-950/20"
              >
                <div className="min-w-0">
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {targetLabel} · <span className="font-mono-tabular">{macro.command}</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {macro.label}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {macro.description}
                  </p>
                </div>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition-colors group-hover:bg-blue-600 group-hover:text-white dark:bg-slate-800 dark:text-slate-200">
                  <Play className="h-4 w-4" />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Cross-Device File Stream */}
      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            跨设备文件通道
          </h2>
          <div className="flex items-center gap-1 rounded-xl bg-slate-200/60 p-1 dark:bg-slate-800/70">
            {(
              [
                ['all', '全部'],
                ['pc', '电脑'],
                ['cloud', '云端'],
                ['android', '手机'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFileFilter(key)}
                className={`min-h-[36px] rounded-lg px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  fileFilter === key
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-[#131822] dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-white dark:border-slate-800 dark:bg-[#131822]">
          {filteredFiles.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              当前节点筛选下暂无文件记录。
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {file.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>{ROLE_META[file.sourceNode].label}</span>
                        {file.targetNode && (
                          <>
                            <ArrowRight className="h-3 w-3" />
                            <span>{ROLE_META[file.targetNode].label}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">{file.size}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">{file.updatedAt}</span>
                      </div>
                      <div className="mt-0.5 truncate font-mono-tabular text-xs text-slate-400 dark:text-slate-500">
                        {file.path}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onSelectPreviewFile(file)}
                      className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      预览
                    </button>
                    <button
                      type="button"
                      onClick={() => onAskAboutFile(file)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 whitespace-nowrap"
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                      <span>Agent 解读</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* File Preview Sheet */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 backdrop-blur-xs sm:items-center sm:p-4"
          onClick={() => onSelectPreviewFile(null)}
        >
          <div
            className="w-full max-w-xl rounded-t-3xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-[#131822] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                  {previewFile.name}
                </h3>
                <p className="mt-0.5 truncate font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                  {previewFile.path} · {previewFile.size}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onSelectPreviewFile(null)}
                aria-label="关闭预览"
                className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <pre className="mt-4 max-h-72 overflow-auto rounded-xl bg-slate-50 p-4 font-mono-tabular text-xs leading-relaxed text-slate-800 dark:bg-[#0B0E14] dark:text-slate-200 whitespace-pre-wrap">
              {previewFile.previewText || '该文件为二进制格式，可通过对话让云端 Agent 解析或摘要其内容。'}
            </pre>

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onAskAboutFile(previewFile);
                  onSelectPreviewFile(null);
                }}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <MessageSquarePlus className="h-4 w-4" />
                <span>发给 Agent 摘要与分析</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
