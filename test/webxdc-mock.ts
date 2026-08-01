// A stand-in for the `window.webxdc` object the messenger injects, for the
// tests that exercise host-facing paths: self-registration across reopens, the
// summary y-webxdc actually sends to the chat, and the feature detection around
// sendToChat/importFiles (which must hide a button, not ship an inert one).
//
// Deliberately not a messenger: it records what the app sends, it does not
// route it anywhere. Peer-to-peer traffic is simulated with createDoc() plus
// Y.encodeStateAsUpdateV2 — see convergence.test.ts.
//
// `src/state/doc.ts` reads window.webxdc once, at module load, so installing
// this after importing it has no effect: install first, then `await import()`
// behind a `vi.resetModules()` (see host.test.tsx).

import type { ReceivedStatusUpdate, SendingStatusUpdate } from "@webxdc/types";

type Payload = Record<string, unknown>;

/** The subset of `sendToChat`'s argument this app uses. */
export interface ChatMessage {
  file?: { name: string; plainText?: string };
  text?: string;
}

export interface MockWebxdc {
  selfAddr: string;
  selfName: string;
  /** every update handed to sendUpdate(), oldest first */
  sent: SendingStatusUpdate<Payload>[];
  /** every message sendToChat() was asked to post */
  chat: ChatMessage[];
  /** what the next importFiles() call resolves to */
  files: File[];
  setUpdateListener(
    cb: (update: ReceivedStatusUpdate<Payload>) => void,
  ): Promise<void>;
  sendUpdate(update: SendingStatusUpdate<Payload>, description: ""): void;
  getAllUpdates(): Promise<ReceivedStatusUpdate<Payload>[]>;
  /** absent when the host is too old for it (see MockOptions) */
  sendToChat?(message: ChatMessage): Promise<void>;
  importFiles?(filter: unknown): Promise<File[]>;
}

export interface MockOptions {
  selfAddr?: string;
  selfName?: string;
  /** false = omit the method entirely, like hosts that predate the API. */
  sendToChat?: boolean;
  importFiles?: boolean;
  files?: File[];
}

function createWebxdcMock(o: MockOptions = {}): MockWebxdc {
  const host: MockWebxdc = {
    selfAddr: o.selfAddr ?? "self@x.de",
    selfName: o.selfName ?? "Self",
    sent: [],
    chat: [],
    files: o.files ?? [],
    setUpdateListener: () => Promise.resolve(),
    sendUpdate: (update) => {
      host.sent.push(update);
    },
    getAllUpdates: () => Promise.resolve([]),
  };
  if (o.sendToChat !== false) {
    host.sendToChat = (message) => {
      host.chat.push(message);
      return Promise.resolve();
    };
  }
  if (o.importFiles !== false) {
    host.importFiles = () => Promise.resolve(host.files);
  }
  return host;
}

type WebxdcWindow = { webxdc?: unknown };

/** Install as `window.webxdc`. Must run before the module under test loads. */
export function installWebxdc(o: MockOptions = {}): MockWebxdc {
  const host = createWebxdcMock(o);
  (window as unknown as WebxdcWindow).webxdc = host;
  return host;
}

export function uninstallWebxdc(): void {
  delete (window as unknown as WebxdcWindow).webxdc;
}

/** A file as importFiles() hands it over — name and content are independent. */
export function jsonFile(name: string, body: unknown): File {
  return new File([JSON.stringify(body)], name, { type: "application/json" });
}
