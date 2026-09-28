<!--
  Session saved's player (design: step flow 1e): the whole recording,
  Original or Cleaned, and Export. Cleaning is only a way of listening here
  (lib/player.ts cleans a stretch from where you are, then the whole session,
  and keeps it for Export); it's set for real in Export.
-->
<script lang="ts">
  import StepPlayer from '@/components/steps/StepPlayer.svelte';
  import { noiseToggle } from '@/lib/player';
  import type { TakeMeta } from '@/lib/audio/takes';

  interface Props {
    take: TakeMeta;
    original: () => Promise<string>;
    exportHref: string;
  }
  let { take, original, exportHref }: Props = $props();
  let audio: HTMLAudioElement;
  let toggle: HTMLInputElement;
  let ctl = $state.raw<ReturnType<typeof noiseToggle> | null>(null);
  let choice = $state(0);
  let playing = $state(false);
  let pos = $state(0);
  let status = $state('');
  // svelte-ignore state_referenced_locally
  const length = take.samples / take.sampleRate;
  $effect(() => {
    ctl = noiseToggle(audio, toggle, (t) => (status = t), take, original);
  });
  async function play() {
    if (!audio.paused) return audio.pause();
    if (!audio.src) audio.src = await original();
    await audio.play();
  }
  function choose(i: number) {
    choice = i;
    toggle.checked = i === 1;
    toggle.dispatchEvent(new Event('change'));
  }
  const clock = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };
</script>

<audio
  bind:this={audio}
  hidden
  data-player
  onplay={() => (playing = true)}
  onpause={() => (playing = false)}
  ontimeupdate={() => (pos = ctl?.position() ?? audio.currentTime)}
></audio>
<input type="checkbox" hidden bind:this={toggle} data-ns-toggle />
<StepPlayer
  options={['Original', 'Cleaned']}
  {choice}
  onchoose={choose}
  chain={choice ? status || `Raw WAV → Noise ${ctl?.amount ?? 40} %` : 'Raw WAV'}
  time={`${clock(pos)} / ${clock(length)}`}
  progress={pos / length}
  {playing}
  onplay={play}
  next={{ label: 'Open editor', onclick: () => (location.href = exportHref), attrs: { 'data-export': '' } }}
/>
