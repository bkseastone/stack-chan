import {Server} from "embedded:io/tcp/websocketserver"
import { addAudioSaveTask } from 'add_audio_save_task'

export async function addWsServer(robot) {
    robot.ws_server = new Server({port:8000});
    robot.ws_server.callback = function (message, value) {
        switch (message) {
            case Server.connect:
                trace("add_ws_server.js: socket connect.\n");
                break;

            case Server.handshake:
                trace("add_ws_server.js: websocket handshake success\n");
                break;

            case Server.receive:
                // 采集音频片段
                addAudioSaveTask(robot);
                trace(`add_ws_server.js: websocket message received: ${value}\n`);
                this.write(value);		// echo
                break;

            case Server.disconnect:
                trace("add_ws_server.js: websocket close\n");
                break;
        }
    }
}