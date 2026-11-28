import { useEffect, useRef, useState } from 'react';
import { isMobilePerf, prefersReducedMotion } from '../utils/perf';

const VERT_SRC = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision mediump float;
varying vec2 vUv;

uniform sampler2D uTex;
uniform float uTime;
uniform float uAmbient;
uniform float uAuraMode;
uniform vec3 uC1;
uniform vec3 uC2;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float easeOutCubic(float x) {
  float k = 1.0 - clamp(x, 0.0, 1.0);
  return 1.0 - k * k * k;
}

float easeOutBack(float x) {
  float t = clamp(x, 0.0, 1.0) - 1.0;
  float s = 1.18;
  return 1.0 + t * t * ((s + 1.0) * t + s);
}

void main() {
  vec2 p = (vUv - 0.5) * 2.64;

  float targetScale = mix(1.0, 0.70, uAuraMode);
  float targetR = mix(0.145, 0.58, uAuraMode);

  float pScale = easeOutBack(uTime / 0.68);
  float scale = mix(0.46, targetScale, pScale);
  float r = mix(0.72, targetR, easeOutCubic(uTime / 0.74));
  float fadeCover = smoothstep(0.0, 0.28, uTime);

  vec2 sp = p / max(scale, 0.01);
  float d = sdRoundedBox(sp, vec2(1.0), r);
  float rad = d + 1.0;

  float bloomLeft = 1.0 - smoothstep(0.95, 1.92, uTime);
  float waveProgress = easeOutCubic(uTime / 0.92);
  float waveR = mix(0.16, 1.48, waveProgress);
  float wDist = rad - waveR;
  float waveEnv = exp(-wDist * wDist * 32.0) * (1.0 - smoothstep(0.58, 1.06, uTime));

  float coverMask = (1.0 - smoothstep(-0.018, 0.014, d)) * mix(0.06, 1.0, fadeCover);

  vec3 col = vec3(0.0);
  float alpha = 0.0;

  vec2 dir = length(sp) > 0.0001 ? normalize(sp) : vec2(0.0, 1.0);
  float ang = atan(sp.y, sp.x);

  if (coverMask > 0.001) {
    float edgeLens = smoothstep(0.56, 1.0, rad) * (0.55 + 0.45 * bloomLeft);
    float disp = (waveEnv * 0.08 + edgeLens * bloomLeft * 0.03) * sin(wDist * 8.2 + 1.15);
    float ca = waveEnv * 0.034 + bloomLeft * smoothstep(0.66, 1.02, rad) * 0.024;

    vec2 baseUv = sp * 0.5 + 0.5;
    vec2 uvR = clamp(baseUv - dir * (disp + ca), 0.002, 0.998);
    vec2 uvG = clamp(baseUv - dir * disp, 0.002, 0.998);
    vec2 uvB = clamp(baseUv - dir * (disp - ca), 0.002, 0.998);

    float cr = texture2D(uTex, uvR).r;
    float cg = texture2D(uTex, uvG).g;
    float cb = texture2D(uTex, uvB).b;
    vec3 texCol = vec3(cr, cg, cb);

    float specWave = waveEnv * (0.28 + 0.25 * cos(ang * 2.0 + 0.7));
    texCol += vec3(1.0, 0.96, 0.92) * specWave * 0.42;

    col = texCol;
    alpha = coverMask;
  }

  float prismPhase = 0.5 + 0.5 * cos(ang * 2.0 - uAmbient * 0.8 + 0.75);
  float prismPhase2 = 0.5 + 0.5 * sin(ang * 3.0 + uAmbient * 0.65 - 0.5);
  vec3 warmGlow = mix(vec3(1.0, 0.76, 0.46), uC1, 0.42);
  vec3 coolGlow = mix(vec3(0.46, 0.84, 1.0), uC2, 0.42);
  vec3 prismCol = mix(warmGlow, coolGlow, prismPhase);
  prismCol = mix(prismCol, vec3(1.0, 0.98, 0.95), 0.36 * prismPhase2);

  float shockFade = smoothstep(0.03, 0.14, uTime) * (1.0 - smoothstep(0.52, 1.02, uTime));
  float outerD1 = d - mix(-0.18, 0.34, easeOutCubic(uTime / 0.88)) * targetScale;
  float ring1 = exp(-outerD1 * outerD1 * 155.0) * shockFade * 0.88;

  float outerD2 = d - mix(-0.28, 0.46, easeOutCubic((uTime - 0.08) / 0.92)) * targetScale;
  float ring2 = exp(-outerD2 * outerD2 * 115.0) * smoothstep(0.06, 0.2, uTime) * (1.0 - smoothstep(0.58, 1.06, uTime)) * 0.54;

  float rimEnv = exp(-abs(d) * 20.0) * smoothstep(-0.35, 0.08, d);
  float rimBloom = smoothstep(0.08, 0.34, uTime) * bloomLeft * 0.95;
  float rimStrength = rimEnv * rimBloom;

  float edgeAura = exp(-abs(d - 0.12) * 30.0) * bloomLeft * 0.3;

  vec3 glassAdd = prismCol * (ring1 + ring2 + rimStrength + edgeAura);
  float glassAlpha = clamp(ring1 * 0.92 + ring2 * 0.75 + rimStrength * 0.85 + edgeAura * 0.7, 0.0, 0.96);

  if (coverMask > 0.001) {
    col = mix(col, min(col + glassAdd, vec3(1.12)), clamp(glassAlpha * 0.85, 0.0, 1.0));
  }
  if (coverMask < 0.99) {
    col = mix(glassAdd, col, coverMask);
    alpha = max(alpha, glassAlpha);
  }

  alpha = clamp(alpha, 0.0, 1.0);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * alpha, alpha);
}
`;

function hexToRgb01(hex, fallback) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export default function LiquidCoverStage({
  src,
  videoSrc,
  alt,
  playing,
  active,
  artMode = 'aura',
  triggerKey = 0,
  auraC1 = '#e4be8b',
  auraC2 = '#7692d8',
  onClick,
}) {
  const canvasRef = useRef(null);
  const glStateRef = useRef(null);
  const [glReady, setGlReady] = useState(false);
  const [glFailed, setGlFailed] = useState(() => prefersReducedMotion());
  const [settled, setSettled] = useState(() => prefersReducedMotion());
  const [canvasAlive, setCanvasAlive] = useState(false);

  const propsRef = useRef({ src, playing, active, artMode, auraC1, auraC2, triggerKey });
  propsRef.current = { src, playing, active, artMode, auraC1, auraC2, triggerKey };

  // Trigger 1.95s liquid bloom when player opens, song changes, or user taps cover
  useEffect(() => {
    if (!active) return undefined;
    const st = glStateRef.current;
    if (st) {
      st.bloomStart = performance.now();
      st.restart?.();
    }
    if (prefersReducedMotion()) {
      setSettled(true);
      setCanvasAlive(false);
      return undefined;
    }
    setSettled(false);
    setCanvasAlive(true);
    const tSettle = setTimeout(() => setSettled(true), 1720);
    const tHide = setTimeout(() => setCanvasAlive(false), 2050);
    return () => {
      clearTimeout(tSettle);
      clearTimeout(tHide);
    };
  }, [triggerKey, src, active]);

  // Initialize WebGL program once
  useEffect(() => {
    if (glFailed) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      powerPreference: 'default',
    });
    if (!gl) {
      setGlFailed(true);
      return undefined;
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) {
      setGlFailed(true);
      return undefined;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      setGlFailed(true);
      return undefined;
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([30, 30, 36, 255]));

    const uniforms = {
      uTex: gl.getUniformLocation(prog, 'uTex'),
      uTime: gl.getUniformLocation(prog, 'uTime'),
      uAmbient: gl.getUniformLocation(prog, 'uAmbient'),
      uAuraMode: gl.getUniformLocation(prog, 'uAuraMode'),
      uC1: gl.getUniformLocation(prog, 'uC1'),
      uC2: gl.getUniformLocation(prog, 'uC2'),
    };

    const st = {
      gl,
      prog,
      tex,
      uniforms,
      hasTex: false,
      bloomStart: performance.now(),
      ambient: 0,
      lastFrame: performance.now(),
      raf: 0,
      destroyed: false,
      restart: null,
    };
    glStateRef.current = st;

    const resize = () => {
      const mobile = isMobilePerf();
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
      const maxDim = mobile ? 440 : 620;
      const w = Math.max(240, Math.min(maxDim, Math.round((rect.width || 320) * dpr)));
      const h = Math.max(240, Math.min(maxDim, Math.round((rect.height || 320) * dpr)));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const draw = (now) => {
      st.raf = 0;
      if (st.destroyed) return;
      const p = propsRef.current;
      if (!p.active || !st.hasTex) return;

      const dt = Math.min(0.05, Math.max(0.001, (now - st.lastFrame) / 1000));
      st.lastFrame = now;

      const elapsed = Math.max(0, (now - st.bloomStart) / 1000);
      if (elapsed >= 2.08) return;
      st.ambient += dt;

      resize();
      gl.useProgram(prog);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uniforms.uTex, 0);
      gl.uniform1f(uniforms.uTime, elapsed);
      gl.uniform1f(uniforms.uAmbient, st.ambient);
      gl.uniform1f(uniforms.uAuraMode, p.artMode === 'aura' ? 1.0 : 0.0);

      const c1 = hexToRgb01(p.auraC1, [0.9, 0.74, 0.54]);
      const c2 = hexToRgb01(p.auraC2, [0.46, 0.57, 0.85]);
      gl.uniform3f(uniforms.uC1, c1[0], c1[1], c1[2]);
      gl.uniform3f(uniforms.uC2, c2[0], c2[1], c2[2]);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (!prefersReducedMotion() && !document.hidden) {
        st.raf = requestAnimationFrame(draw);
      }
    };

    st.restart = () => {
      if (st.destroyed || !propsRef.current.active || !st.hasTex) return;
      if (!st.raf) {
        st.lastFrame = performance.now();
        st.raf = requestAnimationFrame(draw);
      }
    };

    const onVis = () => {
      if (!document.hidden) st.restart();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      st.destroyed = true;
      if (st.raf) cancelAnimationFrame(st.raf);
      document.removeEventListener('visibilitychange', onVis);
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      glStateRef.current = null;
    };
  }, [glFailed]);

  // Upload artwork texture with CORS support (falls back to CSS liquid bloom if blocked)
  useEffect(() => {
    if (glFailed || !src) return undefined;
    let alive = true;
    setGlReady(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      if (!alive || !glStateRef.current) return;
      try {
        const { gl, tex } = glStateRef.current;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        glStateRef.current.hasTex = true;
        glStateRef.current.bloomStart = performance.now();
        setGlReady(true);
        glStateRef.current.restart?.();
      } catch {
        setGlFailed(true);
      }
    };
    img.onerror = () => {
      if (alive) setGlReady(false);
    };
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src, glFailed]);

  useEffect(() => {
    if (active && glReady && canvasAlive) {
      glStateRef.current?.restart?.();
    }
  }, [active, glReady, canvasAlive, artMode]);

  const showCanvas = glReady && !glFailed && active && canvasAlive;
  const showCssFallbackBloom = (!glReady || glFailed) && active && !settled;

  return (
    <div
      className={`np-liquid-stage ${glReady && !glFailed ? 'gl-ready' : ''} ${settled ? 'settled' : 'blooming'} ${showCssFallbackBloom ? 'css-bloom' : ''}`}
      onClick={onClick}
    >
      {!glFailed && (
        <canvas
          ref={canvasRef}
          className={`np-liquid-canvas ${showCanvas ? 'vis' : ''}`}
          aria-hidden="true"
        />
      )}

      {showCssFallbackBloom && (
        <span key={`css-${triggerKey}`} className="np-shock-rings" aria-hidden="true">
          <span className="np-shock-r1" />
          <span className="np-shock-r2" />
        </span>
      )}

      <div className="np-aura-shell">
        <span className="np-aura-ring np-aura-r3" aria-hidden="true" />
        <span className="np-aura-ring np-aura-r2" aria-hidden="true" />
        <span className="np-aura-ring np-aura-r1" aria-hidden="true" />
        <div
          key={`media-${triggerKey}-${showCssFallbackBloom ? 'css' : 'gl'}`}
          className={`np-art-frame np-liquid-media ${showCanvas && !settled ? 'behind-gl' : 'front-crisp'}`}
        >
          {videoSrc && active ? (
            <video
              key={videoSrc}
              className="np-video-art"
              src={videoSrc}
              poster={src}
              autoPlay
              loop
              muted
              playsInline
            />
          ) : (
            <img src={src} alt={alt} decoding="async" />
          )}
        </div>
      </div>
    </div>
  );
}
