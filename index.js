const c = require('compact-encoding')
const m = require('./messages')

class Protocol {
  constructor (muxer, offset, protocol) {
    this.muxer = muxer
    this.stream = muxer.stream
    this.start = offset
    this.end = offset + protocol.messages.length
    this.name = protocol.name
    this.version = protocol.version || { major: 0, minor: 0 }
    this.messages = protocol.messages.length
    this.remoteOpened = false
    this.removed = false
    this.encodings = protocol.messages
    this.onmessage = noop
    this.onopen = noop
    this.onclose = noop
  }

  get corked () {
    return this.muxer.corked
  }

  cork () {
    this.muxer.cork()
  }

  uncork () {
    this.muxer.uncork()
  }

  send (type, message) {
    const t = this.start + type
    const enc = this.encodings[type]

    if (this.muxer.corked > 0) {
      this.muxer._batch.push({ type: t, encoding: enc, message })
      return false
    }

    const state = { start: 0, end: 0, buffer: null }

    c.uint.preencode(state, t)
    enc.preencode(state, message)

    state.buffer = this.stream.alloc(state.end)

    c.uint.encode(state, t)
    enc.encode(state, message)

    return this.stream.write(state.buffer)
  }

  recv (type, state) {
    this.onmessage(type, this.encodings[type].decode(state))
  }
}

module.exports = class Protomux {
  constructor (stream, protocols, opts = {}) {
    this.stream = stream

    this.protocols = []
    this.offset = 2

    this.remoteProtocols = []
    this.remoteOffset = 2

    this.remoteHandshake = null
    this.onhandshake = noop

    this.corked = 0

    this._batch = null
    this._unmatchedProtocols = []

    for (const p of protocols) this.addProtocol(p)

    this.stream.on('data', this._ondata.bind(this))

    if (opts.cork) this.cork()
    this._sendHandshake()
  }

  remoteOpened (name) {
    for (const p of this.remoteProtocols) {
      if (p.local.name === name) return true
    }
    for (const { remote } of this._unmatchedProtocols) {
      if (remote.name === name) return true
    }
    return false
  }

  addProtocol (p) {
    const local = new Protocol(this, this.offset, p)

    this.protocols.push(local)
    this.offset += p.messages.length

    for (let i = 0; i < this._unmatchedProtocols.length; i++) {
      const { start, remote } = this._unmatchedProtocols[i]
      if (remote.name !== p.name || remote.version.major !== local.version.major) continue
      local.remoteOpened = true
      this._unmatchedProtocols.splice(i, 1)
      const end = start + Math.min(p.messages, local.messages)
      this.remoteProtocols.push({ local, remote, start, end })
      break
    }

    return local
  }

  removeProtocol (p) {
    for (let i = 0; i < this.protocols.length; i++) {
      const local = this.protocols[i]
      if (local.name !== p.name || local.version.major !== p.version.major) continue
      p.removed = true
      this.protocols.splice(i, 1)
    }

    for (let i = 0; i < this.remoteProtocols.length; i++) {
      const { local, remote, start } = this.remoteProtocols[i]
      if (local.name !== p.name || local.version.major !== p.version.major) continue
      this.remoteProtocols.splice(i, 1)
      this._unmatchedProtocols.push({ start, remote })
    }
  }

  addRemoteProtocol (p) {
    const local = this.get(p.name)
    const start = this.remoteOffset

    this.remoteOffset += p.messages

    if (!local || local.version.major !== p.version.major) {
      this._unmatchedProtocols.push({ start, remote: p })
      return
    }

    if (local.remoteOpened) {
      this.destroy(new Error('Remote sent duplicate protocols'))
      return
    }

    const end = start + Math.min(p.messages, local.messages)

    this.remoteProtocols.push({ local, remote: p, start, end })

    local.remoteOpened = true
    local.onopen()
  }

  removeRemoteProtocol (p) {
    for (let i = 0; i < this.remoteProtocols.length; i++) {
      const { local } = this.remoteProtocols[i]
      if (local.name !== p.name || local.version.major !== p.version.major) continue
      this.remoteProtocols.splice(i, 1)
      local.remoteOpened = false
      local.onclose()
      break
    }

    for (let i = 0; i < this._unmatchedProtocols.length; i++) {
      const { remote } = this._unmatchedProtocols[i]
      if (remote.name !== p.name || remote.version.major !== p.version.major) continue
      this._unmatchedProtocols.splice(i, 1)
      break
    }
  }

  _ondata (buffer) {
    const state = { start: 0, end: buffer.byteLength, buffer }

    try {
      this._recv(state, false)
    } catch (err) {
      this.destroy(err)
    }
  }

  _recv (state) {
    const t = c.uint.decode(state)

    if (t < 2) {
      if (t === 0) {
        this._recvBatch(state)
      } else {
        this._recvHandshake(state)
      }
      return
    }

    for (let i = 0; i < this.remoteProtocols.length; i++) {
      const p = this.remoteProtocols[i]

      if (p.start <= t && t <= p.end) {
        p.local.recv(t - p.start, state)
        break
      }
    }

    state.start = state.end
  }

  _recvBatch (state) {
    const end = state.end

    while (state.start < state.end) {
      const len = c.uint.decode(state)
      state.end = state.start + len
      this._recv(state, true)
      state.end = end
    }
  }

  _recvHandshake (state) {
    if (this.remoteHandshake !== null) {
      this.destroy(new Error('Double handshake'))
      return
    }

    this.remoteHandshake = m.handshake.decode(state)
    for (const p of this.remoteHandshake.protocols) this.addRemoteProtocol(p)

    this.onhandshake(this.remoteHandshake)
  }

  destroy (err) {
    this.stream.destroy(err)
  }

  get (name) {
    for (const p of this.protocols) {
      if (p.name === name) return p
    }
    return null
  }

  cork () {
    if (++this.corked === 1) this._batch = []
  }

  uncork () {
    if (--this.corked !== 0) return

    const batch = this._batch
    this._batch = null

    const state = { start: 0, end: 1, buffer: null }
    const lens = new Array(batch.length)

    for (let i = 0; i < batch.length; i++) {
      const b = batch[i]
      const end = state.end

      c.uint.preencode(state, b.type)
      b.encoding.preencode(state, b.message)
      c.uint.preencode(state, lens[i] = (state.end - end))
    }

    state.buffer = this.stream.alloc(state.end)
    state.buffer[state.start++] = 0

    for (let i = 0; i < batch.length; i++) {
      const b = batch[i]

      c.uint.encode(state, lens[i])
      c.uint.encode(state, b.type)
      b.encoding.encode(state, b.message)
    }

    this.stream.write(state.buffer)
  }

  sendKeepAlive () {
    this.stream.write(this.stream.alloc(0))
  }

  _sendHandshake () {
    const hs = {
      protocols: this.protocols
    }

    if (this.corked > 0) {
      this._batch.push({ type: 0, encoding: m.handshake, message: hs })
      return
    }

    const state = { start: 0, end: 0, buffer: null }

    c.uint.preencode(state, 1)
    m.handshake.preencode(state, hs)

    state.buffer = this.stream.alloc(state.end)

    c.uint.encode(state, 1)
    m.handshake.encode(state, hs)

    this.stream.write(state.buffer)
  }
}

function noop () {}
