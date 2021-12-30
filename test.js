const Protomux = require('./')
const SecretStream = require('@hyperswarm/secret-stream')
const test = require('brittle')
const c = require('compact-encoding')

test('basic', function (t) {
  const a = new Protomux(new SecretStream(true))
  const b = new Protomux(new SecretStream(false))

  replicate(a, b)

  a.addProtocol({
    name: 'foo',
    messages: [c.string],
    onremoteopen () {
      t.pass('a remote opened')
    },
    onmessage (type, message) {
      t.is(type, 0)
      t.is(message, 'hello world')
    }
  })

  const bp = b.addProtocol({
    name: 'foo',
    messages: [c.string]
  })

  t.plan(3)

  bp.send(0, 'hello world')
})

test('echo message', function (t) {
  const a = new Protomux(new SecretStream(true))

  const b = new Protomux(new SecretStream(false), [{
    name: 'other',
    messages: [c.bool, c.bool]
  }, {
    name: 'foo',
    messages: [c.string]
  }])

  replicate(a, b)

  const ap = a.addProtocol({
    name: 'foo',
    messages: [c.string],
    onmessage (type, message) {
      ap.send(type, 'echo: ' + message)
    }
  })

  b.addProtocol({
    name: 'other',
    messages: [c.bool, c.bool]
  })

  const bp = b.addProtocol({
    name: 'foo',
    messages: [c.string],
    onremoteopen () {
      t.pass('b remote opened')
    },
    onmessage (type, message) {
      t.is(type, 0)
      t.is(message, 'echo: hello world')
    }
  })

  t.plan(3)

  bp.send(0, 'hello world')
})

test('multi message', function (t) {
  const a = new Protomux(new SecretStream(true))

  a.addProtocol({
    name: 'other',
    messages: [c.bool, c.bool]
  })

  const ap = a.addProtocol({
    name: 'multi',
    messages: [c.int, c.string, c.string]
  })

  const b = new Protomux(new SecretStream(false))

  const bp = b.addProtocol({
    name: 'multi',
    messages: [c.int, c.string]
  })

  replicate(a, b)

  t.plan(4)

  ap.send(0, 42)
  ap.send(1, 'a string with 42')
  ap.send(2, 'should be ignored')

  const expected = [
    [0, 42],
    [1, 'a string with 42']
  ]

  bp.onmessage = function (type, message) {
    const e = expected.shift()
    t.is(type, e[0])
    t.is(message, e[1])
  }
})

test('corks', function (t) {
  const a = new Protomux(new SecretStream(true))

  a.cork()

  a.addProtocol({
    name: 'other',
    messages: [c.bool, c.bool]
  })

  const ap = a.addProtocol({
    name: 'multi',
    messages: [c.int, c.string]
  })

  const b = new Protomux(new SecretStream(false))

  const bp = b.addProtocol({
    name: 'multi',
    messages: [c.int, c.string]
  })

  replicate(a, b)

  t.plan(8 + 1)

  const expected = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 'a string']
  ]

  ap.send(0, 1)
  ap.send(0, 2)
  ap.send(0, 3)
  ap.send(1, 'a string')

  a.uncork()

  b.stream.once('data', function (data) {
    t.ok(expected.length === 0, 'received all messages in one data packet')
  })

  bp.onmessage = function (type, message) {
    const e = expected.shift()
    t.is(type, e[0])
    t.is(message, e[1])
  }
})

function replicate (a, b) {
  a.stream.rawStream.pipe(b.stream.rawStream).pipe(a.stream.rawStream)
}
