import Timer from 'timer'
import RS30X from 'rs30x'
declare const button: {
  [key: string]: {
    onChanged: (this: { read: () => number }) => void
  }
}

const servo = new RS30X({
  id: 1,
})

const servo2 = new RS30X({
  id: 2,
})

let torqueEnabled = true
let angle = 0
let tick = 10

async function writeTest() {
  angle += tick
  if (angle >= 200 || angle <= 0) {
    tick = -tick
  }
  await servo.setTorque(true)
  await servo2.setTorque(true)
  await servo.setAngleInTime(angle - 100, 0.5)
  await servo2.setAngleInTime((angle - 100) * 0.1, 0.5)
  Timer.set(async () => {
    await servo.setTorque(false)
    await servo2.setTorque(false)
  }, 600)
}

async function readTest() {
  for (let srv of [servo, servo2]) {
    let angle = await srv.readStatus().catch(e => {
      trace(e + '\n')
    })
    trace(`${srv.id}...current angle: ${angle}\n`)
  }
}

button.a.onChanged = function () {
  if (!this.read()) {
    writeTest()
  }
}

button.b.onChanged = function () {
  if (!this.read() && servo.id !== 2) {
    readTest()
  }
}
