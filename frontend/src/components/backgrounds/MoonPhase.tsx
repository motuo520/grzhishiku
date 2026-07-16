import { useRef, useEffect, useMemo } from 'react';

const SYNODIC = 29.53059;
const REF_NEW_MOON = new Date(2024, 0, 11).getTime();
const PHASE_LABELS = ['新月', '蛾眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'];

function getMoonPhase(): { ratio: number; name: string; age: number } {
  const now = Date.now();
  const days = (now - REF_NEW_MOON) / (1000 * 60 * 60 * 24);
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const ratio = age / SYNODIC;
  const thresholds = [0.0625, 0.1875, 0.3125, 0.4375, 0.5625, 0.6875, 0.8125, 0.9375, 1.0001];
  const idx = thresholds.findIndex((t) => ratio < t);
  const name = PHASE_LABELS[idx >= 0 ? idx : 0] ?? '';
  return { ratio, name, age };
}

function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

export default function MoonPhase() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { ratio, name } = useMemo(getMoonPhase, []);

  const today = useMemo(() => {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).format(new Date());
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = 48;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 2;
    const theta = ratio * 2 * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    ctx.clearRect(0, 0, size, size);

    const img = ctx.createImageData(Math.round(size * dpr), Math.round(size * dpr));
    const data = img.data;

    for (let py = 0; py < size * dpr; py++) {
      for (let px = 0; px < size * dpr; px++) {
        const x = px / dpr;
        const y = py / dpr;
        const dx = (x - cx) / r;
        const dy = (y - cy) / r;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > 1.0) continue;

        const dz = Math.sqrt(Math.max(0, 1 - dist2));
        const lit = dx * sinT - dz * cosT > 0;
        const craterNoise = hash(Math.floor(x * 1.5), Math.floor(y * 1.5)) * 0.15
          + hash(Math.floor(x * 0.7) + 100, Math.floor(y * 0.7) + 100) * 0.1;
        const limb = 1 - dist2 * 0.3;

        let brightness: number;
        if (lit) {
          brightness = (0.55 + dz * 0.35 - craterNoise) * limb;
        } else {
          brightness = (0.04 - craterNoise * 0.3) * limb;
        }

        const terminatorVal = dx * sinT - dz * cosT;
        if (Math.abs(terminatorVal) < 0.06) {
          const t = (terminatorVal + 0.06) / 0.12;
          const litB = (0.55 + dz * 0.35 - craterNoise) * limb;
          const darkB = (0.04 - craterNoise * 0.3) * limb;
          brightness = darkB + (litB - darkB) * Math.max(0, Math.min(1, t));
        }

        const edgeDist = Math.sqrt(dist2);
        let alpha = 1;
        if (edgeDist > 0.92) alpha = Math.max(0, 1 - (edgeDist - 0.92) / 0.08);

        const v = Math.max(0, Math.min(255, Math.round(brightness * 255)));
        const rr = lit ? Math.min(255, v + 8) : v;
        const gg = lit ? Math.min(255, v + 4) : v;
        const bb = v;

        const i = (py * Math.round(size * dpr) + px) * 4;
        data[i] = rr;
        data[i + 1] = gg;
        data[i + 2] = bb;
        data[i + 3] = Math.round(alpha * 255);
      }
    }

    ctx.putImageData(img, 0, 0);

    const glowAngle = Math.atan2(sinT, -cosT);
    const glowX = cx + Math.cos(glowAngle) * r * 0.3;
    const glowY = cy;
    const g = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, r * 1.3);
    g.addColorStop(0, 'rgba(200,190,170,0.06)');
    g.addColorStop(1, 'rgba(200,190,170,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }, [ratio]);

  return (
    <div className="flex flex-col items-center py-4 gap-2">
      <canvas ref={canvasRef} style={{ width: 48, height: 48 }} />
      <div className="text-center">
        <div className="text-[10px] text-[#555] dark:text-[#777]">{today}</div>
        <div className="text-[10px] text-[#666] dark:text-[#888]">{name}</div>
      </div>
    </div>
  );
}
