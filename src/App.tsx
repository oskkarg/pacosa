import { useEffect, useRef, useState } from "react";
import { Machine } from "./pico/machine";

const TABS: [string, string][] = [
  ["console", "CONSOLA"],
  ["code", "CÓDIGO"],
  ["sprite", "SPRITES"],
  ["map", "MAPA"],
  ["sfx", "SFX"],
  ["music", "MÚSICA"],
];

export default function App() {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mRef = useRef<Machine | null>(null);
  const [mode, setMode] = useState("console");
  const [scale, setScale] = useState(4);
  const [fs, setFs] = useState(false);

  useEffect(() => {
    const m = new Machine();
    mRef.current = m;
    m.onModeChange = (x: string) => setMode(x);
    m.onCopy = (t: string) => {
      const ta = taRef.current;
      if (!ta) return;
      ta.value = t;
      ta.select();
    };
    m.attach(canvasRef.current!, boxRef.current!);
    (window as any).__pico = m;

    const focus = () => taRef.current?.focus({ preventScroll: true });
    focus();
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      m.paste(e.clipboardData?.getData("text") ?? "");
    };
    const onKeyUp = () => {
      if (taRef.current) taRef.current.value = "";
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) m.loadText(f.name, await f.text());
    };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onFs = () => setFs(!!document.fullscreenElement);
    const resize = () => {
      const full = !!document.fullscreenElement;
      const w = window.innerWidth - (full ? 0 : 48);
      const h = window.innerHeight - (full ? 0 : 190);
      const s = Math.min(w, h) / 128;
      setScale(s >= 2 ? Math.floor(s) : Math.max(1, s));
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("paste", onPaste);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onOver);
    window.addEventListener("pointerdown", focus);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("fullscreenchange", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("pointerdown", focus);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("fullscreenchange", resize);
      m.dispose();
    };
  }, []);

  const m = () => mRef.current!;
  const go = (t: string) => {
    if (t === "console" || mode !== "run") {
      const mm = m();
      if (mm.mode === "run") mm.exitRun(true);
      mm.setMode(t);
    }
  };
  const btn =
    "px-3 py-1.5 rounded text-[11px] font-bold tracking-wider border transition-colors select-none";

  return (
    <div
      ref={boxRef}
      className="min-h-screen w-full flex flex-col items-center justify-center gap-4 bg-[#0d0d14] text-[#c2c3c7]"
      style={{ background: fs ? "#000" : "radial-gradient(ellipse at 50% 30%, #1d2b53 0%, #0d0d14 70%)" }}
    >
      <textarea
        ref={taRef}
        aria-hidden
        tabIndex={-1}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="fixed -left-[9999px] top-0 w-1 h-1 opacity-0"
      />
      {!fs && (
        <h1 className="text-[#ff77a8] font-mono font-bold tracking-[0.35em] text-sm sm:text-base">
          PICO-8 <span className="text-[#29adff]">FANTASY</span> CONSOLE
        </h1>
      )}
      <div
        className={fs ? "" : "p-3 rounded-xl bg-[#1a1a24] border-2 border-[#3a3a4d] shadow-[0_0_60px_rgba(41,173,255,0.15)]"}
      >
        <canvas
          ref={canvasRef}
          width={128}
          height={128}
          style={{ width: 128 * scale, height: 128 * scale, imageRendering: "pixelated", display: "block", background: "#000", cursor: "crosshair" }}
        />
      </div>
      {!fs && (
        <>
          <div className="flex flex-wrap justify-center gap-1.5 max-w-3xl px-3">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(id)}
                className={`${btn} ${
                  mode === id
                    ? "bg-[#ff004d] border-[#ff77a8] text-white"
                    : "bg-[#1d2b53] border-[#3a4a85] text-[#c2c3c7] hover:bg-[#2a3d78]"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="w-2" />
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => m().startRun(m().mode === "run" ? "console" : m().mode)}
              className={`${btn} bg-[#008751] border-[#00e436] text-white hover:bg-[#00a060]`}
            >
              ▶ EJECUTAR
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => m().openFileDialog()}
              className={`${btn} bg-[#5f574f] border-[#83769c] text-white hover:bg-[#6f675f]`}
            >
              CARGAR .P8
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => m().exportCart()}
              className={`${btn} bg-[#5f574f] border-[#83769c] text-white hover:bg-[#6f675f]`}
            >
              DESCARGAR .P8
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => m().toggleFullscreen()}
              className={`${btn} bg-[#5f574f] border-[#83769c] text-white hover:bg-[#6f675f]`}
            >
              ⛶
            </button>
          </div>
          <p className="font-mono text-[11px] text-[#83769c] text-center px-4 leading-relaxed">
            ESC consola ↔ editor · CTRL+R ejecutar · CTRL+S guardar · ALT+←/→ cambiar editor · ALT+ENTER pantalla completa
            <br />
            Juego: flechas + Z/X (o C/V) · P/ENTER pausa · En la consola escribe <b className="text-[#ffec27]">help</b>,{" "}
            <b className="text-[#ffec27]">load demo</b> o <b className="text-[#ffec27]">load pseudo3d</b>
          </p>
        </>
      )}
    </div>
  );
}
