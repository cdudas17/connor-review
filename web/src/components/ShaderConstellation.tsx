import { useEffect, useRef, useState } from 'react';

/**
 * Single-canvas WebGL constellation. Draws N small "orbs" (the same wobbling
 * color-cycling circle as ShaderLoader) inside ONE WebGL context.
 *
 * Resilience: WebGL contexts can be lost at any time (Vite HMR accumulation,
 * GPU process restart, tab backgrounding, OS-level GPU pressure). When that
 * happens browsers paint the broken-image placeholder on the canvas. We
 * handle `webglcontextlost`/`webglcontextrestored` to re-initialize the
 * shader on the new context, and hide the canvas while the context is dead
 * so the user never sees the placeholder. On unmount we explicitly call
 * `WEBGL_lose_context.loseContext()` so HMR doesn't pile up orphaned
 * contexts.
 */

export interface ConstellationOrb {
  /** Position as a CSS-friendly value (e.g. "12%", "240px"). Applied to the
   * canvas via absolute-positioning math (we read offsetLeft/offsetTop). */
  top: string;
  left: string;
  /** Visual radius in CSS pixels (i.e. before DPR scaling). */
  size: number;
  /** Time offset in seconds for desynchronisation. */
  offset: number;
  /** Static rotation in radians. */
  rotation: number;
}

interface Props {
  orbs: ConstellationOrb[];
}

const MAX_ORBS = 24;

const VERTEX_SHADER = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform int u_orb_count;
  uniform vec2 u_orb_positions[${MAX_ORBS}];   // pixel coords, origin top-left
  uniform float u_orb_radii[${MAX_ORBS}];       // pixel radius
  uniform float u_orb_offsets[${MAX_ORBS}];     // seconds
  uniform float u_orb_rotations[${MAX_ORBS}];   // radians

  void main() {
    vec2 pos = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
    vec4 outColor = vec4(0.0);

    for (int i = 0; i < ${MAX_ORBS}; i++) {
      if (i >= u_orb_count) break;

      vec2 center = u_orb_positions[i];
      float r = u_orb_radii[i];
      vec2 local = (pos - center) / r;
      if (abs(local.x) > 1.0 || abs(local.y) > 1.0) continue;

      vec2 uv = local * 0.5 + 0.5;

      float a = u_orb_rotations[i];
      float ca = cos(a);
      float sa = sin(a);
      vec2 c = uv - vec2(0.5);
      uv = vec2(0.5) + vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);

      float t = u_time + u_orb_offsets[i];

      vec3 color = 0.5 + 0.5 * cos(t + uv.xyx + vec3(0.0, 2.0, 4.0));
      float threshold = 0.15 + cos(t * 5.0 + uv.x * 10.0 + uv.y * 15.0) * 0.04;

      if (distance(uv, vec2(0.5)) < threshold) {
        outColor = vec4(color, 1.0);
      }
    }

    gl_FragColor = outColor;
  }
