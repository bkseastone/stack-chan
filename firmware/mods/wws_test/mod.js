// import { addAudioSaveTask } from 'add_audio_save_task'
// import { addWsServer } from 'add_ws_server'
import { addWakeupTask, wakeupWordDetect } from 'add_wakeup_task'
// import { addFaceChangeTask } from 'add_face_change_task'
// import { addAudioReplayTask } from 'add_audio_replay_task'
// import { addBlinkTestTask } from 'add_blink_test_task'
// import { addHttpStreamingTask } from 'add_http_streaming_task'
// import { triggerWakeup } from 'trigger_wakeup'
// import { testChatGPT } from 'test_chatgpt'
import Timer from 'timer'

async function sayMonologue(robot) {
  // const idx = Math.floor(randomBetween(0, keys.length))
  // const key = keys[idx]
  // trace(`ready to say by ${config.tts.type}`)
  await robot.say('嗯，，，，，你好。')
}

function onRobotCreated(robot) {
  // addFaceChangeTask(robot)
  // addBlinkTestTask(robot)
  // addWsServer(robot)

  Timer.repeat(async () => {
    // 确认是否正在对话状态中
    if (robot.isNeedToChat) {
      return;
    }

    // 确认是否需要增加唤醒监听任务
    if (robot.isWakeupOnlistening) {
      return;
    }

    addWakeupTask(robot);
  }, 1000)

  // chat相关
  robot.button.a.onChanged = function () {
    if (this.read()) {
      // todo: 这里在同步函数中怎么能调用异步函数呢?
      // sayMonologue(robot)

      // robot.mouse.speakDirectlyNoChat('我在听.');

      // trigger wakeup
      robot.mouse.startChatWithSpeak('我在听');

      // robot.brain.thinkDirectlyNoChat('你好')
    }
  }

  // 测试相关
  robot.button.b.onChanged = function () {
    if (this.read()) {
      // // 打印当前时间
      // trace(`${robot.getTimeString()}\n`)

      // // 采集音频片段
      // addAudioSaveTask(robot);
      
      // // online-detect hotword
      // addWakeupTask(robot)
    }
  }

  robot.button.c.onChanged = function () {
    if (this.read()) {
    }
  }
}

export default {
  onRobotCreated,
}
