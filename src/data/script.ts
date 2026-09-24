/*
 * The example episode script, long enough to rehearse and test a real
 * session with. It uses the import format: "## Heading" starts a section,
 * "NAME:" switches speaker. The first lines match the design mockups.
 */
import { parseScript } from '@/lib/script-parser';

export const defaultScriptText = `## Cold open
TYLER: It was a quiet week in the studio, until the new transmitter arrived.
SAM: Four pallets? I heard it was five, and one of them was just foam.
TYLER: Four. I counted. So this episode is about what happens after the crate is open.
SAM: Power, cooling, and the first time we keyed it up.
DANA: And whether the floor could hold it, which, for the record, nobody checked until I asked.

## Segment 1 · Install
TYLER: We measured it twice. The spec sheet and the building plans did not agree.
SAM: Which is when the real trouble starts.
TYLER: The spec sheet said the cabinet weighs just under nine hundred pounds, fully loaded.
DANA: The building plans rated that corner of the room for about half of that.
SAM: So we had a transmitter, a forklift, and a floor we didn't trust.
TYLER: We got the structural drawings out, and honestly, that took most of a morning.
DANA: The fix was a steel spreader plate under the rack, bolted through to the slab.
SAM: Which meant drilling concrete in a room full of equipment that hates dust.
TYLER: Plastic sheeting, two shop vacs, and a lot of patience.
DANA: Then there was the question of where the heat was going to go.
SAM: The old transmitter ran warm. This one runs hot, and it runs hot all the time.
TYLER: We added a dedicated exhaust duct and a second mini split, just for that corner.
DANA: And a temperature alarm that texts all three of us, whether we like it or not.

## Segment 2 · Key-up
TYLER: Power came next. New breaker, new disconnect, and a surge suppressor rated for the whole cabinet.
SAM: The electrician asked why we needed so much current for something the size of a fridge.
DANA: We told him it was a very ambitious fridge.
TYLER: With everything wired, we ran it into the dummy load first, at ten percent power.
SAM: The first time you key it up, you are not listening to the audio.
TYLER: You are watching reflected power and hoping it stays low.
DANA: It stayed low. We brought it up in steps, checking the meters every time.
SAM: At full power the room got warm fast, and the alarm went off on the second minute.
TYLER: Turns out the exhaust fan was wired backwards, pushing hot air into the room.
DANA: Five minutes with a screwdriver, and we were back on the air.

## Wrap
TYLER: So, what would we do differently next time?
DANA: Get the rack, the power, and the cooling signed off in writing before the truck leaves the warehouse.
SAM: Measure the floor before anyone orders anything heavy.
TYLER: And label the fan wires. Both ends.
SAM: That's the show. Thanks for listening, and go check your reflected power.
`;

export const defaultScript = parseScript(defaultScriptText);
