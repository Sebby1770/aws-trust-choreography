/**
 * Cloudflare Worker entry point used by OpenAI Sites.
 *
 * Trust Choreography is a client-side application, so every request is served
 * by the platform's static asset binding. Application state and deep links use
 * the URL hash and do not require a server-side router.
 */

export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
