export type NewChatDraftSlot = {
  save: (text: string) => Promise<void>;
  /** Clears the slot only while it still holds `expected`. */
  clearIf: (expected: string) => Promise<void>;
};

function joinDraft(sent: string | null, input: string) {
  return [sent, input].filter((part): part is string => Boolean(part?.trim())).join("\n\n");
}

/**
 * The Space's new-Chat draft slot while a first message is starting a Chat. Until the server accepts
 * it, the slot holds the sent text (plus anything typed since), so a process killed mid-send keeps
 * the words; nothing is resent. Acceptance clears only what this screen wrote.
 */
export function createNewChatDraft(slot: NewChatDraftSlot) {
  let sent: string | null = null;
  let typed = "";
  let written: string | null = null;
  let closed = false;
  const write = (text: string) => {
    if (closed) return;
    written = text;
    void slot.save(text).catch(() => undefined);
  };
  return {
    /** The debounced autosave and the unmount save; an emptied composer never erases a send in progress. */
    persist(input: string) {
      typed = input;
      write(joinDraft(sent, input));
    },
    send(text: string, input: string) {
      sent = text;
      typed = input;
      write(joinDraft(sent, input));
    },
    /** The send failed or its bubble was deleted; its text no longer needs keeping here. */
    discard(input: string) {
      sent = null;
      typed = input;
      write(joinDraft(null, input));
    },
    /**
     * The Chat exists. On screen, the composer carries what was typed into that Chat's draft;
     * after the screen closed, what was typed during the send stays here.
     */
    accepted(screenClosed: boolean) {
      if (closed) return;
      closed = true;
      sent = null;
      if (screenClosed && typed.trim()) void slot.save(typed).catch(() => undefined);
      else if (written !== null) void slot.clearIf(written).catch(() => undefined);
    },
    get closed() {
      return closed;
    },
  };
}

export type NewChatDraft = ReturnType<typeof createNewChatDraft>;
