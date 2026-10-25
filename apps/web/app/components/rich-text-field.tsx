import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { cn } from "~/lib/utils";

// WYSIWYG field for descriptions and bios. The visual editor (TipTap) covers the
// common formatting; the "HTML" tab edits the markup directly for anything beyond
// it (tables, embeds) and is submitted as typed — switching back to Visual drops
// what the visual editor can't represent, and says so. The server sanitises on
// save either way (lib/rich-text.server.ts), so what the public page shows is
// what survives that, not what was typed.
type Props = {
  name: string;
  id?: string;
  defaultValue: string;
  label: string;
  minHeight?: number;
};

function Btn({
  label,
  on,
  active,
  disabled,
  children,
}: {
  label: string;
  on: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault() /* keep the editor selection */}
      onClick={on}
      className={cn(
        "h-8 min-w-8 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function RichTextField({ name, id = name, defaultValue, label, minHeight = 160 }: Props) {
  const [html, setHtml] = useState(defaultValue);
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [prompt, setPrompt] = useState<null | "link" | "image">(null);
  const [url, setUrl] = useState("");
  const [warn, setWarn] = useState(false);

  const editor = useEditor({
    immediatelyRender: false, // server-rendered page: create the editor after hydration
    shouldRerenderOnTransaction: true, // keep toolbar button states current
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow ugc", target: "_blank" } },
      }),
      Image.configure({ HTMLAttributes: { loading: "lazy" } }),
    ],
    content: defaultValue,
    editorProps: { attributes: { id, "aria-label": label, role: "textbox", "aria-multiline": "true", class: "rte-content" } },
    onUpdate: ({ editor: e }) => setHtml(e.isEmpty ? "" : e.getHTML()),
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  function switchMode(next: "visual" | "html") {
    if (next === mode) return;
    if (next === "visual") {
      editor?.commands.setContent(html || "", { emitUpdate: false });
      const roundTrip = editor?.getHTML() ?? "";
      // Anything the visual editor can't hold (tables, iframes…) is gone after this.
      setWarn(!!html && /<(table|iframe|details|figure|svg)\b/i.test(html) && !/<(table|iframe|details|figure)\b/i.test(roundTrip));
      setHtml(editor && !editor.isEmpty ? roundTrip : "");
    }
    setMode(next);
  }

  function applyPrompt() {
    if (!editor) return;
    const u = url.trim();
    if (prompt === "link") {
      if (!u) editor.chain().focus().extendMarkRange("link").unsetLink().run();
      else editor.chain().focus().extendMarkRange("link").setLink({ href: /^[a-z]+:/i.test(u) ? u : `https://${u}` }).run();
    } else if (prompt === "image" && /^https:\/\//i.test(u)) {
      editor.chain().focus().setImage({ src: u }).run();
    }
    setPrompt(null);
    setUrl("");
  }

  const e = editor;
  return (
    <div className="rounded-md border border-input focus-within:ring-[3px] focus-within:ring-ring/50">
      <input type="hidden" name={name} value={html} />
      <div className="flex flex-wrap items-center gap-0.5 border-b border-input px-1.5 py-1" role="toolbar" aria-label={`${label} formatting`}>
        {mode === "visual" && e ? (
          <>
            <Btn label="Heading" active={e.isActive("heading", { level: 2 })} on={() => e.chain().focus().toggleHeading({ level: 2 }).run()}>
              H2
            </Btn>
            <Btn label="Subheading" active={e.isActive("heading", { level: 3 })} on={() => e.chain().focus().toggleHeading({ level: 3 }).run()}>
              H3
            </Btn>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <Btn label="Bold" active={e.isActive("bold")} on={() => e.chain().focus().toggleBold().run()}>
              <b>B</b>
            </Btn>
            <Btn label="Italic" active={e.isActive("italic")} on={() => e.chain().focus().toggleItalic().run()}>
              <i>I</i>
            </Btn>
            <Btn label="Underline" active={e.isActive("underline")} on={() => e.chain().focus().toggleUnderline().run()}>
              <u>U</u>
            </Btn>
            <Btn label="Strikethrough" active={e.isActive("strike")} on={() => e.chain().focus().toggleStrike().run()}>
              <s>S</s>
            </Btn>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <Btn label="Bulleted list" active={e.isActive("bulletList")} on={() => e.chain().focus().toggleBulletList().run()}>
              •&nbsp;List
            </Btn>
            <Btn label="Numbered list" active={e.isActive("orderedList")} on={() => e.chain().focus().toggleOrderedList().run()}>
              1.&nbsp;List
            </Btn>
            <Btn label="Quote" active={e.isActive("blockquote")} on={() => e.chain().focus().toggleBlockquote().run()}>
              “ ”
            </Btn>
            <Btn label="Divider" on={() => e.chain().focus().setHorizontalRule().run()}>
              ―
            </Btn>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <Btn
              label="Link"
              active={e.isActive("link")}
              on={() => {
                setUrl((e.getAttributes("link").href as string) ?? "");
                setPrompt("link");
              }}
            >
              Link
            </Btn>
            <Btn label="Image" on={() => { setUrl(""); setPrompt("image"); }}>
              Image
            </Btn>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <Btn label="Undo" disabled={!e.can().undo()} on={() => e.chain().focus().undo().run()}>
              ↶
            </Btn>
            <Btn label="Redo" disabled={!e.can().redo()} on={() => e.chain().focus().redo().run()}>
              ↷
            </Btn>
            <Btn label="Clear formatting" on={() => e.chain().focus().unsetAllMarks().clearNodes().run()}>
              Tx
            </Btn>
          </>
        ) : (
          <span className="px-2 text-[12px] text-muted-foreground">
            {mode === "html" ? "Editing the HTML directly." : "Loading editor…"}
          </span>
        )}
        <span className="ml-auto flex gap-0.5">
          <Btn label="Visual editor" active={mode === "visual"} on={() => switchMode("visual")}>
            Visual
          </Btn>
          <Btn label="HTML source" active={mode === "html"} on={() => switchMode("html")}>
            HTML
          </Btn>
        </span>
      </div>

      {prompt && mode === "visual" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-input bg-muted/40 px-2 py-1.5">
          <label className="text-[12px] text-muted-foreground" htmlFor={`${id}-url`}>
            {prompt === "link" ? "Link address" : "Image address (https)"}
          </label>
          <input
            id={`${id}-url`}
            autoFocus
            value={url}
            onChange={(ev) => setUrl(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                applyPrompt();
              } else if (ev.key === "Escape") setPrompt(null);
            }}
            placeholder="https://"
            className="h-8 min-w-[220px] flex-1 rounded-md border border-input bg-background px-2 text-[13px] outline-none"
          />
          <button type="button" onClick={applyPrompt} className="h-8 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground">
            {prompt === "link" && !url.trim() ? "Remove link" : "Apply"}
          </button>
          <button type="button" onClick={() => setPrompt(null)} className="h-8 rounded-md px-2 text-[13px] text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      )}

      {mode === "visual" ? (
        e ? (
          <EditorContent editor={e} className="rte" style={{ minHeight }} />
        ) : (
          <div className="px-3 py-2 text-[13px] text-muted-foreground" style={{ minHeight }}>
            Loading editor…
          </div>
        )
      ) : (
        <textarea
          id={id}
          aria-label={`${label} (HTML)`}
          value={html}
          onChange={(ev) => setHtml(ev.target.value)}
          spellCheck={false}
          className="block w-full resize-y bg-transparent px-3 py-2 font-mono text-[12.5px] outline-none"
          style={{ minHeight }}
        />
      )}
      {warn && (
        <p role="status" className="border-t border-input px-3 py-1.5 text-[12px] text-destructive">
          Some HTML (tables, embeds…) can't be shown in the Visual editor and was removed. Switch back to HTML before saving to keep it.
        </p>
      )}
      <p className="border-t border-input px-3 py-1.5 text-[11.5px] text-muted-foreground">
        Public pages allow headings, lists, quotes, tables, images (https), code and embeds from YouTube, Vimeo and Spotify. Scripts,
        styles and forms are always removed.
      </p>
    </div>
  );
}
