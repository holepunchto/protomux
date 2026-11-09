import { Duplex } from 'streamx'
import { type Encoder, type State } from 'compact-encoding'

interface Stream extends Duplex {
  userData?: unknown
  alloc?(size: number): Uint8Array
}

/**
 * Options for allocating buffers in a Protomux instance.
 */
interface ProtomuxOptions {
  /** Custom allocator; called with `(size)` and must return a `Buffer`. Defaults to `Buffer.allocUnsafe`. */
  alloc?(size: number): Uint8Array
}

/**
 * Options for creating a protocol channel.
 */
interface ChannelOptions<I = unknown, O = I> {
  /** Protocol name used to match channels between peers. */
  protocol: string
  /** Optional binary identifier to distinguish multiple channels with the same protocol name. */
  id?: Uint8Array | null
  /** Compact-encoding codec for encoding/decoding the handshake value exchanged on open. */
  handshake?: Encoder<I, O> | null
  /** Array of message descriptors registered on channel open. */
  messages?: (MessageOptions<unknown, unknown> | null)[]
  /** When `true`, returns `null` if a channel with this protocol+id is already open. */
  unique?: boolean
  /** Alternative protocol names that also match this channel. */
  aliases?: string[]
  /** Arbitrary value stored as `channel.userData`; not transmitted. */
  userData?: unknown
  /** Called with `(handshake, channel)` when the remote side opens this protocol. */
  onopen?(handshake: O | null, channel: Channel<I, O>): void | Promise<void>
  /** Called with `(isRemote, channel)` when either side closes the channel. */
  onclose?(isRemote: boolean, channel: Channel<I, O>): void | Promise<void>
  /** Called with `(channel)` after `onclose` resolves and all pending promises settle. */
  ondestroy?(channel: Channel<I, O>): void | Promise<void>
  /** Called with `(channel)` when the underlying stream drains. */
  ondrain?(channel: Channel<I, O>): void | Promise<void>
}

/**
 * Options for registering a message type on a channel.
 */
interface MessageOptions<I = Uint8Array, O = I> {
  /** A compact-encoding codec. Defaults to raw binary (`c.raw`). */
  encoding?: Encoder<I, O>
  /** When `true`, batch replies are collected before the next tick. */
  autoBatch?: boolean
  /** Called with `(message, channel)` when the remote sends a message of this type. */
  onmessage?(message: O, channel: Channel): void | Promise<void>
}

/**
 * Protocol + id selector used by pair/unpair/opened/getLastChannel.
 */
interface ChannelKey {
  /** Protocol name to match. */
  protocol: string
  /** Optional binary id to narrow the match. */
  id?: Uint8Array | null
}

interface Protomux extends Iterable<Channel> {
  readonly isProtomux: true
  /**
   * The underlying framed stream.
   */
  readonly stream: Stream
  /**
   * Current cork depth; non-zero while the muxer is corked.
   */
  readonly corked: number

  /**
   * `true` when the underlying stream's write buffer is empty.
   */
  drained: boolean

  /**
   * Convenience method that returns true if the number of channels is currently 0.
   * @returns `true` if the channel count is currently zero.
   */
  isIdle(): boolean

  /**
   * Same as `channel.cork` but on the muxer instance.
   */
  cork(): void
  /**
   * Same as `channel.uncork` but on the muxer instance.
   */
  uncork(): void

  /**
   * Boolean that indicates if the channel is opened.
   * @param options - Protocol name and optional binary id to check.
   * @returns `true` when one or more matching channels are open.
   */
  opened(key: ChannelKey): boolean

  /**
   * Add a new protocol channel.
   * @param options - Channel creation options.
   * @returns The new channel, or `null` if it cannot be opened.
   */
  createChannel<I = unknown, O = I>(opts: ChannelOptions<I, O>): Channel<I, O> | null
  /**
   * Return the most recently opened channel for the given protocol and optional binary id, or `null` if none is open.
   * @param options - Protocol name and optional binary id.
   * @returns The most recently opened matching channel, or `null`.
   */
  getLastChannel(key: ChannelKey): Channel | null

