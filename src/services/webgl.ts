/**
 * WebGL de cet appareil, essayé une fois (`services/render3d.ts`, `services/performance.ts`) :
 * disponible ou non, et GPU vu par WebGL (affine le palier d'une puce Android inconnue, révèle un
 * rendu logiciel sur un vieux PC).
 */
export interface WebGLInfo {
  /** Un contexte WebGL (2 ou 1) a pu être créé. */
  available: boolean;
  /** GPU vu par WebGL (`WEBGL_debug_renderer_info`), s'il est lisible. */
  renderer: string | null;
  webgl2: boolean;
}

let probed: WebGLInfo | null = null;

/** Essai unique de WebGL (contexte rendu aussitôt). Simulable : `?webgl=0`, `?webgl=software` (aperçu). */
export function webglInfo(): WebGLInfo {
  if (probed) return probed;
  probed = { available: false, renderer: null, webgl2: false };
  if (typeof document === "undefined") return probed;
  const sim = import.meta.env.DEV || import.meta.env.VITE_IBOX_BENCH === "1" ? new URLSearchParams(location.search).get("webgl") : null;
  if (sim === "0") return probed;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const gl2 = canvas.getContext("webgl2", { powerPreference: "default" });
    const gl = (gl2 ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return probed;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? "") || null;
    probed = { available: true, renderer: sim === "software" ? "Google SwiftShader" : renderer, webgl2: !!gl2 };
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* WebGL indisponible */
  }
  return probed;
}

