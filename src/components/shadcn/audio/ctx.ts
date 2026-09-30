import { getContext, setContext } from 'svelte';

const AUDIO_PLAYER_KEY = Symbol('audio-player');

type AudioPlayerContext = {
	isPlaying: { value: boolean };
	duration: { value: number };
	currentTime: { value: number };
	volume: { value: number };
	isMuted: { value: boolean };
	togglePlay: () => void;
	seek: (time: number) => void;
	toggleMute: () => void;
	setVolume: (v: number) => void;
};

export function setAudioPlayerContext(props: AudioPlayerContext) {
	setContext(AUDIO_PLAYER_KEY, props);
}

export function getAudioPlayerContext() {
	return getContext<AudioPlayerContext>(AUDIO_PLAYER_KEY);
}
