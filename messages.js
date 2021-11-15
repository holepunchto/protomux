const c = require('compact-encoding')

const version = {
  preencode (state, v) {
    c.uint.preencode(state, v.major)
    c.uint.preencode(state, v.minor)
  },
  encode (state, v) {
    c.uint.encode(state, v.major)
    c.uint.encode(state, v.minor)
  },
  decode (state, v) {
    return {
      major: c.uint.decode(state),
      minor: c.uint.decode(state)
    }
  }
}

const protocol = {
  preencode (state, p) {
    c.string.preencode(state, p.name)
    version.preencode(state, p.version)
    c.uint.preencode(state, p.messages)
  },
  encode (state, p) {
    c.string.encode(state, p.name)
    version.encode(state, p.version)
    c.uint.encode(state, p.messages)
  },
  decode (state, p) {
    return {
      name: c.string.decode(state),
      version: version.decode(state),
      messages: c.uint.decode(state)
    }
  }
}

const protocolArray = c.array(protocol)

exports.handshake = {
  preencode (state, h) {
    state.end++ // reversed flags
    protocolArray.preencode(state, h.protocols)
  },
  encode (state, h) {
    state.buffer[state.start++] = 0 // reversed flags
    protocolArray.encode(state, h.protocols)
  },
  decode (state) {
    c.uint.decode(state) // not using any flags for now
    return {
      protocols: protocolArray.decode(state)
    }
  }
}
