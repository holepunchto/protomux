const Protomux = require('./')
const SecretStream = require('@hyperswarm/secret-stream')
const test = require('brittle')
const c = require('compact-encoding')

test('basic', function (t) {
  const a = new Protomux(new SecretStream(true), [{
    name: 'foo',
    messages: [c.string]
  }])

  const b = new Protomux(new SecretStream(false), [{
    name: 'foo',
    messages: [c.string]
  }])

  replicate(a, b)

  const ap = a.get('foo')
  const bp = b.get('foo')

  t.plan(3)

  ap.onopen = function () {
    t.pass('a opened')
  }

  ap.onmessage = function (type, message) {
    t.is(type, 0)
    t.is(message, 'hello world')
  }

  bp.send(0, 'hello world')
})

test('echo message', function (t) {
  const a = new Protomux(new SecretStream(true), [{
    name: 'foo',
    messages: [c.string]
  }])

  const b = new Protomux(new SecretStream(false), [{
    name: 'other',
    messages: [c.bool, c.bool]
  }, {
    name: 'foo',
    messages: [c.string]
  }])

  replicate(a, b)

  const ap = a.get('foo')
  const bp = b.get('foo')

  t.plan(3)

  ap.onmessage = function (type, message) {
    ap.send(type, 'echo: ' + message)
  }

  bp.send(0, 'hello world')

  bp.onopen = function () {
    t.pass('b opened')
  }

  bp.onmessage = function (type, message) {
    t.is(type, 0)
    t.is(message, 'echo: hello world')
  }
})

test('multi message', function (t) {
  const a = new Protomux(new SecretStream(true), [{
    name: 'other',
    messages: [c.bool, c.bool]
  }, {
    name: 'multi',
    messages: [c.int, c.string, c.string]
  }])

  const b = new Protomux(new SecretStream(false), [{
    name: 'multi',
    messages: [c.int, c.string]
  }])

  replicate(a, b)

  t.plan(4)

  const ap = a.get('multi')
  const bp = b.get('multi')

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

// test('corks', function (t) {
//   const a = new Protomux(new SecretStream(true), [{
//     name: 'other',
//     messages: [c.bool, c.bool]
//   }, {
//     name: 'multi',
//     messages: [c.int, c.string]
//   }])

//   const b = new Protomux(new SecretStream(false), [{
//     name: 'multi',
//     messages: [c.int, c.string]
//   }])

//   replicate(a, b)

//   t.plan(4)

//   const ap = a.get('multi')
//   const bp = b.get('multi')

//   // ap.cork()
//   // ap.send(0, 1)
//   // ap.send(0, 2)
//   // ap.send(0, 3)
//   // ap.uncork()

//   bp.onmessage = function (type, message) {
//     console.log(type, message)
//   }
// })

function replicate (a, b) {
  a.stream.rawStream.pipe(b.stream.rawStream).pipe(a.stream.rawStream)
}
