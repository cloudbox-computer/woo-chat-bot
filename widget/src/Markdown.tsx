import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

/**
 * Renders assistant replies as full markdown: bold, italics, headings,
 * bullet lists / numbered lists, tables, code blocks, blockquotes, links,
 * strikethrough, task lists and emoji.
 *
 * Deliberately NO rehype-raw: raw HTML from the model is escaped, which keeps
 * this customer-facing embed safe from injected markup. Styling for the
 * `.zochat-md` wrapper is injected by the widget (same shadow root), so
 * elements like tables and code render consistently.
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="zochat-md">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{children}</ReactMarkdown>
    </div>
  );
});
