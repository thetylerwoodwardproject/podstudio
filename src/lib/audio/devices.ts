/*
 * Microphone choices. An input is stored as a string:
 *   ''          the system default (follows macOS / Windows sound settings)
 *   'id'        a specific device, all its inputs mixed to mono
 *   'id#2'      one input of a multi-input interface (zero-based channel)
 *
 * Mono records one input, or every input of the device summed. Stereo records
 * a device's inputs 1 and 2 as left and right, so there's no per-input choice.
 */

import type { Channels } from './wav';

export interface InputRef {
  deviceId: string;
  channel: number | null;
}

export function parseInput(value: string | undefined | null): InputRef {
  const v = value ?? '';
  const i = v.lastIndexOf('#');
  if (i > 0 && /^\d+$/.test(v.slice(i + 1))) return { deviceId: v.slice(0, i), channel: Number(v.slice(i + 1)) };
  return { deviceId: v, channel: null };
}

export interface InputChoice {
  value: string;
  label: string;
}

const clean = (label: string) => label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');

/** The stored input as it applies to this channel mode: stereo drops the input number. */
export function inputFor(value: string, channels: Channels): string {
  return channels === 2 ? parseInput(value).deviceId : value;
}

/**
 * Inputs to offer. In mono each input of a multi-input interface is listed on its
 * own; in stereo each device is listed once.
 */
export async function inputChoices(channels: Channels = 1): Promise<InputChoice[]> {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const system = devices.find((d) => d.deviceId === 'default');
  const out: InputChoice[] = [
    { value: '', label: `System default${system?.label ? ` (${clean(system.label.replace(/^Default - /, ''))})` : ''}` },
  ];
  const stereo = channels === 2;
  let n = 0;
  for (const d of devices) {
    if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
    n++;
    const name = clean(d.label) || `Microphone ${n}`;
    const caps = (d as InputDeviceInfo).getCapabilities?.() as { channelCount?: { max?: number } } | undefined;
    const inputs = Math.min(8, caps?.channelCount?.max ?? 1);
    if (stereo) {
      out.push({ value: d.deviceId, label: inputs > 1 ? `${name} · Inputs 1 + 2 as L / R` : `${name} · mono on both sides` });
    } else if (inputs > 1) {
      for (let c = 0; c < inputs; c++) out.push({ value: `${d.deviceId}#${c}`, label: `${name} · Input ${c + 1}` });
      out.push({ value: d.deviceId, label: `${name} · all inputs summed` });
    } else {
      out.push({ value: d.deviceId, label: name });
    }
  }
  return out;
}

/** Human name for a stored input, falling back to the system default if it's gone. */
export async function describeInput(value: string, channels: Channels = 1): Promise<{ label: string; missing: boolean }> {
  value = inputFor(value, channels);
  const choices = await inputChoices(channels);
  const hit = choices.find((c) => c.value === value);
  if (hit) return { label: hit.label, missing: false };
  return { label: choices[0].label, missing: value !== '' };
}

/** A stored input that's no longer plugged in becomes the system default. */
export async function availableInput(value: string, channels: Channels = 1): Promise<string> {
  value = inputFor(value, channels);
  if (!value) return '';
  const choices = await inputChoices(channels);
  // Before permission, device ids aren't listed; trust the saved value.
  if (choices.length === 1) return value;
  return choices.some((c) => c.value === value) ? value : '';
}
