/**
 * Animated Content — a dependency-free vanilla port of React Bits'
 * "AnimatedContent" (https://reactbits.dev/animations/animated-content).
 *
 * React Bits ships a React + GSAP component; this app is buildless vanilla, so
 * the same behaviour is reproduced with IntersectionObserver + CSS transitions:
 * any element marked `data-animate` (up | down | left | right | scale) reveals
 * from a directional slide + fade (+ slight scale) as it enters the viewport,
 * with an optional `data-animate-delay` for staggering. Honours
 * `prefers-reduced-motion`, and can never leave content stuck hidden (an inline
 * head-script failsafe plus a try/catch reveal both guarantee visibility).
 */

/**
 * Evenly staggered reveal delays (ms), capped so long lists don't wait forever.
 * @param {number} count
 * @param {number} [base]
 * @param {number} [step]
 * @param {number} [cap]
 * @returns {number[]}
 */
export function staggerDelays(count, base = 0, step = 90, cap = 6) {
  return Array.from({ length: Math.max(0, count) }, (_, i) => base + Math.min(i, cap) * step);
}

export function initAnimatedContent(root = document) {
  const html = document.documentElement;
  const elements = [...root.querySelectorAll("[data-animate]")];
  if (!elements.length) return;

  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Reduced motion or no observer support: show everything immediately.
  if (reduce || typeof IntersectionObserver !== "function") {
    html.classList.remove("ac-ready");
    elements.forEach((el) => el.classList.add("ac-in"));
    return;
  }

  // Signal the head-script failsafe that the reveal engine is live.
  html.classList.add("ac-ready", "ac-live");

  const revealed = new WeakSet();
  const reveal = (el) => {
    if (revealed.has(el)) return;
    revealed.add(el);
    const delay = Number(el.dataset.animateDelay);
    if (Number.isFinite(delay) && delay > 0) el.style.transitionDelay = `${delay}ms`;
    el.classList.add("ac-in");
  };
  const inViewport = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.top < (window.innerHeight || 0) && rect.bottom > 0;
  };

  try {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          reveal(entry.target);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    elements.forEach((el) => {
      // Elements already on screen at load reveal right away (still animated,
      // via the CSS transition) rather than waiting on an observer callback that
      // some engines skip for initially-visible nodes; the rest reveal on scroll.
      if (inViewport(el)) reveal(el);
      else observer.observe(el);
    });
    // Hard safety net: never leave content hidden if the observer never fires.
    window.setTimeout(() => elements.forEach(reveal), 1800);
    // Last-resort: if any element is still visually hidden after transitions
    // should have finished (e.g. a backgrounded tab whose animation clock is
    // frozen), drop the ac-ready gate AND cancel the in-flight transitions
    // inline so the elements snap to fully visible.
    window.setTimeout(() => {
      const stuck = elements.filter((el) => {
        try {
          return Number(getComputedStyle(el).opacity) < 0.9;
        } catch {
          return false;
        }
      });
      if (stuck.length) {
        html.classList.remove("ac-ready");
        stuck.forEach((el) => {
          el.style.transition = "none";
          el.style.opacity = "1";
          el.style.transform = "none";
        });
      }
    }, 3400);
  } catch (error) {
    elements.forEach(reveal);
    console.error("AnimatedContent failed to initialize:", error);
  }
}
