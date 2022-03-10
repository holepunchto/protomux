const b4a = require('b4a')
const c = require('compact-encoding')
const queueTick = require('queue-tick')
const safetyCatch = require('safety-catch')

const MAX_BUFFERED = 32768
const MAX_BACKLOG = 256

class Session {
  constructor (mux, info, protocol, id, context, messages, onopen, onclose, ondestroy) {
    this.protocol = protocol
    this.id = id
    this.context = context
    this.messages = []
    this.remoteMessages = this.messages

    this.opened = false
    this.closed = false
    this.destroyed = false

    this.onopen = onopen
    this.onclose = onclose
    this.ondestroy = ondestroy

    this._mux = mux
    this._info = info
    this._localId = 0
    this._remoteId = 0
    this._active = 0
    this._extensions = null

    this._decBound = this._dec.bind(this)
    this._decAndDestroyBound = this._decAndDestroy.bind(this)

    for (const m of messages) this.addMessage(m)
  }

  _open () {
    const id = this._mux._free.length > 0
      ? this._mux._free.pop()
      : this._mux._local.push(null) - 1

    this._info.opened++
    this._localId = id + 1
    this._mux._local[id] = this

    const state = { buffer: null, start: 2, end: 2 }

    c.string.preencode(state, this.protocol)
    c.buffer.preencode(state, this.id)
    c.uint.preencode(state, this._localId)

    state.buffer = this._mux._alloc(state.end)

    state.buffer[0] = 0
    state.buffer[1] = 1
    c.string.encode(state, this.protocol)
    c.buffer.encode(state, this.id)
    c.uint.encode(state, this._localId)

    this._mux._write0(state.buffer)
  }

  _dec () {
    if (--this._active === 0 && this.closed === true) this._destroy()
  }

  _decAndDestroy (err) {
    this._dec()
    this._mux._safeDestroy(err)
  }

  _fullyOpenSoon () {
    this._mux._remote[this._remoteId - 1].session = this
    queueTick(this._fullyOpen.bind(this))
  }

  _fullyOpen () {
    if (this.opened === true || this.closed === true) return

    const remote = this._mux._remote[this._remoteId - 1]

    this.opened = true
    this._track(this.onopen(this))

    remote.session = this
    if (remote.pending !== null) this._drain(remote)
  }

  _drain (remote) {
    for (let i = 0; i < remote.pending.length; i++) {
      const p = remote.pending[i]
      this._mux._buffered -= byteSize(p.state)
      this._recv(p.type, p.state)
    }

    remote.pending = null
    this._mux._resumeMaybe()
  }

  _track (p) {
    if (isPromise(p) === true) {
      this._active++
      p.then(this._decBound, this._decAndDestroyBound)
    }
  }

  _close (isRemote) {
    if (this.closed === true) return
    this.closed = true

    this._info.opened--

    if (this._remoteId > 0) {
      this._mux._remote[this._remoteId - 1] = null
      this._remoteId = 0
      // If remote has acked, we can reuse the local id now
      // otherwise, we need to wait for the "ack" to arrive
      this._mux._free.push(this._localId - 1)
    }

    this._mux._local[this._localId - 1] = null
    this._localId = 0

    this._mux._gc(this._info)
    this._track(this.onclose(isRemote, this))

    if (this._active === 0) this._destroy()
  }

  _destroy () {
    if (this.destroyed === true) return
    this.destroyed = true
    this._track(this.ondestroy(this))
  }

  _recv (type, state) {
    if (type < this.remoteMessages.length) {
      this.remoteMessages[type].recv(state, this)
    }
  }

  cork () {
    this._mux.cork()
  }

  uncork () {
    this._mux.uncork()
  }

  close () {
    if (this.closed === true) return

    const state = { buffer: null, start: 2, end: 2 }

    c.uint.preencode(state, this._localId)

    state.buffer = this._mux._alloc(state.end)

    state.buffer[0] = 0
    state.buffer[1] = 3
    c.uint.encode(state, this._localId)

    this._close(false)
    this._mux._write0(state.buffer)
  }

  addMessage (opts) {
    if (!opts) return this._skipMessage()

    const type = this.messages.length
    const encoding = opts.encoding || c.raw
    const onmessage = opts.onmessage || noop

    const s = this
    const typeLen = encodingLength(c.uint, type)

    const m = {
      type,
      encoding,
      onmessage,
      recv (state, session) {
        session._track(m.onmessage(encoding.decode(state), session))
      },
      send (m, session = s) {
        if (session.closed === true) return false

        const mux = session._mux
        const state = { buffer: null, start: 0, end: typeLen }

        if (mux._batch !== null) {
          encoding.preencode(state, m)
          state.buffer = mux._alloc(state.end)

          c.uint.encode(state, type)
          encoding.encode(state, m)

          mux._pushBatch(session._localId, state.buffer)
          return true
        }

        c.uint.preencode(state, session._localId)
        encoding.preencode(state, m)

        state.buffer = mux._alloc(state.end)

        c.uint.encode(state, session._localId)
        c.uint.encode(state, type)
        encoding.encode(state, m)

        return mux.stream.write(state.buffer)
      }
    }

    this.messages.push(m)

    return m
  }

