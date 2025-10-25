import WebSocket from 'embedded:io/tcp/websocket'

export async function wakeupWordDetect({robot, host="127.0.0.1", port=80, path = "/"}) {
    return new Promise((resolve, reject) => {
        const chunksPerSecond = 10;  // 100ms
        const sampleCount = Math.floor(robot.ear.audioin.sampleRate / chunksPerSecond);
  
        let isHotwordDetected = false;
        const ws = new WebSocket(`ws://${host}:${port}${path}`);
        ws.addEventListener('open', () => {
            ws.send(robot.ear.audioin.read(sampleCount));
            // trace('send first done\n');
        });
        ws.addEventListener('message', (payload) => {
            let value = JSON.parse(payload.data)
            if (value.result === 0) {
                // pcm data not enough / no keyword detected
                ws.send(robot.ear.audioin.read(sampleCount));
            }
            else if (value.result === 1) {
                isHotwordDetected = true;
            }
        });
        ws.addEventListener('close', (event) => {
            resolve(isHotwordDetected);
            ws.close();
        });
        ws.addEventListener('error', (event) => {
            resolve(isHotwordDetected);
            ws.close();
        });
    });
}

export async function addWakeupTask(robot) {
    robot.isWakeupOnlistening = true;
    // trace(`addWakeupTask starting ...\n`)

    await wakeupWordDetect({
        robot,
        host: "192.168.31.64",
        port: 9092,
        path: "/paddlespeech/kws/streaming",
    })
    .then(body => {
        trace(`wakeupWordDetect response body: ${body}\n`)
        if (body === true) {
            trace(`wakeup word detected!\n`)
            robot.mouse.startChatWithSpeak('我在听.');
        }
    })

    robot.isWakeupOnlistening = false;
    // trace(`addWakeupTask done ...\n`)
}