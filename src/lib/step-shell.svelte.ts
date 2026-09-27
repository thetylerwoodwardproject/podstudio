/*
 * The step flow's tabs and bar for pages whose steps are plain Astro markup
 * and an imperative script (mic check, wrapping up, script import): mounts
 * StepTabs and StepPlayer and hands back their props as live state, so the
 * page sets `tabs.current`, `bar.chain`, `bar.next` … and they update.
 * Svelte panels use the components directly instead.
 */
import { mount } from 'svelte';
import StepTabs from '@/components/steps/StepTabs.svelte';
import StepPlayer from '@/components/steps/StepPlayer.svelte';

export interface TabsState {
  steps: { id: string; label: string }[];
  current: number;
  reached: number;
  ongo: (i: number) => void;
}
export interface BarState {
  options: string[] | null;
  choice: number;
  onchoose: (i: number) => void;
  chain: string;
  time: string;
  progress: number;
  playing: boolean;
  canPlay: boolean;
  onplay: () => void;
  onback: (() => void) | null;
  next: { label: string; onclick: () => void; disabled?: boolean; attrs?: Record<string, string> } | null;
  summary: { text: string; meta: string } | null;
}

export function stepShell(tabsTarget: HTMLElement | null, barTarget: HTMLElement, tabs: TabsState | null, bar: Partial<BarState>) {
  const tabsState = $state(tabs);
  const t = tabs ? tabsState : null;
  const b = $state<BarState>({
    options: null,
    choice: 0,
    onchoose: () => {},
    chain: '',
    time: '',
    progress: 0,
    playing: false,
    canPlay: false,
    onplay: () => {},
    onback: null,
    next: null,
    summary: null,
    ...bar,
  });
  if (t && tabsTarget) mount(StepTabs, { target: tabsTarget, props: t });
  mount(StepPlayer, { target: barTarget, props: b });
  return { tabs: t, bar: b };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Drive the bar from a PreviewPlayer: play and pause, the choice, time and
 * progress. `prepare` makes the audio the first time Play is pressed (or
 * returns false if there's nothing to play); call `update()` after setting
 * new audio on the player.
 */
export function wirePlayer(bar: BarState, player: import('./audio/preview-player').PreviewPlayer, prepare: () => Promise<boolean> = async () => player.ready) {
  const show = () => {
    const d = player.duration;
    const p = player.position();
    bar.playing = player.playing;
    bar.time = `${mmss(p)} / ${mmss(d)}`;
    bar.progress = d ? p / d : 0;
  };
  const tick = () => {
    show();
    if (player.playing) requestAnimationFrame(tick);
  };
  player.onended = show;
  bar.onplay = async () => {
    if (player.playing) {
      player.pause();
      return show();
    }
    if (!player.ready && !(await prepare())) return;
    player.select(bar.choice);
    await player.play();
    tick();
  };
  bar.onchoose = (i) => {
    bar.choice = i;
    player.select(i);
  };
  return {
    update() {
      player.select(bar.choice);
      if (player.playing) tick();
      else show();
    },
  };
}
