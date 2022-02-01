# protomux

Multiplex multiple message oriented protocols over a stream

```
npm install protomux
```

## Usage

``` js
const Protomux = require('protomux')
const c = require('compact-encoding')

// By framed stream, it has be a stream that preserves the messages, ie something that length prefixes
// like @hyperswarm/secret-stream

const mux = new Protomux(aStreamThatFrames)

// Now add some protocols

const cool = mux.addProtocol({
  name: 'cool-protocol',
  version: {
    major: 1,
    minor: 0
  },
  messages: 2, // protocol has 2 messages
  onremoteopen () {
    console.log('the other side opened this protocol!')
  },
  onremoteclose () {
    console.log('the other side closed this protocol!')
  }
})

// And add some messages

const one = cool.addMessage({
  type: 0,
  encoding: c.string,
  onmessage (m) {
    console.log('recv message (1)', m)
  }
})

const two = cool.addMessage({
  type: 1,
  encoding: c.bool,
  onmessage (m) {
    console.log('recv message (2)', m)
  }
})

// And send some data

one.send('a string')
two.send(true)
```

## API

#### `mux = new Protomux(stream, [options])`

Make a new instance. `stream` should be a framed stream, preserving the messages written.

Options include:

``` js
{
  // Called when the muxer wants to allocate a message that is written, defaults to Buffer.allocUnsafe.
  alloc (size) {},
  // Hook that is called when an unknown protocol is received. Should return true/false.
  async onacceptprotocol ({ name, version }) {}
  // How many protocols can be remote open, that we haven't opened yet?
  // Only used if you don't provide an accept hook.
  backlog: 128
}
```

#### `mux = Protomux.from(stream | muxer, [options])`

Helper to accept either an existing muxer instance or a stream (which creates a new one).

#### `const p = mux.addProtocol(opts)`

Add a new protocol.

Options include:

``` js
{
  // Used to match the protocol
  name: 'name of the protocol',
  // You can have multiple versions of the same protocol on the same stream.
  // Protocols are matched using the major version only.
  version: {
    major: 0,
    minor: 0
  },
  // Number of messages types you want to send/receive.
  messages: 2,
  // Called when the remote side adds this protocol.
  // Errors here are caught and forwared to stream.destroy
  async onremoteopen () {},
  // Called when the remote side closes or rejects this protocol.
  // Errors here are caught and forwared to stream.destroy
  async onremoteclose () {}
}
```

Each of the functions can also be set directly on the instance with the same name.

#### `const m = p.addMessage(opts)`

Specify a message. Options include:

``` js
{
  // Defaults to an incrementing number
  type: numericIndex,
  // compact-encoding specifying how to encode/decode this message
  encoding: c.binary,
  // Called when the remote side sends a message.
  // Errors here are caught and forwared to stream.destroy
  async onmessage (message) { }
}
```

#### `m.send(data)`

Send a message.

#### `m.onmessage`

Function that is called when a message arrives.

#### `m.encoding`

The encoding for this message.

#### `p.close()`

Closes the protocol.

#### `p.cork()`

Corking the protocol, makes it buffer messages and send them all in a batch when it uncorks.

#### `p.uncork()`

Uncork and send the batch.

#### `mux.cork()`

Same as `p.cork` but on the muxer instance.

#### `mux.uncork()`

Same as `p.uncork` but on the muxer instance.

## License

MIT
