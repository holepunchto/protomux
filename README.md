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
  // an array of compact encoders, each encoding/decoding the messages sent
  messages: [
    c.string,
    c.bool
  ],
  onremoteopen () {
    console.log('the other side opened this protocol!')
  },
  onemoteclose () {
    console.log('the other side closed this protocol!')
  },
  onmessage (type, message) {
    console.log('the other side sent a message', type, message)
  }
})

// And send some messages

cool.send(0, 'a string')
cool.send(1, true)
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
  // Array of the message types you want to send/receive. Should be compact-encoders
  messages: [
    ...
  ],
  // Called when the remote side adds this protocol.
  // Errors here are caught and forwared to stream.destroy
  async onremoteopen () {},
  // Called when the remote side closes or rejects this protocol.
  // Errors here are caught and forwared to stream.destroy
  async onremoteclose () {},
  // Called when the remote sends a message
  // Errors here are caught and forwared to stream.destroy
  async onmessage (type, message) {}
}
```

Each of the functions can also be set directly on the instance with the same name.

#### `p.close()`

Closes the protocol

#### `p.send(type, message)`

Send a message, type is the offset into the messages array.

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
