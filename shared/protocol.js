import { GAME_VERSION } from './constants.js';

export const PROTOCOL_VERSION = 1;

export const MSG = Object.freeze({
  HELLO: 'hello',
  WELCOME: 'welcome',
  ERROR: 'error',

  SET_NAME: 'set_name',

  QUEUE_JOIN: 'queue_join',
  QUEUE_STATE: 'queue_state',

  LOBBY_CREATE: 'lobby_create',
  LOBBY_JOIN: 'lobby_join',
  LOBBY_LEAVE: 'lobby_leave',
  LOBBY_STATE: 'lobby_state',
  LOBBY_READY: 'lobby_ready',
  LOBBY_CHAT: 'lobby_chat',
  LOBBY_SETTINGS: 'lobby_settings',
  LOBBY_START: 'lobby_start',

  MATCH_START: 'match_start',
  MATCH_END: 'match_end',

  INPUT: 'input',
  SNAPSHOT: 'snapshot',
  EVENT: 'event',
  TAUNT: 'taunt',
});

// Built-in taunt messages
export const TAUNTS = [
  "Come get some!",
  "Is that all you've got?",
  "Too slow!",
  "Boom!",
  "Watch out!",
  "Nice try!",
  "You're going down!",
  "Catch this!",
];

export function makeServerHello() {
  return { protocol: PROTOCOL_VERSION, version: GAME_VERSION };
}

export function safeParseJson(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === 'object') return { ok: true, value: obj };
    return { ok: false, error: 'Invalid JSON message' };
  } catch {
    return { ok: false, error: 'Invalid JSON message' };
  }
}
