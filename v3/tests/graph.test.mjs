import { test } from 'node:test';
import assert from 'node:assert/strict';
import Graph from '../graph.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('nós ligados ficam mais perto que nós sem ligação', () => {
  const sim = Graph.createSimulation(['a', 'b', 'c'], [['a', 'b']], 800, 600);
  sim.settle(500);
  const byName = Object.fromEntries(sim.nodes.map(n => [n.name, n]));
  assert.ok(dist(byName.a, byName.b) < dist(byName.a, byName.c));
});

test('posições ficam finitas com muitos nós', () => {
  const names = Array.from({ length: 300 }, (_, i) => `n${i}.txt`);
  const links = names.slice(1).map((n, i) => [names[i], n]);
  const sim = Graph.createSimulation(names, links, 1000, 800);
  const iterations = sim.settle(300);
  assert.ok(iterations <= 300);
  for (const n of sim.nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  }
});

test('nó fixado não se move na simulação', () => {
  const sim = Graph.createSimulation(['a', 'b'], [['a', 'b']], 800, 600);
  sim.pinAt('a', 100, 100);
  sim.settle(200);
  const a = sim.nodes.find(n => n.name === 'a');
  assert.equal(a.x, 100);
  assert.equal(a.y, 100);
});

test('nó não termina dentro de um obstáculo', () => {
  const sim = Graph.createSimulation(['a', 'b', 'c', 'd'], [], 800, 600);
  sim.setObstacles([{ x0: 300, y0: 250, x1: 500, y1: 350 }]);
  sim.settle(300);
  for (const n of sim.nodes) {
    const inside = n.x > 300 && n.x < 500 && n.y > 250 && n.y < 350;
    assert.equal(inside, false, `${n.name} está dentro do obstáculo`);
  }
});
