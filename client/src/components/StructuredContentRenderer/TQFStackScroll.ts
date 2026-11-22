/**
 * This file contains the behavior of a stack of TQFs: opening and closing it, its current card, scrolling, folding, and hiding far cards (see TQFStack.tsx and TQFStack.scss).
 *
 * Hovering, tapping, or focusing a stack opens it: its cards fan out, each collapsed to its first line, and only the current card opens in full.
 * The current card is the one under the cursor, where the area of a card reaches down to the next card, or the card that the keyboard focused.
 * Whenever another card becomes current, its top stays where it is on screen and the others open or close around it, so that what is under the cursor never jumps.
 *
 * The wheel (or a swipe) over the cards scrolls them under the cursor, eased like smooth scrolling.
 * It stops when the top of the first card or the bottom of the last one (almost) reaches the cursor.
 * One frame moves the cards by at most MAX_STEP, which is less than any card, so that no card is skipped.
 * Only the cards near the current one stay visible (VISIBLE_ABOVE, VISIBLE_BELOW), with a count of the hidden ones on each side.
 * Over the cards the page never scrolls. Elsewhere, also over the empty part of an open stack that its cards moved away from, it scrolls as usual.
 *
 * With a mouse, the stack closes once the mouse leaves it, unless the focus is inside (after a click or tabbing).
 * With touch, it stays open until a tap outside it or until the focus leaves it.
 *
 * The cards sit in one track, so that a single transform (`translate` on the track) moves them all.
 * While open, the stack keeps its closed height and the track floats above the page, so that the page never moves.
 * A stack inside a card does not float but grows in place, as the card would cut it off.
 * While the stack scrolls or cards open or close, the shift is recomputed every frame from the layout.
 */

import { useEffect, type RefObject } from "react";

/**
 * The number of cards above the current one that stay visible.
 *
 * The others are hidden (keeping their space), so that an open stack does not cover the page.
 */
const VISIBLE_ABOVE = 3;

/**
 * The number of cards below the current one that stay visible.
 */
const VISIBLE_BELOW = 5;

/**
 * The time (ms) that fanning out and collapsing take ($tqf-duration in TQFStack.scss).
 */
const DURATION = 300;

/**
 * The time (ms) after closing during which the cards are still on their way back.
 *
 * This is $tqf-return-delay + $tqf-duration in TQFStack.scss, plus a margin.
 */
const RETURN = 700;

/**
 * The rate (px/s) at which the details of a card fold when it opens or closes inside an open stack.
 *
 * This ensures that a tall card folds more slowly. The resulting duration goes to `--tqf-fold` on the card (see TQFStack.scss).
 */
const FOLD_RATE = 2000;

/**
 * The shortest fold duration (s).
 */
const FOLD_MIN = 0.25;

/**
 * The longest fold duration (s).
 */
const FOLD_MAX = 1.5;

/**
 * The time (ms) to keep following the layout after the last fold has ended.
 */
const SETTLE_MARGIN = 100;

/**
 * The time constant (ms) of the eased wheel scrolling.
 */
const EASE = 60;

/**
 * The largest move (px) of the cards in one frame.
 */
const MAX_STEP = 30;

/**
 * The distance (px) that the first and last card stay past the cursor at the ends.
 *
 * This ensures that the cursor stays on a card, so that the next wheel step does not go to the page.
 */
const END_MARGIN = 8;

/**
 * The wheel and touch events that a stack has handled already, so that the stacks around a nested one ignore them.
 */
const handledEvents = new WeakSet<Event>();

/**
 * Get the vertical distance of a wheel event in pixels.
 * @param event The wheel event.
 * @returns The distance in pixels.
 */
function wheelDelta(event: WheelEvent): number {
  const scale =
    event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
  return event.deltaY * scale;
}

/**
 * Get the card at a vertical position: the last one whose top is above it.
 * @param tops The tops of the cards in their order.
 * @param y The position, in the same coordinates as the tops.
 * @returns The index of the card.
 */
function cardAt(tops: number[], y: number): number {
  let index = 0;
  while (index < tops.length - 1 && tops[index + 1] <= y) index++;
  return index;
}