  _skipMessage () {
    const type = this.messages.length
    const m = {
      type,
      encoding: c.raw,
      onmessage: noop,
      recv (state, session) {},
      send (m, session) {}
    }

    this.messages.push(m)
    return m
  }
}

module.exports = class Protomux {
  constructor (stream, { alloc } = {}) {
    this.isProtomux = true
    this.stream = stream
    this.corked = 0

    this._alloc = alloc || (typeof stream.alloc === 'function' ? stream.alloc.bind(stream) : b4a.allocUnsafe)
    this._safeDestroyBound = this._safeDestroy.bind(this)

    this._remoteBacklog = 0
    this._buffered = 0
    this._paused = false
    this._remote = []
    this._local = []
    this._free = []
    this._batch = null
    this._batchState = null

    this._infos = new Map()
    this._notify = new Map()

    this.stream.on('data', this._ondata.bind(this))
    this.stream.on('error', noop) // we handle this in "close"
    this.stream.on('close', this._shutdown.bind(this))
  }

  static from (stream, opts) {
    if (stream.isProtomux) return stream
    return new this(stream, opts)
  }

  * [Symbol.iterator] () {
    for (const session of this._local) {
      if (session !== null) yield session
    }
  }

  cork () {
    if (++this.corked === 1) {
      this._batch = []
      this._batchState = { buffer: null, start: 0, end: 1 }
    }
  }

  uncork () {
    if (--this.corked === 0) {
      this._sendBatch(this._batch, this._batchState)
      this._batch = null
      this._batchState = null
    }
  }

  pair ({ protocol, id = null }, notify) {
    this._notify.set(toKey(protocol, id), notify)
  }

  unpair ({ protocol, id = null }) {
    this._notify.delete(toKey(protocol, id))
  }

  opened ({ protocol, id = null }) {
    const key = toKey(protocol, id)
    const info = this._infos.get(key)
    return info ? info.opened > 0 : false
  }

  open ({ protocol, id = null, context = null, unique = true, messages = [], onopen = noop, onclose = noop, ondestroy = noop }) {
    if (this.stream.destroyed) return null

    const info = this._get(protocol, id)
    if (unique && info.opened > 0) return null

    if (info.incoming.length === 0) {
      const session = new Session(this, info, protocol, id, context, messages, onopen, onclose, ondestroy)
      session._open()
      info.outgoing.push(session._localId)
      return session
    }

    this._remoteBacklog--

    const remoteId = info.incoming.shift()
    const r = this._remote[remoteId - 1]
    if (r === null) return null

    const session = new Session(this, info, protocol, id, context, messages, onopen, onclose, ondestroy)

    session._remoteId = remoteId
    session._open()
    session._fullyOpenSoon()

    return session
  }

  _pushBatch (localId, buffer) {
    if (this._batch.length === 0 || this._batch[this._batch.length - 1].localId !== localId) {
      this._batchState.end++
      c.uint.preencode(this._batchState, localId)
    }
    c.buffer.preencode(this._batchState, buffer)
    this._batch.push({ localId, buffer })
  }

  _sendBatch (batch, state) {
    if (batch.length === 0) return

    let prev = batch[0].localId

    state.buffer = this._alloc(state.end)
    state.buffer[state.start++] = 0
    state.buffer[state.start++] = 0

    c.uint.encode(state, prev)

    for (let i = 0; i < batch.length; i++) {
      const b = batch[i]
      if (prev !== b.localId) {
        state.buffer[state.start++] = 0
        c.uint.encode(state, (prev = b.localId))
      }
      c.buffer.encode(state, b.buffer)
    }

    this.stream.write(state.buffer)
  }

  _get (protocol, id) {
    const key = toKey(protocol, id)

    let info = this._infos.get(key)
    if (info) return info

    info = { key, protocol, id, pairing: 0, opened: 0, incoming: [], outgoing: [] }
    this._infos.set(key, info)
    return info
  }

  _gc (info) {
    if (info.opened === 0 && info.outgoing.length === 0 && info.incoming.length === 0) {
      this._infos.delete(info.key)
    }
  }

  _ondata (buffer) {
    try {
      const state = { buffer, start: 0, end: buffer.byteLength }
      this._decode(c.uint.decode(state), state)
    } catch (err) {
      this._safeDestroy(err)
    }
  }

  _decode (remoteId, state) {
    const type = c.uint.decode(state)

    if (remoteId === 0) {
      this._oncontrolsession(type, state)
      return
    }

    const r = remoteId <= this._remote.length ? this._remote[remoteId - 1] : null

    // if the channel is closed ignore - could just be a pipeline message...
    if (r === null) return

    if (r.pending !== null) {
      this._bufferMessage(r, type, state)
      return
    }

    r.session._recv(type, state)
  }

  _oncontrolsession (type, state) {
    switch (type) {
      case 0:
        this._onbatch(state)
        break

      case 1:
        this._onopensession(state)
        break

      case 2:
        this._onrejectsession(state)
        break

      case 3:
        this._onclosesession(state)
        break
    }
  }

  _bufferMessage (r, type, { buffer, start, end }) {
    const state = { buffer, start, end } // copy
    r.pending.push({ type, state })
    this._buffered += byteSize(state)
    this._pauseMaybe()
  }

  _pauseMaybe () {
    if (this._paused === true || this._buffered <= MAX_BUFFERED) return
    this._paused = true
    this.stream.pause()
  }

  _resumeMaybe () {
    if (this._paused === false || this._buffered > MAX_BUFFERED) return
    this._paused = false
    this.stream.resume()
  }

  _onbatch (state) {
    const end = state.end
    let remoteId = c.uint.decode(state)

    while (state.end > state.start) {
      const len = c.uint.decode(state)
      if (len === 0) {
        remoteId = c.uint.decode(state)
        continue
      }
      state.end = state.start + end
      this._decode(remoteId, state)
      state.end = end
    }
  }

  _onopensession (state) {
    const protocol = c.string.decode(state)
    const id = c.buffer.decode(state)
    const remoteId = c.uint.decode(state)

    // remote tried to open the control session - auto reject for now
    // as we can use as an explicit control protocol declaration if we need to
    if (remoteId === 0) {
      this._rejectSession(0)
      return
    }

    const rid = remoteId - 1
    const info = this._get(protocol, id)

    // allow the remote to grow the ids by one
    if (this._remote.length === rid) {
      this._remote.push(null)
    }

    if (rid >= this._remote.length || this._remote[rid] !== null) {
      throw new Error('Invalid open message')
    }

    if (info.outgoing.length > 0) {
      const localId = info.outgoing.shift()
      const session = this._local[localId - 1]

      if (session === null) { // we already closed the channel - ignore
        this._free.push(localId - 1)
        return
      }

      this._remote[rid] = { pending: null, session: null }

      session._remoteId = remoteId
      session._fullyOpen()
      return
    }

    this._remote[rid] = { pending: [], session: null }

    if (++this._remoteBacklog > MAX_BACKLOG) {
      throw new Error('Remote exceeded backlog')
    }

    info.pairing++
    info.incoming.push(remoteId)

    this._requestSession(protocol, id, info).catch(this._safeDestroyBound)
  }

  _onrejectsession (state) {
    const protocol = c.string.decode(state)
    const id = c.buffer.decode(state)
    const info = this._get(protocol, id)

    if (info.outgoing.length === 0) {
      throw new Error('Invalid reject message')
    }

    const localId = info.outgoing.shift()
    const session = this._local[localId - 1]

    this._free.push(localId - 1)
    if (session !== null) session._close(true)
  }

  _onclosesession (state) {
    const remoteId = c.uint.decode(state)

    if (remoteId === 0) return // ignore

    const rid = remoteId - 1
    const r = rid < this._remote.length ? this._remote[rid] : null

    if (r === null) return

    if (r.session !== null) r.session._close(true)
  }

  async _requestSession (protocol, id, info) {
    const notify = this._notify.get(toKey(protocol, id)) || this._notify.get(toKey(protocol, null))

    if (notify) await notify(id)

    if (--info.pairing > 0) return

    while (info.incoming.length > 0) {
      this._rejectSession(info, info.incoming.pop())
    }

    this._gc(info)
  }

  _rejectSession (info, remoteId) {
    if (remoteId > 0) {
      const r = this._remote[remoteId - 1]

      if (r.pending !== null) {
        for (let i = 0; i < r.pending.length; i++) {
          this._buffered -= byteSize(r.pending[i].state)
        }
      }

      this._remote[remoteId - 1] = null
      this._resumeMaybe()
    }

    const state = { buffer: null, start: 2, end: 2 }

    c.string.preencode(state, info.protocol)
    c.buffer.preencode(state, info.id)

    state.buffer = this._alloc(state.end)

    state.buffer[0] = 0
    state.buffer[1] = 2
    c.string.encode(state, info.protocol)
    c.buffer.encode(state, info.id)

    this._write0(state.buffer)
  }

  _write0 (buffer) {
    if (this._batch !== null) {
      this._pushBatch(0, buffer.subarray(1))
      return
    }

    this.stream.write(buffer)
  }

  _safeDestroy (err) {
    safetyCatch(err)
    this.stream.destroy(err)
  }

  _shutdown () {
    for (const s of this._local) {
      if (s !== null) s._close(true)
    }
  }
}

function noop () {}

function toKey (protocol, id) {
  return protocol + '##' + (id ? b4a.toString(id, 'hex') : '')
}

function byteSize (state) {
  return 512 + (state.end - state.start)
}

function isPromise (p) {
  return !!(p && typeof p.then === 'function')
}

function encodingLength (enc, val) {
  const state = { buffer: null, start: 0, end: 0 }
  enc.preencode(state, val)
  return state.end
}
