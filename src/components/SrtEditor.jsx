/**
 * Compact post-upload SRT editor — trim junk, edit line text, delete lines.
 */
import { useState } from "react";
import { formatSrtTime, SrtReader } from "../lib/SrtReader.js";

export default function SrtEditor({
  reader,
  onChange,
  onClose,
}) {
  const [editIdx, setEditIdx] = useState(null);
  const [draft, setDraft] = useState("");

  if (!reader || reader.isEmpty) return null;

  const commit = (nextReader) => {
    onChange?.(SrtReader.fromJSON(nextReader.toJSON()));
  };

  const startEdit = (i) => {
    setEditIdx(i);
    setDraft(reader.cues[i]?.text || "");
  };

  const saveEdit = () => {
    if (editIdx == null) return;
    reader.updateCueText(editIdx, draft);
    commit(reader);
    setEditIdx(null);
    setDraft("");
  };

  return (
    <div className="srt-editor glass-card">
      <div className="srt-editor-head">
        <strong>Edit captions</strong>
        <span className="chip">{reader.length} lines</span>
        {onClose && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Done
          </button>
        )}
      </div>

      <div className="srt-editor-tools">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            reader.trimHead(1);
            commit(reader);
          }}
          disabled={reader.length < 1}
          title="Remove first line (common free-SRT junk)"
        >
          − First
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            reader.trimTail(1);
            commit(reader);
          }}
          disabled={reader.length < 1}
          title="Remove last line"
        >
          − Last
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            reader.cleanJunk();
            commit(reader);
          }}
          title="Drop empty / subscribe / music-only junk lines"
        >
          Clean junk
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            reader.restructureByCapital();
            commit(reader);
          }}
          title="Optional: start a new line at every Capitalized word (may change feel)"
        >
          Split on Capitals
        </button>
      </div>

      <ul className="srt-editor-list">
        {reader.cues.map((cue, i) => (
          <li key={`${cue.index}-${i}`} className="srt-editor-row">
            <span className="srt-editor-time">{formatSrtTime(cue.start)}</span>
            {editIdx === i ? (
              <div className="srt-editor-edit">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") setEditIdx(null);
                  }}
                  autoFocus
                />
                <button type="button" className="btn btn-sm btn-primary" onClick={saveEdit}>
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="srt-editor-text"
                onClick={() => startEdit(i)}
                title="Click to edit"
              >
                {cue.text}
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-danger srt-editor-del"
              onClick={() => {
                reader.removeCueAt(i);
                commit(reader);
                if (editIdx === i) setEditIdx(null);
              }}
              aria-label="Delete line"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
