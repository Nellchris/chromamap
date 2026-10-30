/**
 * Remediation, off the main thread.
 *
 * `generateAccessiblePalette` buys its quality with trial audits, and an audit
 * is quadratic in the class count: a real geological style of a hundred classes
 * takes the better part of a minute of solid arithmetic. Run on the main thread
 * that would freeze the page, scroll included, long enough to look broken - so
 * it runs here instead, and the audit a reader came for is on screen the whole
 * time.
 *
 * The engine is DOM-free by design, which is what makes this possible at all.
 */

import { generateAccessiblePalette, type MapClass, type RGB } from '@carto-a11y/core';

/** What the page asks for. */
export interface RemediateRequest {
  classes: MapClass[];
  background: RGB;
}

/** What comes back: the new colour for each class, by id. */
export interface RemediateReply {
  palette: Array<{ classId: string; remediated: RGB }>;
}

addEventListener('message', (event: MessageEvent<RemediateRequest>) => {
  const { classes, background } = event.data;
  const palette = generateAccessiblePalette(classes, { background });
  const reply: RemediateReply = {
    palette: palette.map(({ classId, remediated }) => ({ classId, remediated })),
  };
  // `self.postMessage` in a worker takes the message alone; the DOM typings
  // describe the window's four-argument form, hence the narrowing.
  (self as unknown as { postMessage: (message: unknown) => void }).postMessage(reply);
});
