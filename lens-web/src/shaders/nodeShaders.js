export const vertexShader = `
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const fragmentShader = `
  uniform float uTime;
  uniform int uType;      // 0: File, 1: Exec, 2: Dir Platform, 3: BLACKWALL, 4: SubDir Portal
  uniform float uSeed;
  uniform float uDepth;
  uniform bool uMatched;
  uniform bool uVisited;
  uniform bool uMarked;

  varying vec2 vUv;
  varying vec3 vPos;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    float alpha = (uDepth == 0.0) ? 0.95 : 0.55;
    vec3 color = vec3(0.0);

    vec2 grid = abs(fract(vUv - 0.5) - 0.5) / fwidth(vUv);
    float edge = 1.0 - min(min(grid.x, grid.y), 1.0);

    if (uType == 3) {
      // BLACKWALL: Parallel crimson lines + horizontal glitch
      float glitch = step(0.92, sin(uTime * 8.0 + uSeed * 20.0)) * 0.15;
      float lines = step(0.55, fract((vUv.y + glitch * hash(floor(vUv.y * 25.0 + uTime))) * 32.0));
      float scan = 0.6 + 0.4 * sin(vUv.y * 10.0 - uTime * 4.0);
      color = vec3(0.95, 0.08, 0.22) * lines * scan + vec3(0.4, 0.0, 0.05) * edge;
      alpha = 0.95;
    } 
    else if (uType == 1) {
      // EXECUTABLE: Emerald/Cyan pulsing circuit cube
      float pulse = 0.5 + 0.5 * sin(uTime * 5.0 + uSeed * 10.0 + vUv.y * 12.0);
      float innerLines = step(0.85, fract(vUv.x * 8.0)) + step(0.85, fract(vUv.y * 8.0));
      color = mix(vec3(0.02, 0.12, 0.1), vec3(0.0, 0.95, 0.65), edge * 0.9 + innerLines * 0.25 * pulse);
    } 
    else if (uType == 2 || uType == 4) {
      // DIRECTORY PLATFORM OR PORTAL
      vec2 pGrid = abs(fract(vUv * 10.0 - 0.5) - 0.5) / fwidth(vUv * 10.0);
      float floorLine = 1.0 - min(min(pGrid.x, pGrid.y), 1.0);
      vec3 dirColor = uVisited ? vec3(0.0, 0.9, 0.55) : vec3(0.0, 0.65, 1.0);
      color = dirColor * floorLine * 0.45 + dirColor * edge * 0.75;
    } 
    else if (uType == 5) {
      // HIDDEN (.DOT) FILE: Ghostly, dashed, semi-transparent hologram
      float dashed = step(0.5, fract((vUv.x + vUv.y) * 16.0));
      color = vec3(0.35, 0.55, 0.65) * edge * dashed;
      alpha *= 0.28;
    }
    else {
      // STANDARD FILE
      float dataBand = step(0.7, fract(vUv.y * (4.0 + uSeed * 12.0)));
      vec3 baseHue = mix(vec3(0.0, 0.75, 1.0), vec3(0.65, 0.2, 1.0), uSeed);
      color = baseHue * (edge * 0.85 + dataBand * 0.12);
    }

    // Marked Beacon Override (Vibrant Magenta Pulse)
    if (uMarked) {
      color = mix(color, vec3(1.0, 0.1, 0.9), 0.65 + 0.35 * sin(uTime * 8.0));
      alpha = 1.0;
    }

    // Search Match Override (Golden Lift)
    if (uMatched) {
      color = mix(color, vec3(1.0, 0.85, 0.1), 0.75 + 0.25 * sin(uTime * 10.0));
      alpha = 1.0;
    }

    gl_FragColor = vec4(color, alpha);
  }
`;
