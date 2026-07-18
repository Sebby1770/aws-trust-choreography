/**
 * Spotlight cards — a dependency-free vanilla port of React Bits'
 * "SpotlightCard" (https://reactbits.dev/components/spotlight-card).
 *
 * Elements marked `data-spotlight` get a radial highlight that follows the
 * pointer (via --spot-x/--spot-y custom properties consumed by CSS). A single
 * delegated listener serves every card, including ones added later. No-ops on
 * touch-only devices and under prefers-reduced-motion.
 */

export function initSpotlight(root = document) {
  if (
    typeof window.matchMedia === "function" &&
    (window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.matchMedia("(hover: hover)").matches)
  ) {
    return;
  }

  root.addEventListener("pointermove", (event) => {
    const card = event.target.closest?.("[data-spotlight]");
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    card.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
    card.classList.add("spot-on");
  });

  root.addEventListener(
    "pointerout",
    (event) => {
      const card = event.target.closest?.("[data-spotlight]");
      if (card && !card.contains(event.relatedTarget)) card.classList.remove("spot-on");
    },
    true
  );
}
