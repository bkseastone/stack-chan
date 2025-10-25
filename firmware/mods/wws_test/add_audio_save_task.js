import {Request} from "http"  // $(MODDABLE)/modules/network/http/http.js

async function httpStreamPostReq({robot, host="127.0.0.1", port=80, path = "/"}) {
    if (false === robot.listening) {
        // TODO: 没有返回promise为啥也行? 后面的then/catch怎么办?
        return;
    }

    return new Promise((resolve, reject) => {
        let request = new Request({
            host: host,
            port: port,
            path: path,
            method: "POST",
            body: true,		// callback is provided by Request.requestFragment callbacks
            headers: ['Connection', 'Keep-Alive'],
            reqBodyChunked: true,
            response: undefined,
        });
        const chunksPerSecond = 10;  // 100ms
        const sampleCount = Math.floor(robot.ear.audioin.sampleRate / chunksPerSecond);

        request.callback = function(message, value, extValue) {
            if (Request.requestFragment === message) {
                if (false === robot.listening) {
                    return;  // no more body, set this.state to 3 - receiving status
                }
                let chunk = robot.ear.audioin.read(sampleCount);

                return chunk;	// fragment of body
            }
            else if (Request.status === message) {
                trace(`返回状态码: ${value}\n`);
            }
            else if (Request.header === message) {
                trace(`get response header ${value}:${extValue}.\n`);
            }
            else if (Request.headersComplete === message) {
                trace(`all response headers received.\n`);
            }
            else if (Request.responseFragment === message) {
                let text = this.read(String);
                trace(`responseFragment: ${text}.\n`);
            }
            else if (Request.responseComplete === message) {
                // value = JSON.parse(value);
                resolve(value);
            }
            else if (Request.error === message) {
                reject(value);
            }
            else if (message < 0) {
				reject(-1);
            }
        }
	});
}

export async function addAudioSaveTask(robot) {
    robot.listening = !(robot.listening ?? false);
    if (false === robot.listening) {
        return;
    }
    trace(`addAudioSaveTask starting ...\n`)

    await httpStreamPostReq({
        robot,
        host: "192.168.1.25",
        port: 9092,
        path: "/paddlespeech/asr/streaming/save",
    })
    .then(body => trace(`httpStreamPostReq response body: ${body}\n`))
    .catch(error => trace(`httpStreamPostReq failed: ${error}\n`));

    trace(`addAudioSaveTask done ...\n`)
}