/**
 * This class implements the behavior of one stack while it is mounted.
 *
 * Its state is kept in fields and data attributes instead of React state, as it changes every frame.
 * The cards are read from the track whenever they are needed, so that cards that are added or removed while the stack is open (e.g. by live edits) take part at once.
 */
class TQFStackScroller {
  /**
   * The stack.
   */
  stack: HTMLElement;

  /**
   * The track that holds the cards of the stack.
   */
  track: HTMLElement;

  /**
   * Whether the stack is open.
   */
  isOpen = false;

  /**
   * The current card. It is tracked as an element, so that it stays current when cards are added or removed above it.
   */
  current: HTMLElement | null = null;

  /**
   * The index of the current card in the last frame, so that the card at its place becomes current if it is removed.
   */
  index = 0;

  /**
   * The top of the current card, relative to the top of the stack.
   */
  anchor = 0;

  /**
   * The scroll distance that is still to go.
   */
  remaining = 0;

  /**
   * Whether the scrolling is eased (wheel) or direct (swipe).
   */
  eased = true;

  /**
   * The vertical cursor (or touch) position in viewport coordinates.
   */
  cursor = 0;

  /**
   * The id of the requested animation frame, or 0 if none is requested.
   */
  frame = 0;

  /**
   * The timestamp of the last frame.
   */
  lastFrame = 0;

  /**
   * The time (ms) until which cards are still opening or closing.
   */
  settleUntil = 0;

  /**
   * The card that the keyboard focused last, or null if the mouse, wheel, or a swipe moved since.
   *
   * This card is current instead of the one under the cursor.
   */
  focused: HTMLElement | null = null;

  /**
   * Whether the stack itself moves the focus to the new current card, so that this does not count as keyboard focus.
   */
  movingFocus = false;

  /**
   * The timer that lets the track land in the page again after closing.
   */
  landTimer = 0;

  /**
   * The vertical position of the last touch, or null if there is no single touch.
   */
  touchY: number | null = null;

  /**
   * The observer that notices cards that are added or removed while the stack is open.
   */
  observer: MutationObserver;

  constructor(stack: HTMLElement, track: HTMLElement) {
    this.stack = stack;
    this.track = track;
    this.observer = new MutationObserver(() => {
      if (this.isOpen) this.animate(true);
    });
    this.observer.observe(track, { childList: true });
    stack.addEventListener("pointerenter", this.onPointerEnter);
    stack.addEventListener("pointermove", this.onPointerMove);
    stack.addEventListener("pointerleave", this.onPointerLeave);
    stack.addEventListener("focusin", this.onFocusIn);
    stack.addEventListener("focusout", this.onFocusOut);
    track.addEventListener("wheel", this.onWheel, { passive: false });
    track.addEventListener("touchstart", this.onTouchStart, { passive: true });
    track.addEventListener("touchmove", this.onTouchMove, { passive: true });
  }

  /**
   * Remove all listeners and restore the stack.
   */
  dispose() {
    this.close();
    this.land();
    this.observer.disconnect();
    this.stack.removeEventListener("pointerenter", this.onPointerEnter);
    this.stack.removeEventListener("pointermove", this.onPointerMove);
    this.stack.removeEventListener("pointerleave", this.onPointerLeave);
    this.stack.removeEventListener("focusin", this.onFocusIn);
    this.stack.removeEventListener("focusout", this.onFocusOut);
    this.track.removeEventListener("wheel", this.onWheel);
    this.track.removeEventListener("touchstart", this.onTouchStart);
    this.track.removeEventListener("touchmove", this.onTouchMove);
  }

  /**
   * Get the cards of the stack.
   * @returns The cards in their order.
   */
  cards(): HTMLElement[] {
    return Array.from(this.track.children) as HTMLElement[];
  }

