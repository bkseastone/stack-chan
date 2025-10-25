/* eslint-disable prefer-const */
import AudioOut from 'pins/audioout'
import WavStreamer from 'wavstreamer'
import calculatePower from 'calculate-power'
import HTTPClient from 'embedded:network/http/client'
import { File } from 'file'
import config from 'mc/config'

const QUERY_PATH = config.file.root + 'query.json'

/* global trace, SharedArrayBuffer */

declare const device: any

export type TTSProperty = {
  onPlayed: (number) => void
  onDone: () => void
  host: string
  port: number
  sampleRate: number
  speakerId: number
}

export class TTS {
    audio: AudioOut
    onPlayed: (number) => void
    onDone: () => void
    // TODO: Add type definition for HTTPClient
    client: HTTPClient
    host: string
    port: number
    streaming: boolean
    file: File
    speakerId: number
    constructor(props: TTSProperty) {
      this.onPlayed = props.onPlayed
      this.onDone = props.onDone
      this.audio = new AudioOut({ streams: 1, bitsPerSample: 16, sampleRate: props.sampleRate ?? 24000 })
      this.speakerId = props.speakerId ?? 0
      this.host = props.host
      this.port = props.port
    }
    // todo: 可以用来测试同步请求的用法
    // async getSampleRate(): Promise<number> {
    //   return new Promise((resolve, reject) => {
    //     let sampleRate
    //     const client = new device.network.http.io({
    //       ...device.network.http,
    //       host: this.host,
    //       port: this.port,
    //     })
        
    //     client.request({
    //       method: 'GET',
    //       path: '/paddlespeech/tts/streaming/samplerate',
    //       onHeaders(status) {
    //         if (status !== 200) {
    //           reject(`server returned ${status}`)
    //         }
    //       },
    //       onReadable(count) {
    //         let result
    //         try {
    //             const text = this.read(count)
    //             trace(`getSampleRate: ${text}\n`)
    //             result = JSON.parse(text)
    //         } catch (e) {
    //             trace('parse failed.\n')
    //             return
    //         }
    //         sampleRate = result.sample_rate ?? 24000
    //       },
    //       onDone() {
    //         client.close()
    //         resolve()
    //       },
    //     })
    //     return sampleRate
    //   })
    // }
    async stream(key: string): Promise<void> {
      if (this.streaming) {
        throw new Error('already playing')
      }
      this.streaming = true
  
      const host = this.host
      const port = this.port
      const speakerId = this.speakerId
      // const sampleRate = await this.getSampleRate()
      const { onPlayed, onDone, audio } = this
      // trace(`sampleRate is: ${sampleRate}`)
      const reqBody = {
        "text": key,
        "spk_id": speakerId,
      }
      let reqBodyStr = JSON.stringify(reqBody)
      // TODO: 这里用file去管理请求体的写入, 应该可以稍微简化一下, 只用一个句柄
      File.delete(QUERY_PATH)
      const fileWrite = new File(QUERY_PATH, true)
      fileWrite.write(reqBodyStr)
      fileWrite.close()
      const fileRead = new File(QUERY_PATH)
      // trace(`file opened. length: ${fileRead.length}, position: ${fileRead.position}`)
      return new Promise((resolve, reject) => {
        let streamer = new WavStreamer({
          http: device.network.http,
          host,
          port,
          path: '/chattts/tts/streaming',
          audio: {
            out: audio,
            stream: 0,
          },
          bufferDuration: 600,
          request: {
            method: 'POST',
            path: '/chattts/tts/streaming',
            headers: new Map([
                ['content-type', 'application/json'],
                ['content-length', `${fileRead.length}`],
            ]),
            onWritable(count) {
              this.write(fileRead.read(ArrayBuffer, count))
            },
          },
          onPlayed(buffer) {
            const power = calculatePower(buffer)
            onPlayed?.(power)
          },
          onReady(state) {
            // trace(`Ready: ${state}\n`)
            if (state) {
              audio.start()
            } else {
              audio.stop()
            }
          },
          onError: (e) => {
            fileRead.close()
            // trace('ERROR: ', e, '\n')
            this.streaming = false
            reject(e)
          },
          onDone: () => {
            fileRead.close()
            // trace('DONE\n')
            this.streaming = false
            streamer?.close()
            onDone?.()
            resolve()
          },
        })
      })
    }
  }