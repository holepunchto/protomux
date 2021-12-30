const c = require('compact-encoding')
const b4a = require('b4a')
const safetyCatch = require('safety-catch')
const { addProtocol } = require('./messages')

const EMPTY = []

class Protocol {
  constructor (mux) {
    this.mux = mux
    this.name = null
    this.version = null
    this.messages = EMPTY
    this.offset = 0
    this.length = 0
    this.opened = false

    this.remoteVersion = null
    this.remoteOffset = 0
    this.remoteEnd = 0
    this.remoteOpened = false
    this.remoteClosed = false

    this.onmessage = noop
    this.onremoteopen = noop
    this.onremoteclose = noop
  }

  _attach ({ name, version = { major: 0, minor: 0 }, messages, onmessage = noop, onremoteopen = noop, onremoteclose = noop }) {
    const opened = this.opened

    this.name = name
    this.version = version
    this.messages = messages
    this.offset = this.mux.offset
    this.length = messages.length
    this.opened = true
    this.corked = false

    this.onmessage = onmessage
    this.onremoteopen = onremoteopen
    this.onremoteclose = onremoteclose

    return !opened
  }

  cork () {
    if (this.corked) return
    this.corked = true
    this.mux.cork()
  }

  uncork () {
    if (!this.corked) return
    this.corked = false
    this.mux.uncork()
  }

  send (type, message) {
    if (!this.opened) return false

    const t = this.offset + type
    const m = this.messages[type]

    return this.mux._push(t, m, message)
  }

  close () {
    if (this.opened === false) return
    this.opened = false
    this.mux._unopened++

    const offset = this.offset

    this.version = null
    this.messages = EMPTY
    this.offset = 0
    this.length = 0
    this.onmessage = this.onremoteopen = this.onremoteclose = noop
    this.mux._push(2, c.uint, offset)
    this._gc()

    if (this.corked) this.uncork()
  }

  _gc () {
    if (this.opened || this.remoteOpened) return
    this.mux._removeProtocol(this)
  }

  _recv (type, state) {
    if (type >= this.messages.length) return

    const m = this.messages[type]
    const message = m.decode(state)

    this.mux._catch(this.onmessage(type, message))
  }
}

