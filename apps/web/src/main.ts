import { contrastRatio, relativeLuminance } from '@carto-a11y/core';

/** Smoke test that the engine is wired into the UI bundle. */
function describeEngine(): string {
  const ratio = contrastRatio(
    relativeLuminance(0, 0, 0),
    relativeLuminance(1, 1, 1),
  );
  return `engine ready — black on white is ${ratio.toFixed(0)}:1`;
}

const status = document.querySelector<HTMLParagraphElement>('#status');
if (status !== null) {
  status.textContent = describeEngine();
}
