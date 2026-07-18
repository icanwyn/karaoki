/**
 * Edit SRT text + timestamps after upload.
 */
import { useState } from "react";
import { formatSrtTime, parseTimestamp, SrtReader } from "../lib/SrtReader.js";

function toInputTime(sec) {
  // mm:ss.xxx compact for editing
  const t = Math.max(0, Number(sec) || 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const whole = Math.floor(s);
  const ms = Math.round((s - whole) * 1000);
  return `${m}:${String(whole).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function fromInputTime(str) {
  const s = String(str || "").trim().replace(",", ".");
  if (!s) return NaN;
  // allow mm:ss.xxx or ss.xxx or full SRT style
  if (s.includes(":")) {
    const parts = s.split(":");
    if (parts.length === 2) {
      return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
    }
    return parseTimestamp(s.length <= 10 ? `00:${s}` : s);
  }
  return Number(s);
}

export default function SrtEditor({ reader, onChange, onClose }) {
  const [editIdx, setEditIdx] = useState(null);
  const [draftText, setDraftText] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");

  if (!reader || reader.isEmpty) return null;

  const commit = (nextReader) => {
    onChange?.(SrtReader.fromJSON(nextReader.toJSON()));
  };

  const startEdit = (i) => {
    const cue = reader.cues[i];
    setEditIdx(i);
    setDraftText(cue?.text || "");
    setDraftStart(toInputTime(cue?.start));
    setDraftEnd(toInputTime(cue?.end));
  };

  const saveEdit = () => {
    if (editIdx == null) return;
    const start = fromInputTime(draftStart);
    const end = fromInputTime(draftEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return;
    }
    reader.updateCueText(editIdx, draftText);
    reader.updateCueTimes(editIdx, start, end);
    commit(reader);
    setEditIdx(null);
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
        >
          Clean junk
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Click a line to edit <strong>text</strong> and <strong>start/end times</strong> (
        <code>m:ss.xxx</code>). Use ± to nudge a line without typing.
      </p>

      <ul className="srt-editor-list">
        {reader.cues.map((cue, i) => (
          <li key={`${cue.index}-${i}`} className="srt-editor-row srt-editor-row-time">
            {editIdx === i ? (
              <div className="srt-editor-edit-full">
                <div className="srt-time-inputs">
                  <label>
                    Start
                    <input
                      value={draftStart}
                      onChange={(e) => setDraftStart(e.target.value)}
                      placeholder="0:12.000"
                    />
                  </label>
                  <label>
                    End
                    <input
                      value={draftEnd}
                      onChange={(e) => setDraftEnd(e.target.value)}
                      placeholder="0:15.500"
                    />
                  </label>
                </div>
                <input
                  className="srt-editor-text-input"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") setEditIdx(null);
                  }}
                  autoFocus
                />
                <div className="btn-row">
                  <button type="button" className="btn btn-sm btn-primary" onClick={saveEdit}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setEditIdx(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="srt-editor-times">
                  <button
                    type="button"
                    className="srt-editor-time"
                    onClick={() => startEdit(i)}
                    title="Edit times"
                  >
                    {formatSrtTime(cue.start)}
                  </button>
                  <span className="srt-time-arrow">→</span>
                  <button
                    type="button"
                    className="srt-editor-time"
                    onClick={() => startEdit(i)}
                    title="Edit times"
                  >
                    {formatSrtTime(cue.end)}
                  </button>
                </div>
                <div className="srt-nudge-col">
                  <button
                    type="button"
                    className="btn btn-sm"
                    title="Start earlier 0.1s"
                    onClick={() => {
                      reader.nudgeCue(i, -0.1);
                      commit(reader);
                    }}
                  >
                    −0.1
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    title="Start later 0.1s"
                    onClick={() => {
                      reader.nudgeCue(i, 0.1);
                      commit(reader);
                    }}
                  >
                    +0.1
                  </button>
                </div>
                <button
                  type="button"
                  className="srt-editor-text"
                  onClick={() => startEdit(i)}
                  title="Edit text & times"
                >
                  {cue.text}
                </button>
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
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