module.exports = class Protomux {
  constructor (stream, { backlog = 128, alloc, onacceptprotocol } = {}) {
    this.stream = stream
    this.protocols = []
    this.remoteProtocols = []
    this.offset = 4 // 4 messages reserved
    this.corked = 0
    this.backlog = backlog
    this.onacceptprotocol = onacceptprotocol || (() => this._unopened < this.backlog)

    this._unopened = 0
    this._batch = null
    this._alloc = alloc || (typeof stream.alloc === 'function' ? stream.alloc.bind(stream) : b4a.allocUnsafe)
    this._safeDestroyBound = this._safeDestroy.bind(this)

    this.stream.on('data', this._ondata.bind(this))
    this.stream.on('close', this._shutdown.bind(this))
  }

  sendKeepAlive () {
    this.stream.write(this._alloc(0))
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

    state.buffer = this._alloc(state.end)
    state.buffer[state.start++] = 0

    for (let i = 0; i < batch.length; i++) {
      const b = batch[i]

      c.uint.encode(state, lens[i])
      c.uint.encode(state, b.type)
      b.encoding.encode(state, b.message)
    }

    this.stream.write(state.buffer)
  }

  hasProtocol (opts) {
    return !!this.getProtocol(opts)
  }

  getProtocol ({ name, version }) {
    return this._getProtocol(name, version, false)
  }

  addProtocol (opts) {
    const p = this._getProtocol(opts.name, (opts.version && opts.version.major) || 0, true)

    if (opts.cork) p.cork()
    if (!p._attach(opts)) return p

    this._unopened--
    this.offset += p.length
    this._push(1, addProtocol, {
      name: p.name,
      version: p.version,
      offset: p.offset,
      length: p.length
    })

    return p
  }

  destroy (err) {
    this.stream.destroy(err)
  }

  _shutdown () {
    while (this.protocols.length) {
      const p = this.protocols.pop()
      if (!p.remoteOpened) continue
      if (p.remoteClosed) continue
      p.remoteOpened = false
      p.remoteClosed = true
      this._catch(p.onremoteclose())
    }
  }

  _safeDestroy (err) {
    safetyCatch(err)
    this.destroy(err)
  }

  _catch (p) {
    if (isPromise(p)) p.catch(this._safeDestroyBound)
  }

  async _acceptMaybe (added) {
    let accept = false

    try {
      accept = await this.onacceptprotocol(added)
    } catch (err) {
      this._safeDestroy(err)
      return
    }

    if (!accept) this._rejectProtocol(added)
  }

  _rejectProtocol (added) {
    for (let i = 0; i < this.protocols.length; i++) {
      const p = this.protocols[i]
      if (p.opened || p.name !== added.name || !p.remoteOpened) continue
      if (p.remoteVersion.major !== added.version.major) continue

      this._unopened--
      this.protocols.splice(i, 1)
      this._push(3, c.uint, added.offset)
      return
    }
  }

  _ondata (buffer) {
    if (buffer.byteLength === 0) return // keep alive

    const end = buffer.byteLength
    const state = { start: 0, end, buffer }

    try {
      const type = c.uint.decode(state)
      if (type === 0) this._recvBatch(end, state)
      else this._recv(type, state)
    } catch (err) {
      this._safeDestroy(err)
    }
  }

  _getProtocol (name, major, upsert) {
    for (let i = 0; i < this.protocols.length; i++) {
      const p = this.protocols[i]
      const v = p.remoteVersion === null ? p.version : p.remoteVersion
      if (p.name === name && (v !== null && v.major === major)) return p
    }

    if (!upsert) return null

    const p = new Protocol(this)
    this.protocols.push(p)
    this._unopened++
    return p
  }

  _removeProtocol (p) {
    const i = this.protocols.indexOf(this)
    if (i > -1) this.protocols.splice(i, 1)
    if (!p.opened) this._unopened--
  }

  _recvAddProtocol (state) {
    const add = addProtocol.decode(state)

    const p = this._getProtocol(add.name, add.version.major, true)
    if (p.remoteOpened) throw new Error('Duplicate protocol received')

    p.name = add.name
    p.remoteVersion = add.version
    p.remoteOffset = add.offset
    p.remoteEnd = add.offset + add.length
    p.remoteOpened = true
    p.remoteClosed = false

    if (p.opened) {
      this._catch(p.onremoteopen())
    } else {
      this._acceptMaybe(add)
    }
  }

  _recvRemoveProtocol (state) {
    const offset = c.uint.decode(state)

    for (let i = 0; i < this.protocols.length; i++) {
      const p = this.protocols[i]

      if (p.remoteOffset === offset && p.remoteOpened) {
        p.remoteVersion = null
        p.remoteOpened = false
        p.remoteClosed = true
        this._catch(p.onremoteclose())
        p._gc()
        return
      }
    }
  }

  _recvRejectedProtocol (state) {
    const offset = c.uint.decode(state)

    for (let i = 0; i < this.protocols.length; i++) {
      const p = this.protocols[i]

      if (p.offset === offset && !p.remoteClosed) {
        p.remoteClosed = true
        this._catch(p.onremoteclose())
        p._gc()
      }
    }
  }

  _recvBatch (end, state) {
    while (state.start < state.end) {
      const len = c.uint.decode(state)
      const type = c.uint.decode(state)
      state.end = state.start + len
      this._recv(type, state)
      state.end = end
    }
  }

  _recv (type, state) {
    if (type < 4) {
      if (type === 0) {
        throw new Error('Invalid nested batch')
      }

      if (type === 1) {
        this._recvAddProtocol(state)
        return
      }

      if (type === 2) {
        this._recvRemoveProtocol(state)
        return
      }

      if (type === 3) {
        this._recvRejectedProtocol(state)
        return
      }

      return
    }

    // TODO: Consider make this array sorted by remoteOffset and use a bisect here.
    // For now we use very few protocols in practice, so it might be overkill.
    for (let i = 0; i < this.protocols.length; i++) {
      const p = this.protocols[i]

      if (p.remoteOffset <= type && type < p.remoteEnd) {
        p._recv(type - p.remoteOffset, state)
        break
      }
    }
  }

  _push (type, enc, message) {
    if (this.corked > 0) {
      this._batch.push({ type, encoding: enc, message })
      return false
    }

    const state = { start: 0, end: 0, buffer: null }

    c.uint.preencode(state, type)
    enc.preencode(state, message)

    state.buffer = this._alloc(state.end)

    c.uint.encode(state, type)
    enc.encode(state, message)

    return this.stream.write(state.buffer)
  }
}

function noop () {}

function isPromise (p) {
  return typeof p === 'object' && p !== null && !!p.catch
}
