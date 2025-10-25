import AudioIn from "audioin"
import AudioOut from "pins/audioout"
import Timer from "timer"

export function addAudioReplayTask(robot) {
    let samples = [];

    let input = new AudioIn;
    const sampleRate = input.sampleRate;
    if (16 !== input.bitsPerSample)
        throw new Error("expects 16 bit samples");

    try {
        while (true) {
            let s = new SharedArrayBuffer(4096);
            input.read(s.byteLength >> 1, s, 0);
            samples.push(s);
            s = null;
            if (samples.length > 5){
                break;
            } 
            else {
                trace(`${samples.length} samples recorded\n`);
            }
        }
    }
    catch {
    }
    trace("recording complete\n");
    input.close();
    input = null;

    let speaker = new AudioOut({
        streams: 1,
        sampleRate
    });

    const playing = [];
    function enqueue() {
        speaker.enqueue(0, AudioOut.RawSamples, samples[0], 1, 0, samples[0].byteLength >> 1);
        speaker.enqueue(0, AudioOut.Callback, 0);
        playing.push(samples.shift());
    }
    enqueue();
    enqueue();
    speaker.callback = function() {
        playing.shift();
        if (!samples.length) {
            if (!playing.length) {
                trace("playback complete\n");
                speaker.stop();
                samples = null;
                speaker = null;
            }
            return;
        }
        enqueue();
    }
    speaker.start();
    trace("start playback\n");
}