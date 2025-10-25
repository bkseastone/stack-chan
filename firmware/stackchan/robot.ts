import Timer from 'timer'
import { Vector3, Pose, Rotation, Maybe, noop, randomBetween } from 'stackchan-util'
import { type FaceContext, type Emotion, createFaceContext, FaceDecorator } from 'renderer-base'
import Digital from 'embedded:io/digital'
import Touch from 'touch'
import { createBalloonDecorator } from 'decorator'
import { DEFAULT_FONT } from 'consts'
import Resource from 'Resource'
import parseBMF from 'commodetto/parseBMF'
import WebSocket from 'embedded:io/tcp/websocket'
import AudioIn from "pins/audioin"
import Time from 'time'
import {Request} from "http"  // $(MODDABLE)/modules/network/http/http.js


const INTERVAL_FACE = 1000 / 30
const INTERVAL_POSE = 1000 / 10

/**
 * The Driver for the actuator
 */
export type Driver = {
  applyRotation: (ori: Rotation, time?: number) => Promise<void>
  getRotation: () => Promise<Maybe<Rotation>>
  setTorque: (torque: boolean) => Promise<void>
  onAttached?: () => void
  onDetached?: () => void
}

/**
 * The text-to-speech engine
 */
export type TTS = {
  stream: (text: string) => Promise<void>
  onPlayed: (volume: number) => void
  onDone: () => void
}

/**
 * The display renderer
 */
export type Renderer = {
  update: (interval: number, faceContext: Readonly<FaceContext>) => void
  addDecorator(decorator: FaceDecorator): void
  removeDecorator(decorator: FaceDecorator): void
}

export type Button = {
  onChanged: (this: Digital) => void
}

const buttonNames = ['a', 'b', 'c'] as const
type ButtonName = typeof buttonNames[number]

/**
 * The constructor parameters of the robot.
 */
type RobotConstructorParam<T extends string> = {
  driver: Driver
  renderer: Renderer
  tts: TTS
  button: { [key in T]: Button }
  pose?: {
    body: Pose
    eyes: {
      left: Pose
      right: Pose
    }
  }
  touch?: Touch
}

/**
 * 听力引擎
 */
