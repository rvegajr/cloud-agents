/**
 * cloud-agents on Railway, as code. Replaces railway.json (Config as Code is read only until
 * 2026-12-01). Two Slack bots run the same code from this repo, deployed with `npm run deploy`
 * (`railway up`): `slack` (CloudAgents workspace, heartbeat receiver) and `slack-whm`.
 *
 * Every variable is preserve(): values stay in Railway and never enter source.
 * Restart policy is Railway's default (ON_FAILURE, 10 retries), so it is not declared.
 *
 *   railway config plan     # review (node >= 22.6 on PATH)
 *   railway config apply    # only after review
 */
import { defineRailway, preserve, project, service } from "railway/iac";

// Install the Jam CLI on first boot (the bot fetches jam.dev recordings), then start the bot.
const START =
  "export PATH=\"$HOME/.local/bin:$PATH\"; command -v jam >/dev/null 2>&1 || curl -fsSL https://native.jam.dev/install | bash; export PATH=\"$HOME/.local/bin:$PATH\"; npm run slack";

export default defineRailway(() => {
  const slack = service("slack", {
    build: { builder: "RAILPACK", buildEnvironment: "V3" },
    start: START,
    replicas: { "us-east4-eqdc4a": 1 },
    env: {
      BUILD_INFO: preserve(),
      CURSOR_API_KEY: preserve(),
      CURSOR_MODEL: preserve(),
      GITHUB_TOKEN: preserve(),
      HEARTBEAT_ALERT_TO: preserve(),
      HEARTBEAT_TOKEN: preserve(),
      JAM_TOKEN: preserve(),
      JOBS_API_TOKEN: preserve(),
      NOCTUSOFT_API_KEY: preserve(),
      SLACK_ALLOWED_CHANNELS: preserve(),
      SLACK_APP_TOKEN: preserve(),
      SLACK_BOT_TOKEN: preserve(),
      SLACK_CHANNEL_REPOS: preserve(),
      SLACK_DRIVER_BOT_IDS: preserve(),
      SLACK_DRIVER_TOKEN: preserve(),
      SLACK_MAX_CONCURRENT: preserve(),
      SLACK_PROJECTS: preserve(),
      TARGET_REF: preserve(),
      TARGET_REPO: preserve(),
    },
  });

  const slackWhm = service("slack-whm", {
    build: { builder: "RAILPACK", buildEnvironment: "V3" },
    start: START,
    replicas: { "us-east4-eqdc4a": 1 },
    env: {
      BUILD_INFO: preserve(),
      CURSOR_API_KEY: preserve(),
      CURSOR_MODEL: preserve(),
      DECIDER: preserve(),
      ENGINE: preserve(),
      GITHUB_TOKEN: preserve(),
      JAM_TOKEN: preserve(),
      JOBS_API_TOKEN: preserve(),
      SLACK_ALLOWED_CHANNELS: preserve(),
      SLACK_APP_TOKEN: preserve(),
      SLACK_BOT_TOKEN: preserve(),
      SLACK_CHANNEL_REPOS: preserve(),
      SLACK_MAX_CONCURRENT: preserve(),
      SLACK_PROJECTS: preserve(),
      TARGET_REF: preserve(),
      TARGET_REPO: preserve(),
      TYPESAFE_API_KEY: preserve(),
    },
  });

  return project("cloud-agents", {
    resources: [slack, slackWhm],
  });
});
