(function () {
  const canvas = document.getElementById('dither-canvas');
  if (!canvas) return;

  const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true }) || canvas.getContext('experimental-webgl');
  if (!gl) return;

  // --- Shaders ---
  const vertexSrc = `
    attribute vec2 position;
    void main() {
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  const fragmentSrc = `
    precision highp float;
    uniform vec2 resolution;

    // Palette extracted from sunset dither
    const vec3 colorDark   = vec3(0.047, 0.051, 0.039); // Deep dark olive/black
    const vec3 colorOlive  = vec3(0.471, 0.502, 0.157); // Muted olive gold
    const vec3 colorOrange = vec3(0.922, 0.306, 0.106); // Glowing burnt orange

    // 8x8 Bayer Matrix Dither
    const float bayerMatrix8x8[64] = float[64](
       0.0/64.0, 48.0/64.0, 12.0/64.0, 60.0/64.0,  3.0/64.0, 51.0/64.0, 15.0/64.0, 63.0/64.0,
      32.0/64.0, 16.0/64.0, 44.0/64.0, 28.0/64.0, 35.0/64.0, 19.0/64.0, 47.0/64.0, 31.0/64.0,
       8.0/64.0, 56.0/64.0,  4.0/64.0, 52.0/64.0, 11.0/64.0, 59.0/64.0,  7.0/64.0, 55.0/64.0,
      40.0/64.0, 24.0/64.0, 36.0/64.0, 20.0/64.0, 43.0/64.0, 27.0/64.0, 39.0/64.0, 23.0/64.0,
       2.0/64.0, 50.0/64.0, 14.0/64.0, 62.0/64.0,  1.0/64.0, 49.0/64.0, 13.0/64.0, 61.0/64.0,
      34.0/64.0, 18.0/64.0, 46.0/64.0, 30.0/64.0, 33.0/64.0, 17.0/64.0, 45.0/64.0, 29.0/64.0,
      10.0/64.0, 58.0/64.0,  6.0/64.0, 54.0/64.0,  9.0/64.0, 57.0/64.0,  5.0/64.0, 53.0/64.0,
      42.0/64.0, 26.0/64.0, 38.0/64.0, 22.0/64.0, 41.0/64.0, 25.0/64.0, 37.0/64.0, 21.0/64.0
    );

    // Simplex/Perlin noise helper functions
    vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    vec2 fade(vec2 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

    float cnoise(vec2 P) {
      vec4 Pi = floor(P.xyxy) + vec4(0.0,0.0,1.0,1.0);
      vec4 Pf = fract(P.xyxy) - vec4(0.0,0.0,1.0,1.0);
      Pi = mod289(Pi);
      vec4 ix = Pi.xzxz, iy = Pi.yyww;
      vec4 fx = Pf.xzxz, fy = Pf.yyww;
      vec4 i = permute(permute(ix) + iy);
      vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
      vec4 gy = abs(gx) - 0.5;
      vec4 tx = floor(gx + 0.5);
      gx = gx - tx;
      vec2 g00 = vec2(gx.x, gy.x), g10 = vec2(gx.y, gy.y);
      vec2 g01 = vec2(gx.z, gy.z), g11 = vec2(gx.w, gy.w);
      vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
      g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
      float n00 = dot(g00, vec2(fx.x, fy.x));
      float n10 = dot(g10, vec2(fx.y, fy.y));
      float n01 = dot(g01, vec2(fx.z, fy.z));
      float n11 = dot(g11, vec2(fx.w, fy.w));
      vec2 fade_xy = fade(Pf.xy);
      vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
      return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amp = 1.0;
      for (int i = 0; i < 4; i++) {
        value += amp * abs(cnoise(p));
        p *= 2.0;
        amp *= 0.35;
      }
      return value;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      vec2 aspectUV = uv - 0.5;
      aspectUV.x *= resolution.x / resolution.y;

      // Static organic field
      float wave = fbm(aspectUV * 2.4 + vec2(1.2, 0.8));

      // Multi-stop color blend based on wave density
      vec3 baseColor = mix(colorDark, colorOlive, smoothstep(0.1, 0.65, wave));
      baseColor = mix(baseColor, colorOrange, smoothstep(0.45, 0.95, wave));

      // 8x8 Bayer dithering
      const float pixelSize = 2.0;
      vec2 scaledCoord = floor(gl_FragCoord.xy / pixelSize);
      int x = int(mod(scaledCoord.x, 8.0));
      int y = int(mod(scaledCoord.y, 8.0));
      float threshold = bayerMatrix8x8[y * 8 + x] - 0.5;

      const float colorNum = 5.0;
      float stepVal = 1.0 / (colorNum - 1.0);
      baseColor += threshold * stepVal * 0.9;
      baseColor = clamp(baseColor, 0.0, 1.0);
      baseColor = floor(baseColor * (colorNum - 1.0) + 0.5) / (colorNum - 1.0);

      gl_FragColor = vec4(baseColor, 1.0);
    }
  `;

  function createShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl.VERTEX_SHADER, vertexSrc));
  gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fragmentSrc));
  gl.linkProgram(program);
  gl.useProgram(program);

  // Full-screen quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1, -1,  1,
    -1,  1,  1, -1,  1,  1
  ]), gl.STATIC_DRAW);

  const posAttr = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(posAttr);
  gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

  const resUniform = gl.getUniformLocation(program, 'resolution');

  function renderOnce() {
    const w = canvas.parentElement ? canvas.parentElement.clientWidth : window.innerWidth;
    const h = canvas.parentElement ? canvas.parentElement.clientHeight : window.innerHeight;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(resUniform, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  window.addEventListener('resize', renderOnce);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderOnce);
  } else {
    renderOnce();
  }
})();
