// Type declarations for the holepunchto/protomux public API.
/// <reference types="node" />

/**
 * Options for allocating buffers in a Protomux instance.
 */
export interface ProtomuxOptions {
  /** Custom allocator; called with `(size)` and must return a `Buffer`. Defaults to `Buffer.allocUnsafe`. */
  alloc?: Function
}

/**
 * Options for creating a protocol channel.
 */
export interface CreateChannelOptions {
  /** Protocol name used to match channels between peers. */
  protocol: string
  /** Optional binary identifier to distinguish multiple channels with the same protocol name. */
  id?: Buffer | null
  /** Compact-encoding codec for encoding/decoding the handshake value exchanged on open. */
  handshake?: any
  /** Array of message descriptors registered on channel open. */
  messages?: Array<AddMessageOptions>
  /** When `true`, returns `null` if a channel with this protocol+id is already open. */
  unique?: boolean
  /** Alternative protocol names that also match this channel. */
  aliases?: Array<string>
  /** Arbitrary value stored as `channel.userData`; not transmitted. */
  userData?: any
  /** Called with `(handshake, channel)` when the remote side opens this protocol. */
  onopen?: Function
  /** Called with `(isRemote, channel)` when either side closes the channel. */
  onclose?: Function
  /** Called with `(channel)` after `onclose` resolves and all pending promises settle. */
  ondestroy?: Function
  /** Called with `(channel)` when the underlying stream drains. */
  ondrain?: Function
}

/**
 * Options for registering a message type on a channel.
 */
export interface AddMessageOptions {
  /** A compact-encoding codec. Defaults to raw binary (`c.raw`). */
  encoding?: object
  /** When `true`, batch replies are collected before the next tick. */
  autoBatch?: boolean
  /** Called with `(message, channel)` when the remote sends a message of this type. */
  onmessage?: Function
}

/**
 * Protocol + id selector used by pair/unpair/opened/getLastChannel.
 */
export interface ChannelKey {
  /** Protocol name to match. */
  protocol: string
  /** Optional binary id to narrow the match. */
  id?: Buffer | null
}

export class Protomux {
  /**
   * Make a new instance. `stream` should be a framed stream, preserving the messages written.
   * @param stream - `stream` should be a framed stream, preserving the messages written.
   * @param options - Optional configuration for the instance, such as a custom buffer allocator.
   */
  constructor(stream: object, options?: ProtomuxOptions)

  /**
   * Helper to accept either an existing muxer instance or a stream (which creates a new one).
   * @param stream - A framed stream or an existing Protomux instance.
   * @param opts - Muxer options passed through when a new instance is created.
   * @returns The existing or newly created Protomux instance.
   */
  static from(stream: object, opts?: ProtomuxOptions): Protomux

  /**
   * Returns `true` if `mux` is a Protomux instance.
   * @param mux - Value to test.
   * @returns `true` when `mux` is a Protomux instance.
   */
  static isProtomux(mux: object): boolean

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
   * Return the most recently opened channel for the given protocol and optional binary id, or `null` if none is open.
   * @param options - Protocol name and optional binary id.
   * @returns The most recently opened matching channel, or `null`.
   */
  getLastChannel(options: ChannelKey): Channel | null

  /**
   * Register a callback to be called everytime a new channel is requested.
   * @param options - Protocol name and optional binary id to match.
   * @param notify - Async callback called with the channel's binary id when a matching remote channel opens.
   */
  pair(options: ChannelKey, notify: Function): void

  /**
   * Unregisters the pair callback.
   * @param options - Protocol name and optional binary id to deregister.
   */
  unpair(options: ChannelKey): void

  /**
   * Boolean that indicates if the channel is opened.
   * @param options - Protocol name and optional binary id to check.
   * @returns `true` when one or more matching channels are open.
   */
  opened(options: ChannelKey): boolean

  /**
   * Add a new protocol channel.
   * @param options - Channel creation options.
   * @returns The new channel, or `null` if it cannot be opened.
   */
  createChannel(options: CreateChannelOptions): Channel | null

  /**
   * Destroy the muxer and its underlying stream.
   * @param err - Optional error to forward to the stream's `destroy` call.
   */
  destroy(err: Error): void

  isProtomux: any

  /**
   * The underlying framed stream.
   */
  stream: object

  /**
   * Current cork depth; non-zero while the muxer is corked.
   */
  corked: number

  /**
   * `true` when the underlying stream's write buffer is empty.
   */
  drained: boolean
}

declare class Channel {
  constructor(
    mux: any,
    info: any,
    userData: any,
    protocol: any,
    aliases: any,
    id: any,
    handshake: any,
    messages: any,
    onopen: any,
    onclose: any,
    ondestroy: any,
    ondrain: any
  )

  /**
   * `true` when the underlying stream's write buffer is empty.
   */
  readonly drained: boolean

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
  open(handshake?: any): void

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
  addMessage(opts: AddMessageOptions): Message

  userData: any

  protocol: any

  aliases: any

  id: any

  handshake: any

  messages: any

  opened: any

  closed: any

  destroyed: any

  onopen: any

  onclose: any

  ondestroy: any

  ondrain: any
}

declare class Message {
  /**
   * Send a message.
   */
  send(data: any): any

  /**
   * Function that is called when a message arrives.
   */
  onmessage: any

  /**
   * The encoding for this message.
   */
  encoding: any
}

export default Protomux
