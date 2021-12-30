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

exports.addProtocol = {
  preencode (state, p) {
    c.string.preencode(state, p.name)
    version.preencode(state, p.version)
    c.uint.preencode(state, p.offset)
    c.uint.preencode(state, p.length)
  },
  encode (state, p) {
    c.string.encode(state, p.name)
    version.encode(state, p.version)
    c.uint.encode(state, p.offset)
    c.uint.encode(state, p.length)
  },
  decode (state, p) {
    return {
      name: c.string.decode(state),
      version: version.decode(state),
      offset: c.uint.decode(state),
      length: c.uint.decode(state)
    }
  }
}