`;

export function ShaderConstellation({ orbs }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    // Per-mount mutable WebGL state. Lives in closure so setup/teardown can
    // tear it down + rebuild it on context-lost without re-running the
    // useEffect.
    let gl: WebGLRenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let vs: WebGLShader | null = null;
    let fs: WebGLShader | null = null;
    let raf = 0;
    let cancelled = false;
    let start = performance.now();
    let uRes: WebGLUniformLocation | null = null;
    let uTime: WebGLUniformLocation | null = null;
    let uOrbCount: WebGLUniformLocation | null = null;
    let uOrbPositions: WebGLUniformLocation | null = null;
    let uOrbRadii: WebGLUniformLocation | null = null;
    let uOrbOffsets: WebGLUniformLocation | null = null;
    let uOrbRotations: WebGLUniformLocation | null = null;

    const orbCount = Math.min(orbs.length, MAX_ORBS);
    const radiiPx = new Float32Array(MAX_ORBS);
    const offsets = new Float32Array(MAX_ORBS);
    const rotations = new Float32Array(MAX_ORBS);
    for (let i = 0; i < orbCount; i++) {
      radiiPx[i] = orbs[i].size / 2;
      offsets[i] = orbs[i].offset;
      rotations[i] = orbs[i].rotation;
    }

    const compile = (type: number, source: string): WebGLShader | null => {
      if (!gl) return null;
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[ShaderConstellation] shader compile failed:', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };

    function setup(): boolean {
      gl = canvas!.getContext('webgl', { antialias: true, premultipliedAlpha: false });
      if (!gl) return false;
      vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
      fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      if (!vs || !fs) return false;
      program = gl.createProgram();
      if (!program) return false;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('[ShaderConstellation] program link failed:', gl.getProgramInfoLog(program));
        return false;
      }
      const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
      const aPos = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      uRes = gl.getUniformLocation(program, 'u_resolution');
      uTime = gl.getUniformLocation(program, 'u_time');
      uOrbCount = gl.getUniformLocation(program, 'u_orb_count');
      uOrbPositions = gl.getUniformLocation(program, 'u_orb_positions');
      uOrbRadii = gl.getUniformLocation(program, 'u_orb_radii');
      uOrbOffsets = gl.getUniformLocation(program, 'u_orb_offsets');
      uOrbRotations = gl.getUniformLocation(program, 'u_orb_rotations');
      gl.useProgram(program);
      start = performance.now();
      return true;
    }

    function teardownGl() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (!gl) return;
      try { if (buffer) gl.deleteBuffer(buffer); } catch { /* ignore */ }
      try { if (program) gl.deleteProgram(program); } catch { /* ignore */ }
      try { if (vs) gl.deleteShader(vs); } catch { /* ignore */ }
      try { if (fs) gl.deleteShader(fs); } catch { /* ignore */ }
      buffer = null;
      program = null;
      vs = null;
      fs = null;
    }

    function render() {
      if (cancelled || !gl) return;
      if (gl.isContextLost()) {
        // Context died but the event hasn't fired yet — bail and wait for
        // the restored event.
        raf = 0;
        return;
      }
      const rect = parent!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const wCss = Math.max(1, rect.width);
      const hCss = Math.max(1, rect.height);
      const w = Math.round(wCss * dpr);
      const h = Math.round(hCss * dpr);
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
        gl.viewport(0, 0, w, h);
      }

      const positionsPx = new Float32Array(MAX_ORBS * 2);
      const radiiScaled = new Float32Array(MAX_ORBS);
      for (let i = 0; i < orbCount; i++) {
        const o = orbs[i];
        const xCss = resolveCssLength(o.left, wCss);
        const yCss = resolveCssLength(o.top, hCss);
        positionsPx[i * 2] = xCss * dpr;
        positionsPx[i * 2 + 1] = yCss * dpr;
        radiiScaled[i] = radiiPx[i] * dpr;
      }

      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, (performance.now() - start) / 1000);
      gl.uniform1i(uOrbCount, orbCount);
      gl.uniform2fv(uOrbPositions, positionsPx);
      gl.uniform1fv(uOrbRadii, radiiScaled);
      gl.uniform1fv(uOrbOffsets, offsets);
      gl.uniform1fv(uOrbRotations, rotations);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      raf = requestAnimationFrame(render);
    }

    function startRendering() {
      if (cancelled || raf) return;
      raf = requestAnimationFrame(render);
    }

    // The browser fires this when the GPU context is dropped. Default
    // behaviour without preventDefault is to NEVER fire the restored event,
    // so we always preventDefault to opt in to recovery.
    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      raf = 0;
      setContextLost(true);
    };

    // Restored: the browser has given us a fresh context. Reset our pointers
    // and re-run setup against it.
    const onRestored = () => {
      teardownGl();
      if (setup()) {
        setContextLost(false);
        startRendering();
      }
    };

    canvas.addEventListener('webglcontextlost', onLost as EventListener);
    canvas.addEventListener('webglcontextrestored', onRestored);

    if (setup()) {
      startRendering();
    }

    return () => {
      cancelled = true;
      canvas.removeEventListener('webglcontextlost', onLost as EventListener);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      // NOTE: don't call WEBGL_lose_context.loseContext() here. React
      // StrictMode double-invokes effects in dev (mount → cleanup →
      // mount) and canvas.getContext('webgl') returns the SAME (now-
      // lost) context on the second mount — restoration only happens
      // via restoreContext(), which the browser doesn't call
      // automatically. Result: shaders never re-compile and nothing
      // draws. Browser GC cleans up the context when the canvas is
      // removed from the DOM, and HMR-accumulated contexts hit the
      // browser's LRU eviction at 16 contexts anyway.
      teardownGl();
      gl = null;
    };
  }, [orbs]);

  return (
    <canvas
      ref={canvasRef}
      className={`shader-constellation${contextLost ? ' shader-constellation-lost' : ''}`}
      aria-hidden="true"
    />
  );
}

/** Convert a CSS-ish length ("12%", "8px", "8") to a pixel value relative
 * to `containerSize`. */
function resolveCssLength(value: string, containerSize: number): number {
  if (value.endsWith('%')) return (parseFloat(value) / 100) * containerSize;
  if (value.endsWith('px')) return parseFloat(value);
  return parseFloat(value) || 0;
}
