import {Request} from "http"  // $(MODDABLE)/modules/network/http/http.js

async function httpStreamPostReq({host="127.0.0.1", port=80, path = "/"}) {
    const kBodyPart = "中文试试...\n";
    const kRepeat = 10;

    return new Promise((resolve, reject) => {
        let request = new Request({
            host: host,
            port: port,
            path: path,
            method: "POST",
            body: true,		// callback is provided by Request.requestFragment callbacks
            headers: ['Transfer-Encoding', 'chunked'],
            reqBodyChunked: true,
            response: String,
        });

        request.bytesToSend = kBodyPart.length * kRepeat;

        request.callback = function(message, value, extValue) {
            if (Request.requestFragment === message) {
                if (this.bytesToSend <= 0) {
                    return;  // no more body, set this.state to 3 - receiving status
                }
                this.bytesToSend -= kBodyPart.length * 2;
                return kBodyPart;	// fragment of body
            }
            // else if (Request.status === message) {
            //     trace(`返回状态码: ${value}\n`);
            // }
            // else if (Request.header === message) {
            //     trace(`get response header ${value}:${extValue}.\n`);
            // }
            // else if (Request.headersComplete === message) {
            //     trace(`all response headers received.\n`);
            // }
            // else if (Request.responseFragment === message) {
            //     trace(`responseFragment: ${value}.\n`);
            // }
            else if (Request.responseComplete === message) {
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

export async function addHttpStreamingTask(robot) {
    trace(`addHttpStreamingTask starting ...\n`)

    await httpStreamPostReq({
        host: "192.168.31.64",
        port: 9092,
        path: "/paddlespeech/asr/streaming",
    })
    .then(body => trace(`httpStreamPostReq response body: ${body}\n`))
    .catch(error => trace(`httpStreamPostReq failed: ${error}\n`));

    trace(`addHttpStreamingTask done ...\n`)
}