/**
 * Slow atmospheric overlays: ash, snow, rain, flowers.
 * Canvas particles — lightweight, no external assets.
 */
import { useEffect, useRef } from "react";

const PRESETS = {
  none: null,
  ash: {
    count: 48,
    speed: [12, 28],
    drift: [-18, 18],
    size: [1.2, 3.5],
    alpha: [0.15, 0.45],
    color: () => {
      const g = 40 + Math.random() * 50;
      return `rgba(${g},${g},${g + 10},`;
    },
    shape: "soft",
    spin: false,
  },
  snow: {
    count: 55,
    speed: [14, 32],
    drift: [-22, 22],
    size: [1.5, 4],
    alpha: [0.25, 0.7],
    color: () => "rgba(255,255,255,",
    shape: "soft",
    spin: false,
  },
  rain: {
    count: 70,
    speed: [180, 320],
    drift: [-30, -8],
    size: [0.6, 1.2],
    alpha: [0.12, 0.35],
    color: () => "rgba(180,200,220,",
    shape: "streak",
    spin: false,
  },
  flowers: {
    count: 28,
    speed: [10, 24],
    drift: [-40, 40],
    size: [4, 10],
    alpha: [0.35, 0.75],
    color: () => {
      const palettes = [
        [255, 180, 200],
        [255, 210, 180],
        [230, 200, 255],
        [255, 230, 200],
        [200, 220, 255],
      ];
      const p = palettes[Math.floor(Math.random() * palettes.length)];
      return `rgba(${p[0]},${p[1]},${p[2]},`;
    },
    shape: "petal",
    spin: true,
  },
  fireflies: {
    count: 36,
    speed: [-6, 6], // gentle float, mostly hover
    drift: [-20, 20],
    size: [1.2, 2.8],
    alpha: [0.2, 0.9],
    color: () => {
      // warm yellow-green glow
      const g = 200 + Math.random() * 40;
      const r = 180 + Math.random() * 60;
      return `rgba(${r},${g},90,`;
    },
    shape: "glow",
    spin: false,
    float: true,
  },
};

export const EFFECT_OPTIONS = [
  { id: "none", label: "None" },
  { id: "ash", label: "Ashes" },
  { id: "snow", label: "Snow" },
  { id: "rain", label: "Rain" },
  { id: "flowers", label: "Flowers" },
  { id: "fireflies", label: "Fireflies" },
];

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function makeParticle(w, h, cfg) {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vy: rand(cfg.speed[0], cfg.speed[1]),
    vx: rand(cfg.drift[0], cfg.drift[1]),
    r: rand(cfg.size[0], cfg.size[1]),
    a: rand(cfg.alpha[0], cfg.alpha[1]),
    rot: Math.random() * Math.PI * 2,
    vr: cfg.spin ? rand(-0.8, 0.8) : 0,
    color: cfg.color(),
    phase: Math.random() * Math.PI * 2,
    blink: Math.random() * Math.PI * 2,
    float: !!cfg.float,
  };
}

export default function FallingEffects({ effect = "none", className = "" }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cfg = PRESETS[effect];
    if (!cfg) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const ctx = canvas.getContext("2d");
    let particles = [];
    let w = 0;
    let h = 0;
    let last = performance.now();

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.floor(rect.width));
      h = Math.max(1, Math.floor(rect.height));
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = Array.from({ length: cfg.count }, () => makeParticle(w, h, cfg));
    };

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const drawPetal = (p) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, 0.55);
      ctx.beginPath();
      ctx.moveTo(0, -p.r);
      ctx.bezierCurveTo(p.r, -p.r * 0.3, p.r * 0.6, p.r, 0, p.r * 0.6);
      ctx.bezierCurveTo(-p.r * 0.6, p.r, -p.r, -p.r * 0.3, 0, -p.r);
      ctx.fillStyle = `${p.color}${p.a})`;
      ctx.fill();
      ctx.restore();
    };

    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        p.phase += dt;
        p.blink += dt * (p.float ? 2.2 : 1);

        if (p.float) {
          // Fireflies: slow drift + hover, wrap edges softly
          p.x += (p.vx * 0.35 + Math.sin(p.phase * 0.9) * 14) * dt;
          p.y += (p.vy * 0.35 + Math.cos(p.phase * 0.7) * 10) * dt;
          if (p.x < -10) p.x = w + 10;
          if (p.x > w + 10) p.x = -10;
          if (p.y < -10) p.y = h + 10;
          if (p.y > h + 10) p.y = -10;
        } else {
          p.x += (p.vx + Math.sin(p.phase * 1.2) * 8) * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          if (p.y > h + 20) {
            p.y = -20;
            p.x = Math.random() * w;
          }
          if (p.x < -30) p.x = w + 20;
          if (p.x > w + 30) p.x = -20;
        }

        if (cfg.shape === "streak") {
          ctx.strokeStyle = `${p.color}${p.a})`;
          ctx.lineWidth = p.r;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.vx * 0.04, p.y + p.r * 10);
          ctx.stroke();
        } else if (cfg.shape === "petal") {
          drawPetal(p);
        } else if (cfg.shape === "glow") {
          // Soft blinking glow (firefly)
          const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(p.blink));
          const alpha = p.a * pulse;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
          g.addColorStop(0, `${p.color}${Math.min(1, alpha)})`);
          g.addColorStop(0.35, `${p.color}${alpha * 0.45})`);
          g.addColorStop(1, `${p.color}0)`);
          ctx.beginPath();
          ctx.fillStyle = g;
          ctx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.fillStyle = `${p.color}${Math.min(1, alpha + 0.15)})`;
          ctx.arc(p.x, p.y, p.r * 0.7, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.fillStyle = `${p.color}${p.a})`;
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [effect]);

  if (!effect || effect === "none") return null;

  return (
    <canvas
      ref={canvasRef}
      className={`falling-effects ${className}`}
      aria-hidden
    />
  );
}