  /**
   * Open the stack with the card under the cursor current, anchored where it is.
   *
   * Stacks only open in the sidebar and inline, as the OnAsset page turns the container off.
   * @param cursor The vertical cursor position in viewport coordinates.
   */
  open(cursor: number) {
    if (this.isOpen) return;
    const container = this.stack.closest(".node-content-container");
    if (!container || getComputedStyle(container).containerType === "normal") {
      return;
    }
    const cards = this.cards();
    if (cards.length === 0) return;
    const current =
      cards[
        cardAt(
          cards.map((card) => card.getBoundingClientRect().top),
          cursor
        )
      ];

    // While open (and until its cards are back), the stack keeps its closed height and its cards float above the page (see TQFStack.scss), so that the page around it never moves.
    // A stack inside a card grows in place instead, as the card would cut off its floating cards.
    window.clearTimeout(this.landTimer);
    const nested = this.stack.parentElement?.closest(
      ".structured-content__tqf"
    );
    if (!nested && !this.stack.hasAttribute("data-floating")) {
      this.stack.style.height = `${this.stack.getBoundingClientRect().height}px`;
      this.stack.setAttribute("data-floating", "");
    }

    this.isOpen = true;
    this.current = current;
    this.anchor =
      current.getBoundingClientRect().top -
      this.stack.getBoundingClientRect().top;
    this.remaining = 0;
    this.cursor = cursor;
    // The cards fan out over DURATION, and the current one unfolds over its fold duration.
    this.settleUntil =
      performance.now() +
      Math.max(this.fold(current, true), DURATION + SETTLE_MARGIN);
    current.setAttribute("data-tqf-current", "");
    this.hideFar(cards);
    this.stack.setAttribute("data-open", "");
    document.addEventListener("pointerdown", this.onDocumentPointerDown);
    this.animate();
  }

