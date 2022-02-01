const Protomux = require('./')
const SecretStream = require('@hyperswarm/secret-stream')
const test = require('brittle')
const c = require('compact-encoding')

test('basic', function (t) {
  const a = new Protomux(new SecretStream(true))
  const b = new Protomux(new SecretStream(false))

  replicate(a, b)

  const p = a.addProtocol({
    name: 'foo',
    messages: 1,
    onremoteopen () {
      t.pass('a remote opened')
    }
  })

  p.addMessage({
    encoding: c.string,
    onmessage (message) {
      t.is(message, 'hello world')
    }
  })

  const bp = b.addProtocol({
    name: 'foo',
    messages: 1
  })

  t.plan(2)

  bp.addMessage({ encoding: c.string }).send('hello world')
})

test('echo message', function (t) {
  const a = new Protomux(new SecretStream(true))
  const b = new Protomux(new SecretStream(false))

  replicate(a, b)

  const ap = a.addProtocol({
    name: 'foo',
    messages: 1
  })

  const aEcho = ap.addMessage({
    encoding: c.string,
    onmessage (message) {
      aEcho.send('echo: ' + message)
    }
  })

  b.addProtocol({
    name: 'other',
    messages: 2
  })

  const bp = b.addProtocol({
    name: 'foo',
    messages: 1,
    onremoteopen () {
      t.pass('b remote opened')
    }
  })

  const bEcho = bp.addMessage({
    encoding: c.string,
    onmessage (message) {
      t.is(message, 'echo: hello world')
    }
  })

  t.plan(2)

  bEcho.send('hello world')
})

test('multi message', function (t) {
  const a = new Protomux(new SecretStream(true))

  a.addProtocol({
    name: 'other',
    messages: 2
  })

  const ap = a.addProtocol({
    name: 'multi',
    messages: 3
  })

  const a1 = ap.addMessage({ encoding: c.int })
  const a2 = ap.addMessage({ encoding: c.string })
  const a3 = ap.addMessage({ encoding: c.string })

  const b = new Protomux(new SecretStream(false))

  const bp = b.addProtocol({
    name: 'multi',
    messages: 2
  })

  const b1 = bp.addMessage({ encoding: c.int })
  const b2 = bp.addMessage({ encoding: c.string })

  replicate(a, b)

  t.plan(2)

  a1.send(42)
  a2.send('a string with 42')
  a3.send('should be ignored')

  const expected = [
    42,
    'a string with 42'
  ]

  b1.onmessage = function (message) {
    t.is(message, expected.shift())
  }

  b2.onmessage = function (message) {
    t.is(message, expected.shift())
  }
})

test('corks', function (t) {
  const a = new Protomux(new SecretStream(true))

  a.cork()

  a.addProtocol({
    name: 'other',
    messages: 2
  })

  const ap = a.addProtocol({
    name: 'multi',
    messages: 2
  })

  const a1 = ap.addMessage({ encoding: c.int })
  const a2 = ap.addMessage({ encoding: c.string })

  const b = new Protomux(new SecretStream(false))

  const bp = b.addProtocol({
    name: 'multi',
    messages: 2
  })

  const b1 = bp.addMessage({ encoding: c.int })
  const b2 = bp.addMessage({ encoding: c.string })

  replicate(a, b)

  t.plan(4 + 1)

  const expected = [
    1,
    2,
    3,
    'a string'
  ]

  a1.send(1)
  a1.send(2)
  a1.send(3)
  a2.send('a string')

  a.uncork()

  b.stream.once('data', function (data) {
    t.ok(expected.length === 0, 'received all messages in one data packet')
  })

  b1.onmessage = function (message) {
    t.is(message, expected.shift())
  }

  b2.onmessage = function (message) {
    t.is(message, expected.shift())
  }
})

function replicate (a, b) {
  a.stream.rawStream.pipe(b.stream.rawStream).pipe(a.stream.rawStream)
}
