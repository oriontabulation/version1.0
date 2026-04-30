import { checkUrlForJudgeToken, renderJudgePortal } from './portal.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize portal flow: validate token if present, then render portal UI
  try {
    await checkUrlForJudgeToken();
  } catch (e) {
    // Fallback to rendering portal even if token check fails
  }
  renderJudgePortal();
});
