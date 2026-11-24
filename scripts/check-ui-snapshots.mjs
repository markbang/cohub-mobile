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
const ask = firstBlock.indexOf("Open in .*Cohub");
const answer = firstBlock.indexOf("tapOn: \"^Open$\"");
const screenAfter = firstBlock.indexOf(`.*${first.ready}.*`, answer);
assert.ok(ask > 0 && answer > ask && screenAfter > answer, "the first link waits for the question, answers it, then waits for the screen");
assert.equal((firstBlock.match(/timeout: 60000/g) ?? []).length, 2, "the first link's waits allow a cold Metro (60 s)");
assert.ok(!ios.slice(secondLink).includes("Open in .*Cohub"), "later links do not check for the question");
assert.ok(!flow("android", [first]).includes(`"(Open in`), "Android does not wait for the question with the screen");
