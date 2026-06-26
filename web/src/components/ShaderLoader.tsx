import { useEffect, useRef } from 'react';

/**
 * Vibey WebGL loader — a wobbling, color-cycling circle that pulses on a
 * black background. Used for the drawer's "loading PR / issue…" state.
 *
 * Falls back to nothing if WebGL is unavailable; the caller already wraps
 * this with a textual label, so the spinner missing is graceful.
 *
 * Each instance owns its own WebGL context. Don't render dozens of these
 * at once — this is for the single full-drawer-loading slot, not for
 * inline tiny spinners (those still use `.loading-spinner` CSS).
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
  /** Rendered pixel size of the square canvas. */
  size?: number;
  /** Accessible label — surfaces to screen readers via aria-label.
   * Pass an empty string for decorative uses (the orb is rendered as
   * `aria-hidden` so screen readers skip it). */
  label?: string;
  /** Seconds added to `u_time` so multiple instances animate out of
   * phase. Defaults to 0. Pick a random value per instance to
   * desynchronise a field of orbs. */
  timeOffset?: number;
}

export function ShaderLoader({ size = 96, label = 'Loading', timeOffset = 0 }: Props) {
  const decorative = label === '';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: false });
    if (!gl) return; // graceful no-op when WebGL is unavailable

    const compile = (type: number, source: string): WebGLShader | null => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[ShaderLoader] shader compile failed:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    };

    const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[ShaderLoader] program link failed:', gl.getProgramInfoLog(program));
      return;
    }

    // Fullscreen quad — two triangles covering [-1, 1] in clip space.
    const quad = new Float32Array([-1, -1,  1, -1, -1, 1,  -1, 1,  1, -1,  1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'u_resolution');
    const uTime = gl.getUniformLocation(program, 'u_time');

    gl.useProgram(program);

    const start = performance.now();
    let raf = 0;
    let cancelled = false;

    const render = () => {
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, (performance.now() - start) / 1000 + timeOffset);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="shader-loader"
      style={{ width: size, height: size }}
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': label })}
    />
  );
}
