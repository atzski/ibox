import { CustomBlending, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Vector2 } from "three";

/**
 * Film posé sur la face d'un boîtier de l'étagère : le reflet du plastique
 * (une bande spéculaire oblique qui glisse avec l'angle du boîtier, un liseré
 * clair en haut, des bords légèrement assombris), le voile sombre des boîtiers
 * de côté et l'éclat qui balaie la jaquette quand un jeu est choisi.
 *
 * Mélange prémultiplié : couleur = reflet + fond × (1 − voile). Un seul quad,
 * aucune texture ; les coins suivent l'arrondi du boîtier.
 */
export interface GlareUniforms {
  [k: string]: { value: unknown };
  uSize: { value: Vector2 };
  uRadius: { value: number };
  uShift: { value: number };
  uGlare: { value: number };
  uDim: { value: number };
  uSheen: { value: number };
}

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragment = /* glsl */ `
uniform vec2 uSize;
uniform float uRadius;
uniform float uShift;
uniform float uGlare;
uniform float uDim;
uniform float uSheen;
varying vec2 vUv;

float band(float s, float c, float w) { float d = (s - c) / w; return exp(-d * d); }

void main() {
  vec2 p = (vUv - 0.5) * uSize;
  vec2 q = abs(p) - (uSize * 0.5 - uRadius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float mask = 1.0 - smoothstep(-0.006, 0.0, d);
  if (mask <= 0.0) discard;

  // position le long d'une ligne inclinée (≈ 104°), en largeurs de face
  float s = (p.x * 0.97 - p.y * 0.24) / uSize.x;
  float g = 0.30 * band(s, uShift, 0.035) + 0.075 * band(s, uShift, 0.13) + 0.11 * band(s, uShift + 0.105, 0.016);
  // liseré clair le long du bord supérieur
  float top = 1.0 - vUv.y;
  g += mix(0.15, 0.04, smoothstep(0.0, 0.18, top)) * (1.0 - smoothstep(0.18, 0.34, top));
  g *= uGlare;
  // éclat de sélection : une large bande qui traverse la jaquette
  float sx = (p.x - p.y * 0.25) / uSize.x;
  g += 0.55 * band(sx, uSheen, 0.16) * step(-1.5, uSheen) * step(uSheen, 1.5);

  // bords latéraux un peu plus sombres (épaisseur du plastique) et voile
  float edge = 0.14 * (1.0 - smoothstep(0.0, 0.1, vUv.x)) + 0.18 * smoothstep(0.88, 1.0, vUv.x);
  float a = clamp(uDim + edge * (1.0 - uDim), 0.0, 1.0);
  gl_FragColor = vec4(vec3(g) * mask, a * mask);
}`;

export function createGlareMaterial(width: number, height: number, radius: number): ShaderMaterial & { uniforms: GlareUniforms } {
  const m = new ShaderMaterial({
    uniforms: {
      uSize: { value: new Vector2(width, height) },
      uRadius: { value: Math.min(radius, Math.min(width, height) / 2 - 0.001) },
      uShift: { value: 0 },
      uGlare: { value: 1 },
      uDim: { value: 0 },
      uSheen: { value: -9 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    fog: false,
    toneMapped: false,
  });
  return m as ShaderMaterial & { uniforms: GlareUniforms };
}
