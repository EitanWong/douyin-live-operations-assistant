// Critically damped spring, evaluated analytically (pixels/second for velocity).
// Retargeting changes only the destination: position AND velocity are preserved.
// The exact solution stays stable across refresh rates and delayed frames.
export class Spring {
  constructor(value, frequency = 24, precision = .01) {
    this.value = this.target = value;
    this.velocity = 0;
    this.frequency = frequency;
    this.precision = precision;
  }
  get active() { return this.value !== this.target || this.velocity !== 0; }
  jump(value) { this.value = this.target = value; this.velocity = 0; }
  step(seconds) {
    if (!this.active || seconds <= 0) return;
    const offset = this.value - this.target;
    const coefficient = this.velocity + this.frequency * offset;
    const decay = Math.exp(-this.frequency * seconds);
    this.value = this.target + (offset + coefficient * seconds) * decay;
    this.velocity = (this.velocity - this.frequency * coefficient * seconds) * decay;
    if (Math.abs(this.value - this.target) < this.precision && Math.abs(this.velocity) < this.precision * 10) this.jump(this.target);
  }
}