export class HearingEngine {
  #owner: Robot
  #audioin: AudioIn
  #listenHandler: Timer
  listening: boolean  // 自身状态, 由"听力引擎"更新
  isNeedToListen: boolean  // 启动开关, 由"唤醒引擎"或"语言引擎"打开, 由"听力引擎"关闭
  text: string  // "听力引擎"的输出
  constructor(param: {owner: Robot, audioin: AudioIn}) {
    this.listening = false
    this.isNeedToListen = false
    this.text = ""
    this.#owner = param.owner;
    this.#audioin = param.audioin;
    if (16 !== this.#audioin.bitsPerSample)
        throw new Error("expects 16 bit samples");

    this.start();
  }

  /**
   * 仅debug用, 线上代码不要获取 #audioin, 因为这里没有加锁
   */
  get audioin() {
    return this.#audioin;
  }

  // TODO: 这里要抽象出去, 类似于tts-remote, 通用的网络连接和硬件驱动都放到统一的地方, 不能干扰业务逻辑
  async listen({that, host="127.0.0.1", port=80, path="/"}) : Promise<string> {
    return new Promise((resolve, reject) => {
        const chunksPerSecond = 10;  // 100ms
        const sampleCount = Math.floor(that.#audioin.sampleRate / chunksPerSecond);
        let asrResult = "";
  
        const ws = new WebSocket(`ws://${host}:${port}${path}`);
  
        ws.addEventListener('open', () => {
            ws.send(that.#audioin.read(sampleCount));
            // trace('send first done\n');
        });
        ws.addEventListener('message', (payload) => {
            let value = JSON.parse(payload.data)
            if (value.result === 0) {
                // pcm data not enough
                ws.send(that.#audioin.read(sampleCount));
            }
            else if (value.result === 1) {
                // 用户持续一段时间没有再说话了, 服务端将要关闭连接, 不能再发消息了
                // trace("user is no talking\n");
            }
            else {
                // 获取语音识别结果
                asrResult = value.result;
                let chunk = that.#audioin.read(sampleCount);
                ws.send(chunk);
            }
        });
        ws.addEventListener('close', (event) => {
            resolve(asrResult);
            ws.close();
        });
        ws.addEventListener('error', (event) => {
            reject(`${event}\n`);
            ws.close();
        });
    });
  }

  start() {
    this.stop()
    this.#listenHandler = Timer.repeat(async () => {
      // 确认听力引擎是否空闲
      if (this.listening)
        return;
      // 检查是否启动监听
      if (!this.isNeedToListen)
        return;

      this.listening = true;

      let that = this;
      await this.listen({
        that,
        host: "192.168.31.64",
        port: 9292,
        path: "/bytedance/asr/streaming",
      })
      .then(body => {
        that.text = body;
        trace(`[HearingEngine] listen response body: ${body}\n`);
      })
      .catch(error => {
        that.text = "";
        trace(`[HearingEngine] listen failed: ${error}\n`);
      });

      // 释放听力引擎
      this.listening = false;
      this.isNeedToListen = false;

      if (this.text.length > 0) {
        // 意图识别 & 状态流转
        // todo: 将"answerUserQuestion"放到robot中去
        if (this.#owner.brain.tasks?.["answerUserQuestion"]) {
          this.#owner.brain.tasks["answerUserQuestion"].isNeedToThinkXxx = true;
        }
      } else {
        // 没有新的语音输入, 关闭"聊天"功能
        this.#owner.isNeedToChat = false;
        trace(`[HearingEngine] no more input, stop chat.\n`);
      }
    }, 100)
  }

  stop() {
    if (typeof this.#listenHandler !== 'undefined')
      Timer.clear(this.#listenHandler)
  }
}

/**
 * 每个维度的思考都需要这样一个三元组: 自身状态, 启动开关, 定时器任务
 */
export type ThinkingTask = {
  isThinkingXxx: boolean
  isNeedToThinkXxx: boolean
  xxxTask: Timer
}

/**
 * 思考引擎
 */
export class ThinkingEngine {
  #owner: Robot
  tasks: { [taskName: string]: ThinkingTask }
  defaultTaskName: string
  constructor(param: {owner: Robot}) {
    this.#owner = param.owner;
    this.tasks = {}
    this.defaultTaskName = 'answerUserQuestion'
    this.register(this.defaultTaskName, Timer.repeat(this.defaultTaskHandler.bind(this), 100))
  }

  async defaultTaskHandler() {
    let defaultTask = this.tasks[this.defaultTaskName]
    // 确认思考引擎是否空闲
    if (defaultTask.isThinkingXxx)
      return;
    // 检查是否启动思考
    if (!defaultTask.isNeedToThinkXxx)
      return;

    defaultTask.isThinkingXxx = true;

    trace(`[ThinkingEngine] start defaultTaskHandler(${this.defaultTaskName}) with input: ${this.#owner.ear.text}\n`)

    let that = this;
    this.#owner.mouse.textGenerating = true;
    await this.answerUserQuestion({
      that,
      host: "192.168.31.64",
      port: 10092,
      path: "/chatgpt/streaming",
      msg: this.#owner.ear.text,
      task_name: this.defaultTaskName,
    })
    .then(body => trace(`[ThinkingEngine] ${this.defaultTaskName} output summary: ${body}\n`))
    .catch(error => trace(`[ThinkingEngine] ${this.defaultTaskName} failed: ${error}\n`));
    this.#owner.mouse.textGenerating = false;

    // 释放思考引擎
    defaultTask.isThinkingXxx = false;
    defaultTask.isNeedToThinkXxx = false;
  }

  thinkDirectlyNoChat(text: string) {
    this.tasks[this.defaultTaskName].isNeedToThinkXxx = true;
    this.#owner.ear.text = text;
    this.#owner.isNeedToChat = false;
  }

  async answerUserQuestion({that, host="127.0.0.1", port=80, path="/", msg="", task_name=""}) {
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

      let errMsg = '';

      request.callback = function(message, value, extValue) {
        if (Request.status === message) {
          if (value != 200) {
            errMsg = `response status: ${value}\n`;
          }
        }
        else if (Request.responseFragment === message) {
          let resPart = this.read(String);
          that.#owner.mouse.text += resPart;
          // trace(`responseFragment: ${resPart}.\n`);
        }
        else if (Request.responseComplete === message) {
          resolve(that.#owner.mouse.text);
        }
        else if (Request.error === message) {
          reject(errMsg);
        }
        else if (message < 0) {
          reject("message < 0");
        }
      }
    });
  }

  register(taskName: string, task: Timer) {
    this.deregister(taskName)
    this.tasks[taskName] = {
      isThinkingXxx: false,
      isNeedToThinkXxx: false,
      xxxTask: task,
    }
  }
  deregister(taskName: string) {
    if (typeof this.tasks?.[taskName]?.xxxTask !== 'undefined') {
      if (this.tasks[taskName].xxxTask)
        Timer.clear(this.tasks[taskName].xxxTask)
      this.tasks[taskName].isThinkingXxx = false
      this.tasks[taskName].isNeedToThinkXxx = false
    }
  }
}

/**
 * 语言引擎
 */
export class LanguageEngine {
  #owner: Robot
  #speakHandler: Timer
  speaking: boolean  // 自身状态, 由"语言引擎"更新

  // 下面由"思考引擎"更新
  text: string  // 可能需要说的话, 通过有无内容代替了isNeedToSpeak变量 (由语言引擎清空)
  textGenerating: boolean  // 标识是否有正在思考中的问题尚未完成, 若是则不断检查text以输出语音, 否则在播放完text后清空text
  lastTextTs: number  // 最近一次思考完问题的时间

  // 下面由"语言引擎"更新
  #speakIdx: number
  audioGenerating: string  // 正在说的句子, 通过有无内容代替是否有正在说的话尚未完成
  lastAudioTs: number  // 最近一次说完话的时间
  constructor(param: {owner: Robot}) {
    this.speaking = false
    this.text = ""
    this.textGenerating = false
    this.lastTextTs = 0
    this.#speakIdx = -1
    this.audioGenerating = ""
    this.lastAudioTs = 1
    this.#owner = param.owner;

    this.start();
  }

  /**
   * 找到接下来可以说的句子 (后续这里可以优化成更智能的句子选择, 比如引入思考引擎, 根据其它环境(传感器)信息适时修改句子)
   */
  async inspectText(that: LanguageEngine) : Promise<string> {
    return new Promise((resolve, reject) => {
      // const messages = that.text.split(/[,.!?:;()，。！？：；（）]/);
      const messages = that.text.split(/[。！？]/);
      const lastSpeakIdx = that.#speakIdx;
      for (let i = that.#speakIdx + 1; i < messages.length; i++) {
        that.#speakIdx = i;
        if (messages[i].length == 0) {
          continue;
        }
        break;
      };

      // js的split方法会把空字符串也作为元素, 故这里需要过滤掉
      if (messages[that.#speakIdx].length == 0) {
        that.#speakIdx = lastSpeakIdx;
      }

      // trace(`debug LanguageEngine.inspectText: ${that.#speakIdx} | ${lastSpeakIdx} | ${messages.length} | ${messages}\n`)
      if (that.#speakIdx != lastSpeakIdx && that.#speakIdx < messages.length) {
        // TODO: 将标点符号加回来
        resolve(messages[that.#speakIdx]);
      }
      else {
        resolve("");
      }
    });
  }

  /**
   * 直接向语言引擎发送语句, 并不触发对话逻辑
   */
  speakDirectlyNoChat(text: string) {
    this.textGenerating = false;
    this.text = text;
    this.#owner.isNeedToChat = false;
  }

  /**
   * 直接向语言引擎发送语句, 并触发对话逻辑
   */
  startChatWithSpeak(text: string) {
    this.textGenerating = false;
    this.text = text;
    this.#owner.isNeedToChat = true;
  }

  start() {
    this.stop()
    this.#speakHandler = Timer.repeat(async () => {
      // 确认语言引擎是否空闲
      if (this.speaking)
        return;
      // 检查是否有需要说的话
      if (this.text.length == 0)
        return;
      
      this.speaking = true;

      let that = this;
      await this.inspectText(that)
      .then(unfinishedText => {
        that.audioGenerating = unfinishedText;
      });

      if (this.audioGenerating.length > 0) {
        trace(`[LanguageEngine] input: ${this.audioGenerating}\n`)
        // 避免调试时打扰, 可注释掉这一句, 将只输出到终端
        await this.#owner.say(this.audioGenerating);
        this.speaking = false;
        return;  // 话没说完, 需要继续下一句的调度
      }

      // 释放语言引擎
      this.speaking = false;

      // 状态流转
      if (this.textGenerating == false) {
        this.text = "";
        this.#reset();
        if (this.#owner.isNeedToChat == true) {
          this.#owner.ear.isNeedToListen = true;
        }
      }
    }, 100)
  }

  #reset() {
    this.#speakIdx = -1;
    this.speaking = false;
    this.lastAudioTs = this.#owner.getTimeNumber();
    trace(`[LanguageEngine] reset ts: ${this.lastAudioTs}\n`)
  }

  stop() {
    if (typeof this.#speakHandler !== 'undefined')
      Timer.clear(this.#speakHandler);
    this.#reset();
  }
}

const LEFT_RIGHT = Object.freeze(['left', 'right'])
export class Robot {
  /**
   * A Facade class that provides quick access for Stack-chan features
   *
   * @public
   */
  #gazePoint: Vector3
  #pose: {
    body: Pose
    eyes: {
      left: Pose
      right: Pose
    }
  }
  #power: number
  #tts: TTS
  #ear: HearingEngine
  #brain: ThinkingEngine
  #mouse: LanguageEngine
  #driver: Driver
  #button: { [key in ButtonName]: Button }
  #touch: Touch
  #isMoving: boolean
  #renderer: Renderer
  #paused: boolean
  #faceContext: FaceContext
  #emotion: Emotion
  #updatePoseHandler: Timer
  #updateFaceHandler: Timer
  #font: ReturnType<typeof parseBMF>
  #balloon: FaceDecorator
  updating: boolean
  isNeedToChat: boolean  // 对话 状态标识/启动开关, 由"唤醒引擎"或"语言引擎"打开, 由"听力引擎"关闭
  constructor(params: RobotConstructorParam<ButtonName>) {
    this.useRenderer(params.renderer)
    this.useDriver(params.driver)
    this.useTTS(params.tts)
    this.#ear = new HearingEngine({
      owner: this,
      audioin: new AudioIn(),
    })
    this.#brain = new ThinkingEngine({
      owner: this,
    })
    this.#mouse = new LanguageEngine({
      owner: this,
    })
    this.isNeedToChat = false
    this.#isMoving = false
    this.#power = 0
    this.#button = params.button
    this.#touch = params.touch
    this.#pose = params.pose ?? {
      body: {
        position: {
          x: 0.0,
          y: 0.0,
          z: 0.0,
        },
        rotation: {
          y: 0.0,
          p: 0.0,
          r: 0.0,
        },
      },
      eyes: {
        left: {
          position: {
            x: 0.03,
            y: 0.009,
            z: 0,
          },
          rotation: {
            r: 0.0,
            p: 0.0,
            y: 0.0,
          },
        },
        right: {
          position: {
            x: 0.03,
            y: -0.009,
            z: 0,
          },
          rotation: {
            r: 0.0,
            p: 0.0,
            y: 0.0,
          },
        },
      },
    }
    this.#updatePoseHandler = Timer.repeat(this.updatePose.bind(this), INTERVAL_POSE)
    this.#updateFaceHandler = Timer.repeat(this.updateFace.bind(this), INTERVAL_FACE)
    this.#paused = false
    this.#faceContext = createFaceContext()
  }

  /**
   * set a TTS instance to Robot and register callbacks
   *
   * @param tts - TTS class instance
   */
  useTTS(tts: TTS) {
    if (this.#tts != null) {
      this.#tts.onDone = noop
      this.#tts.onPlayed = noop
    }
    this.#tts = tts
    this.#tts.onPlayed = (volume: number) => {
      this.#power = volume
    }
    this.#tts.onDone = () => {
      this.#power = 0
    }
  }

  /**
   * set a Renderer instance to Robot and register callbacks
   *
   * @param renderer - Renderer class instance
   */
  useRenderer(renderer: Renderer) {
    this.#renderer = renderer
  }

  /**
   * set a Driver instance to Robot and register callbacks
   *
   * @param driver - Driver class instance
   */
  useDriver(driver: Driver) {
    if (this.#driver != null) {
      this.#driver.onDetached?.()
    }
    this.#driver = driver
    this.#driver.onAttached?.()
  }

  /**
   * get Buttons
   *
   * @returns Button instances
   */
  get button() {
    return this.#button
  }

  /**
   * get Touch
   *
   * @returns Touch instances
   */
  get touch() {
    return this.#touch
  }

  /**
   * get Pose
   *
   * @returns Button instances
   */
  get pose() {
    return this.#pose
  }

  /**
   * let the robot say things
   *
   * @param text - the key or speech text itself to say
   * @returns the text when speech finishes, otherwise the reason why it fails.
   */
  async say(text: string): Promise<Maybe<string>> {
    return new Promise((resolve, _reject) => {
      this.#tts
        .stream(text)
        .catch((reason) => {
          trace('error\n')
          resolve({
            success: false,
            reason,
          })
        })
        .then(() => {
          resolve({
            success: true,
            value: text,
          })
        })
    })
  }

  /**
   * Move the focus point of the robot.
   * When the robot looks somewhere, it moves its gaze or face direction
   * toward that point.
   * The function lookAt completes synchronously,
   * and the function does not know when to start or finish moving the gaze.
   *
   * @param position - the position of the point to look at
   */
  lookAt(position: Vector3) {
    this.#gazePoint = position
  }

  /**
   * Show balloon decorator
   *
   * @param text - the text on the balloon
   */
  showBalloon(
    text: string,
    option = {
      right: 20,
      top: 10,
      width: 80,
    }
  ) {
    if (this.#balloon != null) {
      this.hideBalloon()
    }
    if (this.#font == null) {
      this.#font = parseBMF(new Resource(DEFAULT_FONT))
    }
    this.#balloon = createBalloonDecorator({
      ...option,
      height: this.#font.height,
      font: this.#font,
      text,
    })
    this.#renderer.addDecorator(this.#balloon)
  }

  /**
   * Hide balloon decorator
   */
  hideBalloon() {
    if (this.#balloon != null) {
      this.renderer.removeDecorator(this.#balloon)
      this.#balloon = null
    }
  }

  /**
   * Unregister the focus point.
   */
  lookAway() {
    this.#gazePoint = null
  }

  /**
   * Set the pose.
   *
   * @returns void when the robot start moving
   * @experimental
   */
  async setPose(pose: Pose, time?: number): Promise<void> {
    return this.#driver.applyRotation(pose.rotation, time)
  }

  /**
   * Set the actuator torque.
   *
   * @returns void when the robot completes setting the torque
   */
  async setTorque(torque: boolean): Promise<void> {
    return this.#driver.setTorque(torque)
  }

  /**
   * Set the color
   * @param{key} - 'primary' or 'secondary'
   * @param{r} - red value [0-255]
   * @param{g} - green value [0-255]
   * @param{b} - blue value [0-255]
   */
  setColor(key: keyof FaceContext['theme'], r, g, b): void {
    this.#faceContext.theme[key] = [r, g, b]
  }

  /**
   * Set the emotion of the robot.
   * The emotion may (or may not) affect the way the robot moves
   * and its facial expressions.
   *
   * @param emotion - emotion
   */
  setEmotion(emotion: Emotion) {
    this.#emotion = emotion
  }

  get driver(): Driver {
    return this.#driver
  }

  get tts(): TTS {
    return this.#tts
  }

  get ear(): HearingEngine {
    return this.#ear
  }

  get brain(): ThinkingEngine {
    return this.#brain
  }

  get mouse(): LanguageEngine {
    return this.#mouse
  }

  get renderer(): Renderer {
    return this.#renderer
  }

  pause() {
    this.#paused = true
  }

  resume() {
    this.#paused = false
  }
  /**
   * Update the robot face.
   * Process the robot's emotion, pose, gaze point and so on
   * to modify the face context and passes it to Renderer#update
   */
  updateFace() {
    if (this.#paused) {
      return
    }
    if (this.#power != 0) {
      this.#faceContext.mouth.open = Math.min(this.#power / 2000, 1.0)
    }
    this.#faceContext.emotion = this.#emotion
    if (this.#gazePoint != null) {
      const relativeGazePoint = Vector3.rotate(this.#gazePoint, {
        r: 0.0,
        y: -this.#pose.body.rotation.y,
        p: -this.#pose.body.rotation.p,
      })
      for (const key of LEFT_RIGHT) {
        const pos = this.#pose.eyes[key].position
        const relative = Vector3.sub(relativeGazePoint, [pos.x, pos.y, pos.z])
        const { y, p } = Rotation.fromVector3(relative)
        const eye = this.#faceContext.eyes[key]
        eye.gazeX = Math.cos(y)
        eye.gazeY = Math.cos(p)
      }
    }
    this.#renderer.update(INTERVAL_FACE, this.#faceContext)
  }

  /**
   * Update the robot pose.
   * Get the current pose from the Driver
   * and trigger move if necessary to see the gaze point.
   */
  async updatePose(id) {
    if (this.updating || this.#paused) {
      return
    }
    this.updating = true
    const result = await this.#driver.getRotation()
    if (result.success) {
      this.#pose.body.rotation = result.value
    }

    if (!this.#isMoving && this.#gazePoint != null) {
      const relativeGazePoint = Vector3.rotate(this.#gazePoint, {
        r: 0.0,
        y: -this.#pose.body.rotation.y,
        p: -this.#pose.body.rotation.p,
      })
      const { y, p } = Rotation.fromVector3(relativeGazePoint)
      if (y > Math.PI / 6 || y < -Math.PI / 6 || p > Math.PI / 6 || p < -Math.PI / 6) {
        this.#isMoving = true
        const time = randomBetween(0.5, 1.0)
        await this.#driver.setTorque(true)
        await this.#driver.applyRotation(Rotation.fromVector3(this.#gazePoint), time)
        Timer.set(async () => {
          await this.#driver.setTorque(false)
          this.#isMoving = false
        }, time * 1000 + 50)
      }
    }
    this.updating = false
  }

  getTimeString() {
    let date = new Date();
    let yyyy = date.getFullYear();
    let MM = (date.getMonth()+1 < 10 ? '0'+(date.getMonth()+1) : date.getMonth()+1);
    let dd = (date.getDate() < 10 ? '0'+(date.getDate()) : date.getDate());
    let hh = (date.getHours() < 10 ? '0'+(date.getHours()) : date.getHours());
    let mm = (date.getMinutes() < 10 ? '0'+(date.getMinutes()) : date.getMinutes());
    let ss = (date.getSeconds() < 10 ? '0'+(date.getSeconds()) : date.getSeconds());
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`
  }

  getTimeNumber() {
      return Date.now()
  }

  static getVersion() {
    return 0.0;
  }
}