  /**
   * Register a callback to be called everytime a new channel is requested.
   * @param options - Protocol name and optional binary id to match.
   * @param notify - Async callback called with the channel's binary id when a matching remote channel opens.
   */
  pair(key: ChannelKey, notify: (id: Uint8Array | null) => void | Promise<void>): void
  /**
   * Unregisters the pair callback.
   * @param options - Protocol name and optional binary id to deregister.
   */
  unpair(key: ChannelKey): void

  /**
   * Destroy the muxer and its underlying stream.
   * @param err - Optional error to forward to the stream's `destroy` call.
   */
  destroy(err?: Error | null): void
}

declare class Protomux {
  /**
   * Make a new instance. `stream` should be a framed stream, preserving the messages written.
   * @param stream - `stream` should be a framed stream, preserving the messages written.
   * @param options - Optional configuration for the instance, such as a custom buffer allocator.
   */
  constructor(stream: Stream, opts?: ProtomuxOptions)
}

interface Channel<I = unknown, O = I> {
  readonly protocol: string
  readonly aliases: string[]
  readonly id: Uint8Array | null
  readonly handshake: O | null
  readonly messages: Message<unknown, unknown>[]

  /**
   * `true` when the underlying stream's write buffer is empty.
   */
  readonly drained: boolean
  readonly opened: boolean
  readonly closed: boolean
  readonly destroyed: boolean

  userData: unknown

  /**
   * Resolves to `true` when the channel is fully open (both sides have exchanged open frames),
or `false` if it closes before opening.
   */
  fullyOpened(): Promise<boolean>

  /**
   * Resolves when the channel has been fully destroyed (after `ondestroy` settles).
   */
  fullyClosed(): Promise<void>

  /**
   * Open the channel.
   * @param handshake - Optional handshake value encoded with the handshake encoding provided to `createChannel`.
   */
  open(handshake?: I): void

  /**
   * Corking the protocol channel, makes it buffer messages and send them all in a batch when it uncorks.
   */
  cork(): void
  /**
   * Uncork and send the batch.
   */
  uncork(): void

  /**
   * Closes the protocol channel.
   */
  close(): void

  /**
   * Add/register a message type for a certain encoding. Options include:
   * @param opts - Message options including encoding and onmessage handler.
   * @returns Message object with a `send(data)` method for sending encoded messages.
   */
  addMessage<MI = Uint8Array, MO = MI>(opts?: MessageOptions<MI, MO> | null): Message<MI, MO>

  onopen(handshake: O | null, channel: Channel<I, O>): void | Promise<void>
  onclose(isRemote: boolean, channel: Channel<I, O>): void | Promise<void>
  ondestroy(channel: Channel<I, O>): void | Promise<void>
  ondrain(channel: Channel<I, O>): void | Promise<void>
}

interface Message<I = Uint8Array, O = I> {
  readonly type: number
  readonly autoBatch: boolean
  /**
   * The encoding for this message.
   */
  readonly encoding: Encoder<I, O>

  /**
   * Function that is called when a message arrives.
   */
  onmessage(message: O, channel: Channel): void | Promise<void>

  /**
   * Send a message.
   */
  send(message: I, channel?: Channel): boolean
  recv(state: State, channel: Channel): Promise<void> | null
}

declare namespace Protomux {
  /**
   * Helper to accept either an existing muxer instance or a stream (which creates a new one).
   * @param stream - A framed stream or an existing Protomux instance.
   * @param opts - Muxer options passed through when a new instance is created.
   * @returns The existing or newly created Protomux instance.
   */
  export function from(stream: Stream | Protomux, opts?: ProtomuxOptions): Protomux

  /**
   * Returns `true` if `mux` is a Protomux instance.
   * @param mux - Value to test.
   * @returns `true` when `mux` is a Protomux instance.
   */
  export function isProtomux(mux: unknown): mux is Protomux

  export {
    type Stream,
    type ProtomuxOptions,
    type ChannelKey,
    type Channel,
    type ChannelOptions,
    type Message,
    type MessageOptions
  }
}

export = Protomux
