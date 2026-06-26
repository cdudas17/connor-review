import { useEffect, useRef } from 'react';

/**
 * Single-canvas WebGL constellation. Draws N small "orbs" (the same wobbling
 * color-cycling circle as ShaderLoader) inside ONE WebGL context, instead of
 * mounting one canvas per orb.
 *
 * Why: each `<ShaderLoader>` instance allocates its own WebGL context, and
 * browsers cap simultaneous contexts per origin (~16). With 12 title orbs
 * plus the occasional drawer-loading shader plus Vite HMR leakage during
 * dev, we routinely blew the limit and the browser killed the oldest
 * contexts — orbs visually died and rendered as the broken-canvas
 * placeholder. One context, many orbs in the shader = no cap pressure.
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

  void main() {
    // Convert from WebGL's bottom-left origin to top-left so the JS
    // coordinates we pass in match what we see on screen.
    vec2 pos = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
    vec4 outColor = vec4(0.0);

    for (int i = 0; i < ${MAX_ORBS}; i++) {
      if (i >= u_orb_count) break;

      vec2 center = u_orb_positions[i];
      float r = u_orb_radii[i];
      vec2 local = (pos - center) / r;            // -1..1 within bounding box
      if (abs(local.x) > 1.0 || abs(local.y) > 1.0) continue;

      vec2 uv = local * 0.5 + 0.5;                 // 0..1
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const gl = canvas.getContext('webgl', { antialias: true, premultipliedAlpha: false });
    if (!gl) return;

    const compile = (type: number, source: string): WebGLShader | null => {
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

    const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[ShaderConstellation] program link failed:', gl.getProgramInfoLog(program));
      return;
    }

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'u_resolution');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uOrbCount = gl.getUniformLocation(program, 'u_orb_count');
    const uOrbPositions = gl.getUniformLocation(program, 'u_orb_positions');
    const uOrbRadii = gl.getUniformLocation(program, 'u_orb_radii');
    const uOrbOffsets = gl.getUniformLocation(program, 'u_orb_offsets');

    gl.useProgram(program);

    // Build the flat uniform arrays once per orbs-change. We compute orb
    // positions inside the render loop using the parent's bounding rect so
    // the canvas sizes correctly when the title text wraps / window resizes.
    const orbCount = Math.min(orbs.length, MAX_ORBS);
    const radiiPx = new Float32Array(MAX_ORBS);
    const offsets = new Float32Array(MAX_ORBS);
    for (let i = 0; i < orbCount; i++) {
      radiiPx[i] = orbs[i].size / 2;
      offsets[i] = orbs[i].offset;
    }

    const start = performance.now();
    let raf = 0;
    let cancelled = false;

    const render = () => {
      if (cancelled) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const wCss = Math.max(1, rect.width);
      const hCss = Math.max(1, rect.height);
      const w = Math.round(wCss * dpr);
      const h = Math.round(hCss * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
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
  }, [orbs]);

  return (
    <canvas
      ref={canvasRef}
      className="shader-constellation"
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
