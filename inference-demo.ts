// Ignore this file! It is just a demo of type inference, It is absolutely useless otherwise

import c from 'compact-encoding'
import Protomux from './index'

declare const mux: Protomux // we're only demoing types. no actual instantiation

// helpers for type assertion
type Eq<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false
declare function assert<T extends true>(): void

mux.createChannel({
  protocol: 'foo',
  handshake: c.string,
  onopen: (hs) => {
    assert<Eq<typeof hs, string | null>>()
  },
  messages: [
    {
      encoding: c.string,
      onmessage: (message) => {
        assert<Eq<typeof message, string>>() // infers as `string`, was `unknown` before
      }
    },
    {
      encoding: c.uint,
      onmessage: (message) => {
        assert<Eq<typeof message, number>>() // infers as `number`, was `unknown` before
      }
    },
    {
      encoding: c.binary,
      onmessage: (message) => {
        assert<Eq<typeof message, Uint8Array>>() // O of Encoder<string|Uint8Array, Uint8Array>
      }
    },
    null,
    {
      onmessage: (m) => {
        assert<Eq<typeof m, Uint8Array>>() // no encoding -> raw Uint8Array
      }
    }
  ]
})


// Wrong usage raises a TS error:
mux.createChannel({
  protocol: 'foo',
  // @ts-expect-error string handler on an uint encoding
  messages: [{ encoding: c.uint, onmessage: (m: string) => {} }]
})

// addMessage benefits too
declare const channel: Protomux.Channel
const msg = channel.addMessage({
  encoding: c.string,
  onmessage: (m) => { assert<Eq<typeof m, string>>() }
})
msg.send('hi')
