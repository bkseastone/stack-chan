import {Request} from "http"  // $(MODDABLE)/modules/network/http/http.js

async function answerUserQuestion({robot, host="127.0.0.1", port=80, path = "/", msg = "", task_name = ""}) {
    return new Promise((resolve, reject) => {
        let request = new Request({
            host: host,
            port: port,
            path: path,
            method: "POST",
            body: JSON.stringify({
                text: msg,
                task_name: task_name,
            }),
            headers: ["Content-Type", "application/json", 'Connection', 'Keep-Alive'],
            response: undefined,
        });

        let allResponse = "";

        request.callback = function(message, value, extValue) {
            if (Request.status === message) {
                if (value != 200) {
                    reject(`response status: ${value}\n`);
                }
            }
            // else if (Request.header === message) {
            //     trace(`get response header ${value}:${extValue}.\n`);
            // }
            // else if (Request.headersComplete === message) {
            //     trace(`all response headers received.\n`);
            // }
            else if (Request.responseFragment === message) {
                let kResPart = this.read(String);
                allResponse += kResPart;
                trace(`responseFragment: ${kResPart}.\n`);
            }
            else if (Request.responseComplete === message) {
                resolve(allResponse);
            }
            else if (Request.error === message) {
                reject(value);
            }
            else if (message < 0) {
                reject("message < 0");
            }
        }
    });
}

export async function testChatGPT(robot, msg) {
    trace(`testChatGPT starting ...\n`)

    await answerUserQuestion({
        robot,
        host: "192.168.1.25",
        port: 10092,
        path: "/chatgpt/streaming",
        msg: msg,
        task_name: "testChatGPT",
    })
        .then(body => trace(`answerUserQuestion response body: ${body}\n`))
        .catch(error => trace(`answerUserQuestion failed: ${error}\n`));

    trace(`testChatGPT done ...\n`)
}