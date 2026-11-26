import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';

interface MarkdownMessageProps {
  content: string;
}

const CodeBlock: React.FC<{ language?: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-stone-200/80 bg-[#17181C] text-zinc-100 dark:border-zinc-800">
      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2 text-[11px] text-zinc-400">
        <span className="font-mono-tabular uppercase tracking-wide">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono-tabular text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  return (
    <div className="text-[15px] leading-[1.75] text-zinc-800 dark:text-zinc-200 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-5 mb-2.5 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-5 mb-2 text-[17px] font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-4 mb-1.5 text-[15px] font-semibold text-zinc-900 dark:text-zinc-100 first:mt-0">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="my-2.5 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-2.5 list-disc space-y-1.5 pl-5 marker:text-zinc-400">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2.5 list-decimal space-y-1.5 pl-5 marker:text-zinc-400">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 rounded-r-xl border-l-2 border-stone-300 bg-stone-100/70 py-2 pr-3 pl-3.5 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-400">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-5 border-stone-200 dark:border-zinc-800" />,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#1B6EF3] underline decoration-[#1B6EF3]/30 underline-offset-4 transition-colors hover:decoration-[#1B6EF3] dark:text-blue-400"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-zinc-950 dark:text-zinc-50">{children}</strong>
          ),
          table: ({ children }) => (
            <div className="my-3.5 overflow-x-auto rounded-2xl border border-stone-200/80 dark:border-zinc-800">
              <table className="w-full border-collapse text-left text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-stone-100/80 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="border-b border-stone-200/80 px-3.5 py-2.5 font-semibold dark:border-zinc-800">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-stone-100 px-3.5 py-2.5 last:border-b-0 dark:border-zinc-800/70">
              {children}
            </td>
          ),
          code: ({ className, children }) => {
            const match = /language-([\w-]+)/.exec(className || '');
            const text = String(children).replace(/\n$/, '');
            const isBlock = Boolean(match) || text.includes('\n');
            if (isBlock) {
              return <CodeBlock language={match?.[1]} code={text} />;
            }
            return (
              <code className="rounded-md bg-stone-200/70 px-1.5 py-0.5 font-mono-tabular text-[13px] text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
