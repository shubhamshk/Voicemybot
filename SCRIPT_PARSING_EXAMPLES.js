// ============================================================================
// CINEMATIC VOICE SYSTEM - PHASE 1 EXAMPLES
// ============================================================================

// Example 1: Simple Story
const example1 = 'Sarah walked into the room, her eyes scanning the crowd. "Has anyone seen Mark?" she asked nervously. No one answered.';

console.log('EXAMPLE 1: Simple Story');
console.log('Input:', example1);
console.log('Output:', parseScript(example1));
/*
Expected:
[
  { type: "narration", text: "Sarah walked into the room, her eyes scanning the crowd." },
  { type: "dialogue", text: "Has anyone seen Mark?" },
  { type: "narration", text: "she asked nervously. No one answered." }
]
*/

// Example 2: Action Scene
const example2 = 'The door burst open. "Freeze! Police!" Officers swarmed in. "On the ground, now!" The suspect dropped his weapon. "Don\'t shoot! I surrender!"';

console.log('\nEXAMPLE 2: Action Scene');
console.log('Input:', example2);
console.log('Output:', parseScript(example2));
/*
Expected:
[
  { type: "narration", text: "The door burst open." },
  { type: "dialogue", text: "Freeze! Police!" },
  { type: "narration", text: "Officers swarmed in." },
  { type: "dialogue", text: "On the ground, now!" },
  { type: "narration", text: "The suspect dropped his weapon." },
  { type: "dialogue", text: "Don't shoot! I surrender!" }
]
*/

// Example 3: Emotional Dialogue
const example3 = '"I can\'t do this anymore," she whispered, tears streaming down her face. He reached for her hand. "Please... don\'t leave." But she was already walking away.';

console.log('\nEXAMPLE 3: Emotional Scene');
console.log('Input:', example3);
console.log('Output:', parseScript(example3));
/*
Expected:
[
  { type: "dialogue", text: "I can't do this anymore," },
  { type: "narration", text: "she whispered, tears streaming down her face. He reached for her hand." },
  { type: "dialogue", text: "Please... don't leave." },
  { type: "narration", text: "But she was already walking away." }
]
*/

// Example 4: Pure Narration
const example4 = 'The storm raged outside, winds howling through the trees. Lightning illuminated the darkened sky in brief, brilliant flashes. Thunder rumbled in the distance, growing louder with each passing moment.';

console.log('\nEXAMPLE 4: Pure Narration');
console.log('Input:', example4);
console.log('Output:', parseScript(example4));
/*
Expected:
[
  { type: "narration", text: "The storm raged outside, winds howling through the trees. Lightning illuminated the darkened sky in brief, brilliant flashes. Thunder rumbled in the distance, growing louder with each passing moment." }
]
*/

// Example 5: Conversation
const example5 = '"What time is it?" "Almost midnight." "We need to go." "Already?" "Yes, now!"';

console.log('\nEXAMPLE 5: Quick Conversation');
console.log('Input:', example5);
console.log('Output:', parseScript(example5));
/*
Expected:
[
  { type: "dialogue", text: "What time is it?" },
  { type: "dialogue", text: "Almost midnight." },
  { type: "dialogue", text: "We need to go." },
  { type: "dialogue", text: "Already?" },
  { type: "dialogue", text: "Yes, now!" }
]
*/

// Example 6: Real Janitor AI Style Message
const example6 = `*The vampire prince leans against the stone wall, his crimson eyes gleaming in the moonlight.*

"You shouldn't have come here alone," he says, his voice smooth as silk. "These halls are dangerous after dark."

*He takes a step closer, the shadows dancing around him.*

"But I suppose... that's what makes you interesting."`;

console.log('\nEXAMPLE 6: Janitor AI Style (with asterisks)');
console.log('Input:', example6);
console.log('Output:', parseScript(example6));
/*
Note: This example shows that action text (*...*) is treated as narration.
Future phases might handle asterisk actions differently.

Expected:
[
  { type: "narration", text: "*The vampire prince leans against the stone wall, his crimson eyes gleaming in the moonlight.*" },
  { type: "dialogue", text: "You shouldn't have come here alone," },
  { type: "narration", text: "he says, his voice smooth as silk." },
  { type: "dialogue", text: "These halls are dangerous after dark." },
  { type: "narration", text: "*He takes a step closer, the shadows dancing around him.*" },
  { type: "dialogue", text: "But I suppose... that's what makes you interesting." }
]
*/
