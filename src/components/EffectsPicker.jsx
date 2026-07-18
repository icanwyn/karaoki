import { EFFECT_OPTIONS } from "./FallingEffects.jsx";

export default function EffectsPicker({ value = "none", onChange }) {
  return (
    <div className="panel-section panel-section-tight">
      <div className="panel-header" style={{ padding: "0 0 10px", border: "none" }}>
        <h2 className="panel-title">Atmosphere</h2>
      </div>
      <div className="effects-grid">
        {EFFECT_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`effects-chip${value === opt.id ? " is-active" : ""}`}
            onClick={() => onChange?.(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
