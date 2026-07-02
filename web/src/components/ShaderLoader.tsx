import { useEffect, useRef, useState } from 'react';

/**
 * Vibey WebGL loader — a wobbling, color-cycling circle that pulses.
 * Used for the drawer's "loading PR / issue…" state.
 *
 * Same context-loss handling as ShaderConstellation: listens for
 * webglcontextlost/restored, hides the canvas while the context is
 * dead so the broken-image placeholder never shows, explicitly drops
 * the context on unmount via WEBGL_lose_context.
 */

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

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec3 color = 0.5 + 0.5 * cos(u_time + uv.xyx + vec3(0.0, 2.0, 4.0));
    float alpha = 1.0;
    if (distance(uv, vec2(0.5, 0.5)) > 0.15 + cos((u_time*5.0)+uv.x*10.0+uv.y*15.0) * 0.04) {
      alpha = 0.0;
    }
    gl_FragColor = vec4(color, alpha);
  }
`;

interface Props {
  size?: number;
  label?: string;
  timeOffset?: number;
}

export function ShaderLoader({ size = 96, label = 'Loading', timeOffset = 0 }: Props) {
  const decorative = label === '';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let gl: WebGLRenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let vs: WebGLShader | null = null;
    let fs: WebGLShader | null = null;
    let uRes: WebGLUniformLocation | null = null;
    let uTime: WebGLUniformLocation | null = null;
    let raf = 0;
    let cancelled = false;
    let start = performance.now();

    const compile = (type: number, source: string): WebGLShader | null => {
      if (!gl) return null;
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[ShaderLoader] shader compile failed:', gl.getShaderInfoLog(s));
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
        console.error('[ShaderLoader] program link failed:', gl.getProgramInfoLog(program));
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
      buffer = null; program = null; vs = null; fs = null;
    }

    function render() {
      if (cancelled || !gl) return;
      if (gl.isContextLost()) { raf = 0; return; }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas!.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas!.clientHeight * dpr));
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, (performance.now() - start) / 1000 + timeOffset);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(render);
    }

    function startRendering() {
      if (cancelled || raf) return;
      raf = requestAnimationFrame(render);
    }

    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      raf = 0;
      setContextLost(true);
    };

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
      // See ShaderConstellation for why loseContext() is NOT called on
      // unmount: StrictMode's cleanup+remount cycle loses the context
      // then can't recover it, and shaders never re-compile on the
      // second mount.
      teardownGl();
      gl = null;
    };
  }, [timeOffset]);

  return (
    <canvas
      ref={canvasRef}
      className={`shader-loader${contextLost ? ' shader-loader-lost' : ''}`}
      style={{ width: size, height: size }}
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': label })}
    />
  );
}
