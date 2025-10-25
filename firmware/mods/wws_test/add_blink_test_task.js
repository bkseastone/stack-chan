import Timer from "timer";
import Digital from 'embedded:io/digital';


export function addBlinkTestTask(robot) {
    trace(`Using pins 5\n`);
    // Digital使用参考: $(MODDABLE)/documentation/io/io.md .## IO Kinds .### Digital
    const led = new Digital({
        pin: 5,  // 这里的pin对应的编号即为GPIO编号
        mode: Digital.Output,
    });
    led.write(1);

    let state = 0;
    Timer.repeat(() => {
        led.write(state);
        state ^= 1;
    }, 2000);
}
