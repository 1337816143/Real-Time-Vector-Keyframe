/** Shared by the composite and edge passes; input is screen UV with Y already flipped. */
export const QUAD_UNIFORMS = `
uniform vec2 uQuad[4];
uniform float uQuadOpacity;
`;
export const QUAD_SDF = `
float quadSdf(vec2 uv) {
  float aspect = uViewport.x / max(1.0, uViewport.y);
  vec2 q = vec2(uv.x * aspect, uv.y);
  float best = 100.0;
  bool inside = false;
  for (int i = 0; i < 4; i++) {
    int j = (i + 1) % 4;
    vec2 a = vec2(uQuad[i].x * aspect, uQuad[i].y);
    vec2 b = vec2(uQuad[j].x * aspect, uQuad[j].y);
    best = min(best, segmentDistance(q, a, b));
    if ((a.y > q.y) != (b.y > q.y)) {
      float crossingX = (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x;
      if (q.x < crossingX) inside = !inside;
    }
  }
  return inside ? -best : best;
}
`;