  /**
   * Close the stack. The track lands in the page again once its cards are back.
   */
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const card of this.cards()) {
      card.removeAttribute("data-tqf-current");
      card.style.removeProperty("--tqf-fold");
    }
    this.current = null;
    this.focused = null;
    this.track.style.removeProperty("translate");
    this.stack.removeAttribute("data-open");
    document.removeEventListener("pointerdown", this.onDocumentPointerDown);
    this.landTimer = window.setTimeout(() => this.land(), RETURN);
  }

  /**
   * Let the track land in the page again, unless the stack has opened in the meantime.
   */
  land() {
    window.clearTimeout(this.landTimer);
    if (this.isOpen) return;
    this.stack.removeAttribute("data-floating");
    this.stack.style.removeProperty("height");
    for (const card of this.cards()) {
      card.removeAttribute("data-tqf-hidden");
      card.removeAttribute("data-tqf-more-above");
      card.removeAttribute("data-tqf-more-below");
    }
  }

  /**
   * Set the fold duration of a card that starts opening or closing from the height of its details.
   * @param card The card.
   * @param opening Whether the card opens (and its details are still folded).
   * @returns How long (ms) to keep following the layout.
   */
  fold(card: HTMLElement, opening: boolean): number {
    let distance = 0;
    // The X of a dismissible card does not fold (see TQFStack.scss).
    const details = Array.from(card.children)
      .slice(1)
      .filter((child) => !child.matches(".structured-content__tqf-dismiss"));
    for (const child of details) {
      distance += opening
        ? child.scrollHeight
        : child.getBoundingClientRect().height;
    }
    const duration = Math.min(
      Math.max(distance / FOLD_RATE, FOLD_MIN),
      FOLD_MAX
    );
    card.style.setProperty("--tqf-fold", `${duration}s`);
    return duration * 1000 + SETTLE_MARGIN;
  }

  /**
   * Hide the cards that are far from the current one and set the pills that count them.
   * @param cards The cards of the stack.
   */
  hideFar(cards: HTMLElement[]) {
    const index = this.current ? cards.indexOf(this.current) : 0;
    const first = index - VISIBLE_ABOVE;
    const last = index + VISIBLE_BELOW;
    cards.forEach((card, j) => {
      card.toggleAttribute("data-tqf-hidden", j < first || j > last);
      if (j === first - 1) {
        card.setAttribute("data-tqf-more-above", `↑ ${first} more`);
      } else card.removeAttribute("data-tqf-more-above");
      if (j === last + 1) {
        card.setAttribute(
          "data-tqf-more-below",
          `↓ ${cards.length - 1 - last} more`
        );
      } else card.removeAttribute("data-tqf-more-below");
    });
  }

  /**
   * Request a frame unless one is requested already.
   * @param changed Whether cards were added or removed, so that the hidden cards have to be set again.
   */
  animate(changed = false) {
    if (changed) this.hideFar(this.cards());
    if (this.frame) return;
    this.lastFrame = performance.now();
    this.frame = requestAnimationFrame(this.step);
  }

  /**
   * One frame: move the cards by the next step of the scrolling, keep the top of the current card at its anchor, and make the card under the cursor current, anchored where it is.
   *
   * Positions are relative to the top of the stack. The tops of the cards within the track do not depend on the transform of the track.
   * @param now The timestamp of the frame.
   */
  step = (now: number) => {
    this.frame = 0;
    const cards = this.cards();
    if (!this.isOpen || cards.length === 0) {
      this.close();
      return;
    }
    const last = cards.length - 1;
    // If the current card was removed (e.g. by a live edit), the card at its place becomes current.
    let index = this.current ? cards.indexOf(this.current) : -1;
    if (index < 0) {
      index = Math.min(this.index, last);
      this.current = cards[index];
      this.current.setAttribute("data-tqf-current", "");
      this.hideFar(cards);
    }

    // The timestamp of the first frame can lie before the call that requested it, so the step can come out negative. In that case, we use one frame instead.
    const elapsed = now - this.lastFrame;
    const dt = elapsed > 0 ? Math.min(elapsed, 50) : 16;
    this.lastFrame = now;

    let move = 0;
    if (this.remaining !== 0) {
      move =
        !this.eased || Math.abs(this.remaining) < 0.5
          ? this.remaining
          : this.remaining * (1 - Math.exp(-dt / EASE));
      move = Math.min(Math.max(move, -MAX_STEP), MAX_STEP);
      this.remaining -= move;
    }

    const stackTop = this.stack.getBoundingClientRect().top;
    const trackTop = this.track.getBoundingClientRect().top;
    const rects = cards.map((card) => card.getBoundingClientRect());
    const tops = rects.map((rect) => rect.top - trackTop);
    const bottom = rects[last].bottom - trackTop;
    const cursor = this.cursor - stackTop;

    let shift = this.anchor - move - tops[index];
    if (move !== 0) {
      // The top of the first card does not move below the cursor and the bottom of the last one not above it (each with END_MARGIN to spare).
      const max = cursor - END_MARGIN - tops[0];
      const min = cursor + END_MARGIN - bottom;
      if (shift > max || shift < min) {
        shift = Math.min(Math.max(shift, min), max);
        this.remaining = 0;
      }
    }
    this.anchor = shift + tops[index];
    this.index = index;
    this.track.style.translate = `0 ${shift}px`;

    // The current card is the one that the keyboard focused, or else the one under the cursor. The cursor does not count when it is beside the cards (in the empty part of the stack).
    const focused = this.focused ? cards.indexOf(this.focused) : -1;
    let under = focused;
    if (under < 0) {
      const beside = cursor < tops[0] + shift || cursor > bottom + shift;
      under = beside
        ? index
        : cardAt(
            tops.map((top) => top + shift),
            cursor
          );
    }
    if (under !== index) {
      const next = cards[under];
      const settle = Math.max(
        this.fold(cards[index], false),
        this.fold(next, true)
      );
      cards[index].removeAttribute("data-tqf-current");
      next.setAttribute("data-tqf-current", "");
      this.current = next;
      this.index = under;
      this.anchor = shift + tops[under];
      this.settleUntil = Math.max(this.settleUntil, now + settle);
      this.hideFar(cards);
      // The focus moves along (e.g. after a tap), as a hidden card would lose it.
      if (focused < 0 && this.stack.contains(document.activeElement)) {
        this.movingFocus = true;
        next.focus({ preventScroll: true });
        this.movingFocus = false;
      }
    }

    if (this.remaining !== 0 || now < this.settleUntil) {
      this.frame = requestAnimationFrame(this.step);
    }
  };

  /**
   * Open the stack when the pointer enters it.
   * @param event The pointer event.
   */
  onPointerEnter = (event: PointerEvent) => this.open(event.clientY);

  /**
   * Follow the mouse, so that the card under it becomes current.
   * @param event The pointer event.
   */
  onPointerMove = (event: PointerEvent) => {
    if (!this.isOpen || event.pointerType === "touch") return;
    this.focused = null;
    this.cursor = event.clientY;
    this.animate();
  };

  /**
   * Close the stack when the mouse leaves it, unless the focus is inside. A touch pointer leaves whenever the finger lifts, so taps and the focus decide there.
   * @param event The pointer event.
   */
  onPointerLeave = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    if (!this.stack.contains(document.activeElement)) this.close();
  };

  /**
   * Close the stack on a tap outside it (touch only, as the mouse closes it by leaving).
   * @param event The pointer event.
   */
  onDocumentPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    if (event.target instanceof Node && this.stack.contains(event.target)) {
      return;
    }
    this.close();
  };

  /**
   * Make the focused card current (e.g. when tabbing through the cards), opening the stack if needed.
   * @param event The focus event.
   */
  onFocusIn = (event: FocusEvent) => {
    const card =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(".structured-content__tqf")
        : null;
    if (!card || card.parentElement !== this.track || this.movingFocus) return;
    this.open(card.getBoundingClientRect().top + 1);
    if (!this.isOpen) return;
    this.focused = card;
    this.animate();
  };

  /**
   * Close the stack when the focus leaves it, unless the mouse is inside.
   * @param event The focus event.
   */
  onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && this.stack.contains(next)) return;
    if (!this.stack.matches(":hover")) this.close();
  };

  /**
   * Scroll the cards with the wheel, opening the stack if needed. Over the cards, the wheel never goes to the page, except for zooming (Ctrl) and horizontal scrolling. A nested stack that scrolls keeps the wheel for itself.
   * @param event The wheel event.
   */
  onWheel = (event: WheelEvent) => {
    if (handledEvents.has(event) || event.ctrlKey || event.deltaY === 0) {
      return;
    }
    this.open(event.clientY);
    if (!this.isOpen) return;
    handledEvents.add(event);
    event.preventDefault();
    this.focused = null;
    this.cursor = event.clientY;
    this.eased = true;
    this.remaining += wheelDelta(event);
    this.animate();
  };

  /**
   * Remember where a touch starts and focus the card under it, so that the stack stays open until the focus goes elsewhere.
   * @param event The touch event.
   */
  onTouchStart = (event: TouchEvent) => {
    this.touchY = event.touches.length === 1 ? event.touches[0].clientY : null;
    if (handledEvents.has(event)) return;
    handledEvents.add(event);
    const card =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(".structured-content__tqf")
        : null;
    if (card && card.parentElement === this.track) {
      card.focus({ preventScroll: true });
    }
  };

  /**
   * Scroll the cards with a swipe, opening the stack if needed. The browser does not pan over the cards (`touch-action` in TQFStack.scss).
   * @param event The touch event.
   */
  onTouchMove = (event: TouchEvent) => {
    if (this.touchY === null || event.touches.length !== 1) return;
    const y = event.touches[0].clientY;
    const delta = this.touchY - y;
    this.touchY = y;
    if (handledEvents.has(event)) return;
    this.open(y);
    if (!this.isOpen) return;
    handledEvents.add(event);
    this.focused = null;
    this.cursor = y;
    this.eased = false;
    this.remaining += delta;
    this.animate();
  };
}

/**
 * A hook that makes a TQF stack scrollable while it is mounted (see the top of this file).
 *
 * The behavior is imperative on purpose: it repositions the cards every frame and toggles data attributes that React does not render, so that it never causes a re-render.
 * @param stackRef The ref of the stack.
 * @param trackRef The ref of the track that holds the cards of the stack.
 */
export function useTQFStackScroll(
  stackRef: RefObject<HTMLElement | null>,
  trackRef: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!stackRef.current || !trackRef.current) return;
    const scroller = new TQFStackScroller(stackRef.current, trackRef.current);
    return () => scroller.dispose();
  }, [stackRef, trackRef]);
}
