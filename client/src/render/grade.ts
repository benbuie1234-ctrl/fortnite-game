import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * Final colour grade.
 *
 * Runs after tone mapping, on display-referred colour, and does the four
 * things a colourist would do to a flat render:
 *
 *  - lift saturation, because tone mapping desaturates as it compresses
 *  - add contrast, because atmospheric fog flattens everything it touches
 *  - split-tone: cool the shadows, warm the highlights. This is the single
 *    cheapest trick in the book for making an image feel deliberate rather
 *    than accidental, and it is the same warm/cool logic the lighting uses
 *  - vignette, to stop the eye wandering off the edges of the frame
 *
 * All of it is one fullscreen pass over an already-rendered image, so the cost
 * is independent of how much is in the scene.
 */
export function createGradePass(): ShaderPass {
  return new ShaderPass({
    name: "ColorGrade",
    uniforms: {
      tDiffuse: { value: null },
      contrast: { value: 1.14 },
      saturation: { value: 1.28 },
      shadowTint: { value: new THREE.Color(0.92, 0.96, 1.08) },
      highlightTint: { value: new THREE.Color(1.06, 1.02, 0.94) },
      vignette: { value: 0.2 },
      // Raised black point. Deliberately blue: shadows in daylight are lit by
      // the sky, so the darkest thing on screen should be dark blue, never
      // black. This is the guarantee that shade stays readable.
      lift: { value: new THREE.Color(0.026, 0.032, 0.046) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float contrast;
      uniform float saturation;
      uniform vec3 shadowTint;
      uniform vec3 highlightTint;
      uniform float vignette;
      uniform vec3 lift;
      varying vec2 vUv;

      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        vec3 color = texel.rgb;

        // Rec.709 luma, used for both the saturation mix and the tone split.
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));

        color = mix(vec3(luma), color, saturation);
        color = (color - 0.5) * contrast + 0.5;

        // Cool shadows, warm highlights.
        color *= mix(shadowTint, highlightTint, smoothstep(0.0, 0.85, luma));

        float d = distance(vUv, vec2(0.5));
        color *= 1.0 - vignette * smoothstep(0.32, 0.86, d);

        // Lift last, so it applies after everything that could have darkened
        // the image. Black now maps to the lift colour instead of to zero.
        color = lift + color * (1.0 - lift);

        gl_FragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
      }
    `,
  });
}
