import { useEffect, useState } from "react";

// The episode's waveform for audiocn's <Waveform>: `/{show}/media/{id}/waveform.json`, derived from
// the MP3 URL. Fetched once per page per episode; null peaks when there isn't one (the player then
// falls back to a plain seek bar).

const cache = new Map<string, Promise<number[] | null>>();

export function waveformUrl(mp3Src: string) {
  return mp3Src.replace(/\/[^/]*$/, "/waveform.json");
}

export function useEpisodeWaveform(mp3Src: string | null | undefined): { peaks: number[] | null; loading: boolean } {
  const url = mp3Src ? waveformUrl(mp3Src) : null;
  const [state, setState] = useState<{ url: string | null; peaks: number[] | null; loading: boolean }>({ url: null, peaks: null, loading: !!url });
  useEffect(() => {
    if (!url) return;
    let live = true;
    let p = cache.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (j && Array.isArray(j.peaks) ? (j.peaks as number[]) : null))
        .catch(() => null);
      cache.set(url, p);
    }
    setState({ url, peaks: null, loading: true });
    void p.then((peaks) => live && setState({ url, peaks, loading: false }));
    return () => {
      live = false;
    };
  }, [url]);
  return state.url === url ? { peaks: state.peaks, loading: state.loading } : { peaks: null, loading: !!url };
}
