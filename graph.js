// Simulação de forças da teia: repulsão entre todos os pontos, mola entre ligados e atração leve ao centro
(() => {
  'use strict';

  const REPULSION = 2000;   // força de repulsão (k / d²)
  const SPRING = 0.02;      // rigidez da mola entre ligados
  const REST_LENGTH = 80;   // comprimento de repouso da mola
  const CENTER_PULL = 0.004; // atração leve em direção ao centro
  const DAMPING = 0.85;     // fração da velocidade que sobra a cada passo
  const MIN_DIST = 1;       // evita divisão por zero em pontos sobrepostos
  const MAX_FORCE = 50;     // limite de força por par, para não explodir com muitos nós
  const ENERGY_LIMIT = 0.01;
  const NODE_MARGIN = 10;   // folga em volta de cada obstáculo, para o ponto e o rótulo não encostarem

  // Posições iniciais num círculo com ruído determinístico, para o resultado ser reproduzível
  function createSimulation(nodeNames, links, width, height) {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.35;
    const nodes = nodeNames.map((name, i) => {
      const angle = (2 * Math.PI * i) / Math.max(nodeNames.length, 1);
      const jitter = Math.sin(i * 12.9898) * 10;
      return {
        name,
        x: cx + (radius + jitter) * Math.cos(angle),
        y: cy + (radius + jitter) * Math.sin(angle),
        vx: 0,
        vy: 0,
        fixed: false,
      };
    });
    const byName = new Map(nodes.map(n => [n.name, n]));
    let edges = [];
    let obstacles = []; // retângulos { x0, y0, x1, y1} onde nenhum ponto pode ficar

    // Retângulos que a teia deve evitar (ex.: a barra de busca), em coordenadas da simulação
    function setObstacles(rects) {
      obstacles = rects;
    }

    // Empurra um ponto para a borda mais próxima de cada obstáculo em que ele caiu
    function avoidObstacles(n) {
      for (const r of obstacles) {
        const x0 = r.x0 - NODE_MARGIN;
        const y0 = r.y0 - NODE_MARGIN;
        const x1 = r.x1 + NODE_MARGIN;
        const y1 = r.y1 + NODE_MARGIN;
        if (n.x <= x0 || n.x >= x1 || n.y <= y0 || n.y >= y1) continue;
        const toLeft = n.x - x0;
        const toRight = x1 - n.x;
        const toTop = n.y - y0;
        const toBottom = y1 - n.y;
        const least = Math.min(toLeft, toRight, toTop, toBottom);
        if (least === toLeft) n.x = x0;
        else if (least === toRight) n.x = x1;
        else if (least === toTop) n.y = y0;
        else n.y = y1;
      }
    }

    function setLinks(newLinks) {
      edges = newLinks
        .map(([a, b]) => [byName.get(a), byName.get(b)])
        .filter(([a, b]) => a && b && a !== b);
    }

    function step() {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.max(Math.hypot(dx, dy), MIN_DIST);
          const f = Math.min(REPULSION / (d * d), MAX_FORCE);
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }
      for (const [a, b] of edges) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(Math.hypot(dx, dy), MIN_DIST);
        const f = SPRING * (d - REST_LENGTH);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
      for (const n of nodes) {
        n.vx += (cx - n.x) * CENTER_PULL;
        n.vy += (cy - n.y) * CENTER_PULL;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        if (n.fixed) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.x += n.vx;
        n.y += n.vy;
        avoidObstacles(n);
      }
    }

    function energy() {
      let e = 0;
      for (const n of nodes) e += n.vx * n.vx + n.vy * n.vy;
      return e;
    }

    // Roda passos até a energia cair abaixo do limite ou atingir maxSteps; devolve os passos feitos
    function settle(maxSteps) {
      let i = 0;
      for (; i < maxSteps; i++) {
        step();
        if (energy() < ENERGY_LIMIT) return i + 1;
      }
      return i;
    }

    function pinAt(name, x, y) {
      const n = byName.get(name);
      if (!n) return;
      n.x = x;
      n.y = y;
      n.vx = 0;
      n.vy = 0;
      n.fixed = true;
    }

    function release(name) {
      const n = byName.get(name);
      if (n) n.fixed = false;
    }

    setLinks(links);
    return { nodes, setLinks, setObstacles, step, settle, pinAt, release };
  }

  const Graph = { createSimulation };

  if (typeof module !== 'undefined') module.exports = Graph;
  if (typeof window !== 'undefined') window.Graph = Graph;
})();
