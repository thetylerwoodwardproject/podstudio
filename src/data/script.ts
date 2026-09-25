/*
 * The example episode script, long enough to rehearse and test a real
 * session with: one host reading. It uses the import format ("## Heading"
 * starts a section). The first lines match the design mockups.
 */
import { parseScript } from '@/lib/script-parser';

export const defaultScriptText = `## Cold open
It was a quiet week in the studio, until the new transmitter arrived.
Four pallets, and one of them was just foam.
So this episode is about what happens after the crate is open.
Power, cooling, and the first time we keyed it up.
And whether the floor could hold it, which, for the record, nobody checked until the truck was outside.

## The install
We measured it twice. The spec sheet and the building plans did not agree.
Which is when the real trouble starts.
The spec sheet said the cabinet weighs just under nine hundred pounds, fully loaded.
The building plans rated that corner of the room for about half of that.
So I had a transmitter, a forklift, and a floor I didn't trust.
I got the structural drawings out, and honestly, that took most of a morning.
The fix was a steel spreader plate under the rack, bolted through to the slab.
Which meant drilling concrete in a room full of equipment that hates dust.
Plastic sheeting, two shop vacs, and a lot of patience.
Then there was the question of where the heat was going to go.
The old transmitter ran warm. This one runs hot, and it runs hot all the time.
I added a dedicated exhaust duct and a second mini split, just for that corner.
And a temperature alarm that texts me, whether I like it or not.

## First key-up
Power came next. New breaker, new disconnect, and a surge suppressor rated for the whole cabinet.
The electrician asked why I needed so much current for something the size of a fridge.
I told him it was a very ambitious fridge.
With everything wired, I ran it into the dummy load first, at ten percent power.
The first time you key it up, you are not listening to the audio.
You are watching reflected power and hoping it stays low.
It stayed low. I brought it up in steps, checking the meters every time.
At full power the room got warm fast, and the alarm went off on the second minute.
Turns out the exhaust fan was wired backwards, pushing hot air into the room.
Five minutes with a screwdriver, and we were back on the air.

## Wrap
So, what would I do differently next time?
Get the rack, the power, and the cooling signed off in writing before the truck leaves the warehouse.
Measure the floor before anyone orders anything heavy.
And label the fan wires. Both ends.
That's the show. Thanks for listening, and go check your reflected power.
`;

export const defaultScript = parseScript(defaultScriptText);
