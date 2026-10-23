import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Spring } from '../../src/ui/spring.js';

test('弹簧在不同刷新率和延迟帧下保持同一运动轨迹', () => {
  const sample = rate => {
    const spring = new Spring(0); spring.target = 500; spring.velocity = 800;
    for (let i = 0; i < rate / 4; i++) spring.step(1 / rate);
    return spring;
  };
  const a = sample(60), b = sample(120), delayed = new Spring(0);
  delayed.target = 500; delayed.velocity = 800; delayed.step(.25);
  assert.ok(Math.abs(a.value - b.value) < 1e-9);
  assert.ok(Math.abs(a.velocity - delayed.velocity) < 1e-9);
  delayed.step(60); assert.equal(delayed.value, 500); assert.equal(delayed.active, false);
});

test('中途反向继承位置与速度，不从起点重播；静止出发无多余回弹', () => {
  const spring = new Spring(0); spring.target = 1; spring.step(.04);
  const {value, velocity} = spring; spring.target = 0;
  assert.equal(spring.value, value); assert.equal(spring.velocity, velocity);
  spring.step(.001); assert.ok(spring.value > value);
  spring.step(1); assert.equal(spring.value, 0);
  spring.target = 1;
  for (let i = 0; i < 60; i++) { spring.step(1 / 60); assert.ok(spring.value >= 0 && spring.value <= 1); }
  assert.equal(spring.active, false);
});
