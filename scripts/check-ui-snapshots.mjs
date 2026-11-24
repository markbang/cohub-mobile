import assert from "node:assert/strict";
import { buildFlow, SCREENS } from "./ui-snapshots.mjs";

// iOS asks "Open in Cohub?" once per simulator, on the flow's first link, and the question can arrive after the
// link returns. The first link waits for the question or the screen, answers the question, then waits for the screen.
const [first, second] = SCREENS;
const flow = (platform, screens) => buildFlow({ platform, session: true, screens, target: "phone", orientation: "portrait" });
const ios = flow("ios", [first, second]);
const firstLink = ios.indexOf(`- openLink: ${JSON.stringify(first.link)}`);
const secondLink = ios.indexOf(`- openLink: ${JSON.stringify(second.link)}`);
const firstBlock = ios.slice(firstLink, secondLink);
const wait = firstBlock.indexOf(`visible: ${JSON.stringify(`(Open in .*Cohub.*\\?|.*${first.ready}.*)`)}`);
const answer = firstBlock.indexOf("tapOn: \"^Open$\"");
assert.ok(wait > 0 && answer > wait, "the first link waits for the question or the screen, then answers the question");
assert.ok(!ios.slice(secondLink).includes("Open in .*Cohub"), "later links do not check for the question");
assert.ok(!flow("android", [first]).includes("(Open in"), "Android does not wait for the question");
