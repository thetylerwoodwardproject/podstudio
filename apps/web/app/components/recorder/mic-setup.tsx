import { useEffect, useRef, useState } from "react";
import { faCircleCheck, faMicrophone, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { AudioDeviceSelect, AudioDeviceSelectContent, AudioDeviceSelectTrigger, AudioDeviceSelectValue } from "~/components/ui/audio-device-select";
import { Button } from "~/components/ui/button";
import { DbReadout } from "~/components/ui/db-readout";
import { LevelMeter, LevelMeterBar, LevelMeterChannel, LevelMeterChannels, LevelMeterClip, LevelMeterHold, LevelMeterScale, LevelMeterTrack } from "~/components/ui/level-meter";
import type { FrameSource, MeterFrame } from "~/lib/audio/types";
import type { InputDevice } from "~/lib/recorder/engine";

// The recorder sidebar's microphone setup, after audiocn's mic-setup block: device picker, level
// meter with readout and clip light, and a 3-second level check. It drives the recorder's own
// capture session (the block opens its own stream and adds a gain stage; the recorder captures the
// raw input, so there is no gain or mute here). Warnings are amber: red is only for recording.

const CHECK_MS = 3000;
type Verdict = "good" | "quiet" | "loud" | "silent";
const VERDICTS: Record<Verdict, { title: string; text: string; ok: boolean }> = {
  good: { title: "Sounds good", text: "Your level sits in the right range.", ok: true },
  loud: { title: "Too loud", text: "Your voice clipped. Turn the mic or interface gain down.", ok: false },
  quiet: { title: "Too quiet", text: "Turn the gain up or move closer to the mic.", ok: false },
  silent: { title: "No signal", text: "Check the device, its cable and that it isn't muted.", ok: false },
};
const judge = (peakDb: number): Verdict => (peakDb < -55 ? "silent" : peakDb >= -1 ? "loud" : peakDb < -30 ? "quiet" : "good");

export function MicSetup({ devices, deviceId, deviceLabel, meter, ready, disabled, onEnable, onDevice }: { devices: InputDevice[]; deviceId: string; deviceLabel: string; meter: FrameSource<MeterFrame>; ready: boolean; disabled: boolean; onEnable: () => void; onDevice: (id: string | undefined) => void }) {
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const peak = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    if (!checking) return;
    peak.current = Number.NEGATIVE_INFINITY;
    const off = meter.subscribe((f) => {
      for (const c of f.channels) peak.current = Math.max(peak.current, c.peakDb);
    });
    const t = window.setTimeout(() => {
      setChecking(false);
      setVerdict(judge(peak.current));
    }, CHECK_MS);
    return () => {
      off();
      window.clearTimeout(t);
    };
  }, [checking, meter]);

  // the session's current device, even when the browser only reported "default"
  const list = deviceId === "" ? [{ id: "__default__", label: deviceLabel || "Default microphone", isDefault: true }, ...devices.map((d) => ({ id: d.deviceId, label: d.label }))] : devices.map((d) => ({ id: d.deviceId, label: d.label }));
  const v = verdict ? VERDICTS[verdict] : null;

  return (
    <div className="flex flex-col gap-3" data-testid="mic-setup">
      <AudioDeviceSelect devices={list} value={deviceId || "__default__"} onValueChange={(id) => onDevice(id && id !== "__default__" ? id : undefined)} permission={ready ? "granted" : "prompt"} onRequestPermission={onEnable} disabled={disabled}>
        <AudioDeviceSelectTrigger className="w-full" data-testid="device">
          <FontAwesomeIcon icon={faMicrophone} className="text-muted-foreground" />
          <AudioDeviceSelectValue placeholder="Default microphone" />
        </AudioDeviceSelectTrigger>
        <AudioDeviceSelectContent />
      </AudioDeviceSelect>
      {!ready ? (
        <Button variant="outline" size="sm" onClick={onEnable} data-testid="enable-mic">
          Turn on microphone
        </Button>
      ) : (
        <>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-muted-foreground">Level</span>
            <DbReadout source={meter} holdMs={500} className="text-[12px] text-muted-foreground" />
          </div>
          <LevelMeter source={meter} aria-label="Microphone level" data-testid="meter">
            <LevelMeterChannels>
              <LevelMeterChannel index={0}>
                <LevelMeterTrack>
                  <LevelMeterBar />
                  <LevelMeterHold />
                </LevelMeterTrack>
              </LevelMeterChannel>
              <LevelMeterScale />
            </LevelMeterChannels>
            <LevelMeterClip />
          </LevelMeter>
          <Button variant="outline" size="sm" disabled={checking || disabled} onClick={() => { setVerdict(null); setChecking(true); }} data-testid="level-check">
            {checking ? "Listening… speak normally" : "Check my level"}
          </Button>
          {v && (
            <Alert className={v.ok ? "border-meter-ok/40 [&>svg]:text-meter-ok" : "border-meter-warn/50 [&>svg]:text-meter-warn"} data-testid="level-verdict" data-verdict={verdict}>
              <FontAwesomeIcon icon={v.ok ? faCircleCheck : faTriangleExclamation} />
              <AlertTitle>{v.title}</AlertTitle>
              <AlertDescription>{v.text}</AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
