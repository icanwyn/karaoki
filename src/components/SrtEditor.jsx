/**
 * Always-visible right-panel SRT editor (no modal).
 * Supports insert/edit of cues for missing phrases.
 */
import { useRef, useState } from "react";
import { formatSrtTime, parseTimestamp, SrtReader } from "../lib/SrtReader.js";

function toInputTime(sec) {
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
  if (s.includes(":")) {
    const parts = s.split(":");
    if (parts.length === 2) {
      return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
    }
    return parseTimestamp(s.length <= 10 ? `00:${s}` : s);
  }
  return Number(s);
}

export default function SrtEditor({
  reader,
  onChange,
  onLoadSrt,
  onDownloadSrt,
  onClear,
  onResetToSrt,
  canReset = false,
}) {
  const [editIdx, setEditIdx] = useState(null);
  const [draftText, setDraftText] = useState("");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const inputRef = useRef(null);

  const commit = (nextReader) => {
    onChange?.(SrtReader.fromJSON(nextReader.toJSON()));
  };

  const openFile = () => inputRef.current?.click();

  const onFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) onLoadSrt?.(f);
  };

  const startEdit = (r, i) => {
    const cue = r.cues[i];
    setEditIdx(i);
    setDraftText(cue?.text || "");
    setDraftStart(toInputTime(cue?.start));
    setDraftEnd(toInputTime(cue?.end));
  };

  const insertAt = (index) => {
    const base =
      reader && !reader.isEmpty
        ? SrtReader.fromJSON(reader.toJSON())
        : new SrtReader([]);
    const newIdx = base.insertCueAt(index, { text: "New phrase" });
    commit(base);
    // Edit the fresh cue immediately
    requestAnimationFrame(() => startEdit(base, newIdx));
  };

  const insertAfter = (index) => {
    const base = SrtReader.fromJSON(reader.toJSON());
    const newIdx = base.insertCueAfter(index, { text: "New phrase" });
    commit(base);
    requestAnimationFrame(() => startEdit(base, newIdx));
  };

  if (!reader || reader.isEmpty) {
    return (
      <div className="srt-panel">
        <div className="srt-panel-head">
          <h2 className="panel-title">Captions</h2>
        </div>
        <div className="srt-empty-state">
          <div className="srt-empty-icon" aria-hidden="true">
            文
          </div>
          <p className="srt-empty-title">No SRT yet</p>
          <p className="hint">
            Upload captions from CapCut or any free SRT tool — or add a line and type the missing phrase.
          </p>
          <button type="button" className="btn btn-primary btn-block" onClick={openFile}>
            Upload SRT
          </button>
          <button type="button" className="btn btn-block" onClick={() => insertAt(0)}>
            + Add first line
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".srt,.vtt,text/plain,text/vtt"
            hidden
            onChange={onFile}
          />
        </div>
      </div>
    );
  }

  const saveEdit = () => {
    if (editIdx == null) return;
    const start = fromInputTime(draftStart);
    const end = fromInputTime(draftEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const next = SrtReader.fromJSON(reader.toJSON());
    // Allow empty draft to keep "New phrase" rather than delete
    const text = draftText.trim() || "New phrase";
    next.updateCueText(editIdx, text);
    next.updateCueTimes(editIdx, start, end);
    commit(next);
    setEditIdx(null);
  };

  return (
    <div className="srt-panel">
      <div className="srt-panel-head">
        <h2 className="panel-title">Captions</h2>
        <span className="chip">{reader.length}</span>
      </div>

      <div className="srt-panel-tools">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => insertAt(0)}
          title="Insert at the start of the timeline"
        >
          + Start
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => insertAt(reader.length)}
          title="Append at the end of the timeline"
        >
          + End
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            const next = SrtReader.fromJSON(reader.toJSON());
            next.trimHead(1);
            commit(next);
            setEditIdx(null);
          }}
          title="Remove first line"
        >
          − First
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            const next = SrtReader.fromJSON(reader.toJSON());
            next.trimTail(1);
            commit(next);
            setEditIdx(null);
          }}
          title="Remove last line"
        >
          − Last
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            const next = SrtReader.fromJSON(reader.toJSON());
            next.cleanJunk();
            commit(next);
            setEditIdx(null);
          }}
        >
          Clean
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onResetToSrt}
          disabled={!canReset}
          title="Restore last upload"
        >
          Reset
        </button>
        <button type="button" className="btn btn-sm" onClick={onDownloadSrt}>
          Save
        </button>
        <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={onClear}>
          Clear
        </button>
      </div>

      <p className="hint srt-insert-hint">
        Missing a phrase? Use <strong>+ After</strong> on a line to insert into the gap.
      </p>

      <ul className="srt-panel-list">
        {reader.cues.map((cue, i) => (
          <li key={`${cue.index}-${i}`} className="srt-panel-item">
            <div
              className={`srt-panel-row${editIdx === i ? " is-editing" : ""}`}
            >
              {editIdx === i ? (
                <div className="srt-panel-edit">
                  <div className="srt-time-inputs">
                    <label>
                      Start
                      <input
                        value={draftStart}
                        onChange={(e) => setDraftStart(e.target.value)}
                      />
                    </label>
                    <label>
                      End
                      <input
                        value={draftEnd}
                        onChange={(e) => setDraftEnd(e.target.value)}
                      />
                    </label>
                  </div>
                  <input
                    className="srt-editor-text-input"
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    placeholder="Caption text…"
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
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const next = SrtReader.fromJSON(reader.toJSON());
                        next.nudgeCue(i, -0.1);
                        commit(next);
                        setDraftStart(toInputTime(next.cues[i].start));
                        setDraftEnd(toInputTime(next.cues[i].end));
                      }}
                    >
                      −0.1s
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        const next = SrtReader.fromJSON(reader.toJSON());
                        next.nudgeCue(i, 0.1);
                        commit(next);
                        setDraftStart(toInputTime(next.cues[i].start));
                        setDraftEnd(toInputTime(next.cues[i].end));
                      }}
                    >
                      +0.1s
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="srt-panel-time"
                    onClick={() => startEdit(reader, i)}
                  >
                    {formatSrtTime(cue.start)}
                  </button>
                  <button
                    type="button"
                    className="srt-panel-text"
                    onClick={() => startEdit(reader, i)}
                  >
                    {cue.text}
                  </button>
                  <button
                    type="button"
                    className="srt-panel-del"
                    onClick={() => {
                      const next = SrtReader.fromJSON(reader.toJSON());
                      next.removeCueAt(i);
                      commit(next);
                      if (editIdx === i) setEditIdx(null);
                    }}
                    aria-label="Delete"
                  >
                    ×
                  </button>
                </>
              )}
            </div>
            {editIdx !== i && (
              <button
                type="button"
                className="srt-insert-after"
                onClick={() => insertAfter(i)}
                title="Insert a new line after this (fills timeline gaps)"
              >
                + After
              </button>
            )}
          </li>
        ))}
      </ul>

      <button type="button" className="btn btn-sm btn-block" onClick={() => insertAt(reader.length)}>
        + Add line at end
      </button>
      <button type="button" className="btn btn-sm btn-block srt-replace-btn" onClick={openFile}>
        Replace SRT
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".srt,.vtt,text/plain,text/vtt"
        hidden
        onChange={onFile}
      />
    </div>
  );
}
