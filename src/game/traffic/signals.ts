// Traffic lights driven by the level's own signal programs (signals.json):
// each sequence cycles its phases; a phase hands one controller its states
// (green → yellow → red). Instances not in the active phase show red.

import type { LevelObjects } from '../import/types';

export type Lamp = 'green' | 'yellow' | 'red' | 'off';

export class SignalSystem {
  private cycle = new Map<number, number>();
  constructor(private data: LevelObjects['signals']) {
    for (const s of data.sequences) {
      const last = s.phases[s.phases.length - 1];
      this.cycle.set(s.id, last ? last.startTime + last.totalDuration : 0);
    }
  }

  get instances() {
    return this.data.instances;
  }

  /** Heads that follow another head's phase (one junction, one signal). */
  private alias = new Map<number, number>();
  link(id: number, masterId: number) {
    if (id !== masterId) this.alias.set(id, masterId);
  }

  /** Lamp of a signal head at absolute time t (s). */
  state(instanceId: number, t: number): Lamp {
    instanceId = this.alias.get(instanceId) ?? instanceId;
    const inst = this.data.instances.find((i) => i.id === instanceId);
    if (!inst) return 'off';
    const seq = this.data.sequences.find((s) => s.id === inst.sequenceId);
    const len = this.cycle.get(inst.sequenceId) ?? 0;
    if (!seq || len <= 0) return 'off';
    const tc = ((t % len) + len) % len;
    const phase = seq.phases.find((p) => tc >= p.startTime && tc < p.startTime + p.totalDuration);
    if (!phase || !phase.controllerIds.includes(inst.controllerId)) return 'red';
    const ctl = this.data.controllers.find((c) => c.id === inst.controllerId);
    if (!ctl) return 'red';
    // states play from the phase start; the leftover phase time is the first (green) state
    const into = tc - phase.startTime;
    const tail = ctl.states.slice(1).reduce((s, st) => s + st.duration, 0);
    const greenLen = Math.max(0, phase.totalDuration - tail);
    if (into < greenLen) return 'green';
    let acc = greenLen;
    for (const st of ctl.states.slice(1)) {
      acc += st.duration;
      if (into < acc) return st.state.startsWith('yellow') ? 'yellow' : st.state.startsWith('red') ? 'red' : 'green';
    }
    return 'red';
  }
}
