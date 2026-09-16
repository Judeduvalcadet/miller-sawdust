import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Pencil, MoveUpRight, Type, Undo2, Trash2, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const COLORS = ['#EF4444', '#FACC15', '#111827', '#FFFFFF'];

// The editor is portaled OUTSIDE the modal dialog that opened it, and a
// modal dialog relentlessly pulls keyboard focus back inside itself — a
// focusable text input out here loses focus (and its content) instantly.
// So the text tool doesn't use focus at all: while a text box is active,
// keystrokes are intercepted document-wide in the capture phase, before the
// dialog's focused field can receive them, and typed into the box manually.

// Simple full-screen markup editor over a captured map image.
// Tools: pencil (freehand), arrow, text. Color + thickness. Undo / clear.
// onSave(blob) receives the final PNG; onClose() cancels.
export default function MapSnapshotEditor({ image, onSave, onClose, saving = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const opsRef = useRef([]);
  const draftRef = useRef(null);
  const [tool, setTool] = useState('pencil');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(8);
  const [opsCount, setOpsCount] = useState(0);
  const [textBox, setTextBox] = useState(null); // { x, y, screenX, screenY, value }

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    for (const op of [...opsRef.current, ...(draftRef.current ? [draftRef.current] : [])]) {
      ctx.strokeStyle = op.color;
      ctx.fillStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (op.type === 'path' && op.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(op.points[0].x, op.points[0].y);
        for (const p of op.points.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else if (op.type === 'arrow') {
        const { from, to } = op;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const head = Math.max(18, op.width * 3.2);
        ctx.beginPath();
        ctx.moveTo(to.x, to.y);
        ctx.lineTo(to.x - head * Math.cos(angle - 0.45), to.y - head * Math.sin(angle - 0.45));
        ctx.lineTo(to.x - head * Math.cos(angle + 0.45), to.y - head * Math.sin(angle + 0.45));
        ctx.closePath(); ctx.fill();
      } else if (op.type === 'text') {
        const px = 30 + op.width * 1.6;
        ctx.font = `700 ${px}px system-ui, sans-serif`;
        ctx.lineWidth = Math.max(3, px / 8);
        ctx.strokeStyle = op.color === '#FFFFFF' ? '#111827' : '#FFFFFF';
        ctx.strokeText(op.text, op.x, op.y);
        ctx.fillText(op.text, op.x, op.y);
      }
    }
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      canvas.width = img.width;
      canvas.height = img.height;
      redraw();
    };
    img.src = image;
  }, [image, redraw]);

  const toCanvasPoint = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const commitDraft = () => {
    if (draftRef.current) {
      opsRef.current.push(draftRef.current);
      draftRef.current = null;
      setOpsCount(opsRef.current.length);
    }
  };

  const onPointerDown = (e) => {
    if (textBox) return; // finish the text box first
    e.preventDefault();
    const p = toCanvasPoint(e);
    if (tool === 'text') {
      const rect = canvasRef.current.getBoundingClientRect();
      setTextBox({ x: p.x, y: p.y, screenX: e.clientX - rect.left, screenY: e.clientY - rect.top, value: '' });
      // Pull focus into the main document (it may sit inside the map frame)
      // so the document-level keystroke capture sees the typing.
      rootRef.current?.focus();
      return;
    }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic input */ }
    draftRef.current = tool === 'pencil'
      ? { type: 'path', points: [p], color, width: size }
      : { type: 'arrow', from: p, to: p, color, width: size };
    redraw();
  };

  const onPointerMove = (e) => {
    if (!draftRef.current) return;
    const p = toCanvasPoint(e);
    if (draftRef.current.type === 'path') draftRef.current.points.push(p);
    else draftRef.current.to = p;
    redraw();
  };

  const onPointerUp = () => { commitDraft(); redraw(); };

  const commitText = () => {
    setTextBox(current => {
      if (current?.value.trim()) {
        opsRef.current.push({ type: 'text', x: current.x, y: current.y, text: current.value.trim(), color, width: size });
        setOpsCount(opsRef.current.length);
      }
      return null;
    });
    setTimeout(redraw, 0);
  };

  // Global keystroke capture while a text box is active (see note above).
  useEffect(() => {
    if (!textBox) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Enter') { commitText(); return; }
      if (e.key === 'Escape') { setTextBox(null); return; }
      if (e.key === 'Backspace') {
        setTextBox(t => t ? { ...t, value: e.metaKey || e.ctrlKey ? '' : t.value.slice(0, -1) } : t);
        return;
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setTextBox(t => t ? { ...t, value: (t.value + e.key).slice(0, 80) } : t);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [!!textBox]);

  const undo = () => { opsRef.current.pop(); setOpsCount(opsRef.current.length); redraw(); };
  const clearAll = () => { opsRef.current = []; setOpsCount(0); redraw(); };

  const save = () => {
    commitDraft();
    redraw();
    canvasRef.current.toBlob((blob) => { if (blob) onSave(blob); }, 'image/png', 0.92);
  };

  const ToolBtn = ({ active, onClick, children, title }) => (
    <button
      type="button" onClick={onClick} title={title}
      className={cn('p-2 rounded-lg transition-colors', active ? 'bg-gray-950 text-white' : 'text-gray-600 hover:bg-gray-100')}
    >
      {children}
    </button>
  );

  // Portal to <body>: ancestors with CSS transforms (the radix dialog) would
  // otherwise trap this fixed overlay inside their box. pointer-events must be
  // re-enabled explicitly — the open modal dialog sets pointer-events:none on
  // everything outside itself, which this portal inherits and clicks would
  // fall through to the page behind.
  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-3 sm:p-6 outline-none"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden max-h-full">
        {/* Toolbar */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-200 flex-wrap">
          <ToolBtn active={tool === 'pencil'} onClick={() => setTool('pencil')} title="Pencil"><Pencil className="w-4 h-4" /></ToolBtn>
          <ToolBtn active={tool === 'arrow'} onClick={() => setTool('arrow')} title="Arrow"><MoveUpRight className="w-4 h-4" /></ToolBtn>
          <ToolBtn active={tool === 'text'} onClick={() => setTool('text')} title="Text"><Type className="w-4 h-4" /></ToolBtn>
          <div className="w-px h-6 bg-gray-200 mx-1" />
          {COLORS.map(c => (
            <button
              key={c} type="button" onClick={() => setColor(c)} title={c}
              className={cn('w-6 h-6 rounded-full border-2 transition-transform', color === c ? 'border-gray-900 scale-110' : 'border-gray-300')}
              style={{ backgroundColor: c }}
            />
          ))}
          <div className="w-px h-6 bg-gray-200 mx-1" />
          <div className="flex items-center gap-1.5 px-1" title="Line thickness">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" />
            <input
              type="range"
              min={2}
              max={24}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-24 sm:w-32 accent-gray-900 cursor-pointer"
              aria-label="Line thickness"
            />
            <span className="w-4 h-4 rounded-full bg-gray-500 shrink-0" />
          </div>
          <div className="flex-1" />
          <ToolBtn onClick={undo} title="Undo"><Undo2 className="w-4 h-4" /></ToolBtn>
          <ToolBtn onClick={clearAll} title="Clear all"><Trash2 className="w-4 h-4" /></ToolBtn>
          <ToolBtn onClick={onClose} title="Close"><X className="w-4 h-4" /></ToolBtn>
        </div>

        {/* Canvas */}
        <div className="relative overflow-auto bg-gray-100 flex-1 min-h-0">
          <canvas
            ref={canvasRef}
            className="w-full h-auto select-none"
            style={{ touchAction: 'none', cursor: tool === 'text' ? 'text' : 'crosshair' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          {textBox && (
            <div
              className="absolute z-10 px-2 py-1 text-sm font-bold border-2 border-gray-900 rounded bg-white/95 whitespace-nowrap select-none"
              style={{ left: textBox.screenX, top: textBox.screenY, color: color === '#FFFFFF' ? '#111827' : color }}
            >
              {textBox.value || <span className="text-gray-400 font-normal">Type, then Enter</span>}
              <span className="animate-pulse font-normal">|</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
          <p className="text-xs text-gray-500">Circle the spot, add arrows or a note — drivers will see this picture.</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="button" onClick={save} disabled={saving} className="bg-gray-950 hover:bg-gray-800">
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save picture
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
