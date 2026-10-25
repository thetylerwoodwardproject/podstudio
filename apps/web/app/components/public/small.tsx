import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons/faCheck";
import { faCopy } from "@fortawesome/free-solid-svg-icons/faCopy";

/** Copies the RSS URL; the label flips to "Copied" for two seconds. */
export function CopyRss({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="pub-pill"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(new URL(url, location.href).href);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      <FontAwesomeIcon icon={done ? faCheck : faCopy} />
      {done ? "Copied" : "Copy RSS link"}
    </button>
  );
}

/** Clamps long text to three lines with a Show more / Show less toggle (only when it's long). */
export function ShowMore({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 240;
  return (
    <div>
      <p
        className="pub-lead"
        style={!open && long ? { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" } : undefined}
      >
        {text}
      </p>
      {long && (
        <button type="button" className="pub-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
