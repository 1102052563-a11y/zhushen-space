import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface DepthParallaxHandle {
  setOffset: (ox: number, oy: number) => void;   // ox,oy ∈ 约 [-1,1]，来自指针/旋转
}

interface Props {
  color: string;      // 立绘/物品图 URL
  depth: string;      // 深度图 URL（灰度，亮=近）
  width: number;
  height: number;
  strength?: number;  // 视差强度（UV 位移比例），默认 0.14
  style?: React.CSSProperties;
}

const VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)/2.,(1.-p.y)/2.);gl_Position=vec4(p,0.,1.);}';
const FS = 'precision mediump float;varying vec2 uv;uniform sampler2D col;uniform sampler2D dep;uniform vec2 off;void main(){float d=texture2D(dep,uv).r-0.45;vec2 u=uv-off*d;u=clamp(u,0.001,0.999);gl_FragColor=texture2D(col,u);}';

/** 深度视差层：彩色图 + 深度图，片元着色器按深度偏移 UV。setOffset 更新视差。WebGL 不可用/贴图缺失时回退平面 <img>。 */
const DepthParallax = forwardRef<DepthParallaxHandle, Props>(function DepthParallax(
  { color, depth, width, height, strength = 0.14, style }, ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);   // 回退用
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const offRef = useRef<WebGLUniformLocation | null>(null);
  const drawRef = useRef<(ox: number, oy: number) => void>(() => {});

  useImperativeHandle(ref, () => ({
    setOffset: (ox, oy) => drawRef.current(ox * strength, oy * strength),
  }), [strength]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let gl: WebGLRenderingContext | null = null;
    const glOpts = { preserveDrawingBuffer: true, premultipliedAlpha: false } as WebGLContextAttributes;
    try { gl = (cv.getContext('webgl', glOpts) || cv.getContext('experimental-webgl', glOpts)) as WebGLRenderingContext | null; } catch { gl = null; }
    if (!gl) { if (imgRef.current) imgRef.current.style.display = 'block'; return; }
    glRef.current = gl;

    const sh = (t: number, s: string) => { const o = gl!.createShader(t)!; gl!.shaderSource(o, s); gl!.compileShader(o); return o; };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const lp = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(lp);
    gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
    offRef.current = gl.getUniformLocation(pr, 'off');
    const uCol = gl.getUniformLocation(pr, 'col'), uDep = gl.getUniformLocation(pr, 'dep');

    let loaded = 0, alive = true;
    const ci = new Image(), di = new Image();
    // 仅对跨域 http 图设 crossOrigin（防污染纹理）；data: URL 设了反而在部分浏览器不解码 → 纹理空白
    if (/^https?:/i.test(color)) ci.crossOrigin = 'anonymous';
    if (/^https?:/i.test(depth)) di.crossOrigin = 'anonymous';
    const mkTex = (unit: number, img: HTMLImageElement, loc: WebGLUniformLocation | null) => {
      // 先画到 2D canvas：保证任何来源(含 SVG / 异步解码未就绪)都是就绪光栅，避免上传空白黑纹理
      let src: TexImageSource = img;
      try {
        const tc = document.createElement('canvas');
        tc.width = img.naturalWidth || img.width || 512;
        tc.height = img.naturalHeight || img.height || 512;
        tc.getContext('2d')!.drawImage(img, 0, 0, tc.width, tc.height);
        src = tc;
      } catch { src = img; }
      const t = gl!.createTexture();
      gl!.activeTexture(gl!.TEXTURE0 + unit);
      gl!.bindTexture(gl!.TEXTURE_2D, t);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, src);
      gl!.uniform1i(loc, unit);
    };
    const draw = (ox = 0, oy = 0) => {
      if (!alive || loaded < 2 || !glRef.current) return;
      gl!.uniform2f(offRef.current, ox, oy);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    };
    drawRef.current = draw;
    const onLoad = async () => {
      if (++loaded < 2 || !alive) return;
      try { await Promise.all([ci.decode?.(), di.decode?.()].filter(Boolean)); } catch { /* 解码兜底：失败也继续 */ }
      if (!alive) return;
      mkTex(0, ci, uCol); mkTex(1, di, uDep);
      draw(0, 0);
    };
    const onErr = () => { if (imgRef.current) imgRef.current.style.display = 'block'; if (canvasRef.current) canvasRef.current.style.display = 'none'; };
    ci.onload = onLoad; di.onload = onLoad; ci.onerror = onErr; di.onerror = onErr;
    ci.src = color; di.src = depth;

    return () => { alive = false; drawRef.current = () => {}; glRef.current = null; };
  }, [color, depth]);

  return (
    <div style={{ position: 'absolute', inset: 0, ...style }}>
      <canvas ref={canvasRef} width={width} height={height} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <img ref={imgRef} src={color} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'none' }} />
    </div>
  );
});

export default DepthParallax;
