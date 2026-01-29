# Cinematic Voice System - Phase 3 Documentation

## Overview
Phase 3 implements **Gender Detection and Voice Casting Preparation**. This phase analyzes characters, detects their gender, and assigns appropriate voices to each character and narration block. **No audio is generated in this phase** - only metadata preparation.

---

## Architecture

### **4-Step Process:**
1. **Build Character Registry** - Create registry with all detected characters
2. **Detect Gender** - Determine gender for each character
3. **Assign Voices** - Map characters to appropriate voice pools
4. **Attach Voice Metadata** - Add voice field to all script blocks

---

## Part A: Character Registry

### **Function: `buildCharacterRegistry(characterList)`**

**Location:** `content.js` (Lines 638-661)

**Purpose:** Create a central registry for all characters with gender information.

**Output Structure:**
```javascript
{
  "Jack": { gender: "male", voice: null },
  "Emily": { gender: "female", voice: null },
  "Narrator": { gender: "neutral", voice: null }
}
```

**Features:**
- Automatically includes "Narrator" if not in list
- Calls `detectGender()` for each character
- Initializes voice as `null` (assigned later)

---

## Part B: Gender Detection

### **Function: `detectGender(name)`**

**Location:** `content.js` (Lines 574-636)

**Purpose:** Determine character gender using a 3-priority system.

### **Priority 1: UI Extraction**
```javascript
// Scans Janitor AI character profile/bio
// Looks for:
- Direct keywords: "male", "female"
- Pronoun frequency: "he" vs "she"
// Returns gender if found
```

**Selectors Used:**
- `[class*="bio"]`
- `[class*="description"]`
- `[class*="profile"]`
- `[class*="character-info"]`

**Pronoun Logic:**
```javascript
if (heCount > sheCount && heCount > 3) → "male"
if (sheCount > heCount && sheCount > 3) → "female"
```

### **Priority 2: Name-Based Heuristics**

**Datasets Included:**
- **Male Names (57):** Jack, John, James, Michael, David, etc.
- **Female Names (64):** Emily, Sarah, Jessica, Ashley, Jennifer, etc.
- **Unisex Names (16):** Alex, Jordan, Taylor, Morgan, Casey, etc.

```javascript
if (NAME_DATASETS.male.includes(name)) → "male"
if (NAME_DATASETS.female.includes(name)) → "female"
if (NAME_DATASETS.unisex.includes(name)) → "neutral"
```

### **Priority 3: Unknown**
```javascript
// If all else fails
return "unknown";
```

### **Special Cases:**
- **Narrator:** Always returns `"neutral"`

---

## Part C: Voice Casting

### **Voice Pools**

**Function: `getVoicePools(provider)`**

**Location:** `content.js` (Lines 663-679)

**Returns:**
```javascript
{
  male: ['male_voice_1', 'male_voice_2', 'male_voice_3'],
  female: ['female_voice_1', 'female_voice_2', 'female_voice_3'],
  neutral: ['neutral_voice_1', 'neutral_voice_2'],
  narrator: 'narrator_voice',
  fallback: 'default_voice'
}
```

**Note:** Currently returns generic identifiers. Phase 4 will map these to actual TTS voices based on the provider (Web Speech API, ElevenLabs, or Unreal Speech).

---

### **Voice Assignment**

**Function: `assignVoices(characterRegistry, voicePools)`**

**Location:** `content.js` (Lines 681-726)

**Assignment Rules:**

#### **1. Narrator:**
```javascript
"Narrator" → always uses voicePools.narrator
```

#### **2. Male Characters:**
```javascript
// Assign from male voice pool
// Rotate through pool if more males than voices
Jack → male_voice_1
Tom → male_voice_2
Michael → male_voice_3
David → male_voice_1 (cycles back)
```

#### **3. Female Characters:**
```javascript
// Assign from female voice pool
Emily → female_voice_1
Sarah → female_voice_2
Amanda → female_voice_3
```

#### **4. Neutral Characters:**
```javascript
// Assign from neutral voice pool
Alex (unisex) → neutral_voice_1
```

#### **5. Unknown Gender:**
```javascript
// Use fallback
Zephyr (unknown) → default_voice
```

**Rotation Logic:**
```javascript
const index = currentMaleIndex % maleVoicePool.length;
character.voice = maleVoicePool[index];
currentMaleIndex++;
```

---

## Part D: Voice Attachment

### **Function: `attachVoices(structuredScript, characterRegistry)`**

**Location:** `content.js` (Lines 728-760)

**Purpose:** Add `voice` field to every block in the script.

**Input:**
```javascript
[
  { type: "narration", text: "Jack stood up." },
  { type: "dialogue", text: "Hello!", speaker: "Jack" }
]
```

**Output:**
```javascript
[
  { type: "narration", text: "Jack stood up.", voice: "narrator_voice" },
  { type: "dialogue", text: "Hello!", speaker: "Jack", voice: "male_voice_1" }
]
```

**Rules:**
- **Narration blocks:** Always use `narrator_voice`
- **Dialogue blocks:** Use speaker's assigned voice from registry

---

## Full Pipeline Functions

### **Phase 3 Only: `prepareVoiceCasting()`**

**Location:** `content.js` (Lines 762-788)

**Usage:**
```javascript
const result = prepareVoiceCasting(scriptWithSpeakers, characterList, 'web_speech');
// Returns: { script: [...], registry: {...} }
```

**Steps:**
1. Build character registry
2. Get voice pools
3. Assign voices
4. Attach to script

---

### **Complete Pipeline: `parseScriptComplete()`**

**Location:** `content.js` (Lines 790-815)

**Usage:**
```javascript
const result = parseScriptComplete(rawText);
// Runs Phase 1 + 2 + 3 automatically
```

**Steps:**
1. **Phase 1:** Parse narration/dialogue
2. Extract character names (if not provided)
3. **Phase 2:** Detect speakers  
4. **Phase 3:** Gender detection and voice casting

---

## Examples

### **Example 1: Simple Conversation**

**Input:**
```javascript
'Jack stood up. "Hello everyone!" Emily smiled. "Hi Jack!"'
```

**Character List:**
```javascript
['Jack', 'Emily']
```

**Processing:**

**Step 1 - Character Registry:**
```javascript
{
  Jack: { gender: "male", voice: null },
  Emily: { gender: "female", voice: null },
  Narrator: { gender: "neutral", voice: null }
}
```

**Step 2 - Voice Assignment:**
```javascript
{
  Jack: { gender: "male", voice: "male_voice_1" },
  Emily: { gender: "female", voice: "female_voice_1" },
  Narrator: { gender: "neutral", voice: "narrator_voice" }
}
```

**Step 3 - Final Script:**
```javascript
[
  { type: "narration", text: "Jack stood up.", voice: "narrator_voice" },
  { type: "dialogue", text: "Hello everyone!", speaker: "Jack", voice: "male_voice_1" },
  { type: "narration", text: "Emily smiled.", voice: "narrator_voice" },
  { type: "dialogue", text: "Hi Jack!", speaker: "Emily", voice: "female_voice_1" }
]
```

---

### **Example 2: Unknown Gender Character**

**Input:**
```javascript
'Zephyr appeared. "I have returned."'
```

**Processing:**
```javascript
// Character Registry
{
  Zephyr: { gender: "unknown", voice: "default_voice" },
  Narrator: { gender: "neutral", voice: "narrator_voice" }
}

// Final Script
[
  { type: "narration", text: "Zephyr appeared.", voice: "narrator_voice" },
  { type: "dialogue", text: "I have returned.", speaker: "Zephyr", voice: "default_voice" }
]
```

---

## Console Output Format

```
[Janitor Voice] ========== PHASE 3: VOICE CASTING PREPARATION ==========

[Janitor Voice] ========== BUILDING CHARACTER REGISTRY ==========
[Janitor Voice] Processing 2 characters
[Janitor Voice] Jack: gender = male
[Janitor Voice] Emily: gender = female
[Janitor Voice] Narrator: gender = neutral
[Janitor Voice] Character Registry: {Jack: {…}, Emily: {…}, Narrator: {…}}
[Janitor Voice] ========== REGISTRY COMPLETE ==========

[Janitor Voice] Voice Pools: {male: Array(3), female: Array(3), …}

[Janitor Voice] ========== VOICE ASSIGNMENT ==========
[Janitor Voice] Jack → male_voice_1 (male #1)
[Janitor Voice] Emily → female_voice_1 (female #1)
[Janitor Voice] Narrator → narrator_voice (narrator)
[Janitor Voice] Final Character Registry: {…}
[Janitor Voice] ========== ASSIGNMENT COMPLETE ==========

[Janitor Voice] ========== ATTACHING VOICES TO SCRIPT ==========
[Janitor Voice] Processing 4 blocks
Block 1 [NARRATION]: voice = narrator_voice
Block 2 [DIALOGUE]: speaker = Jack, gender = male, voice = male_voice_1
Block 3 [NARRATION]: voice = narrator_voice
Block 4 [DIALOGUE]: speaker = Emily, gender = female, voice = female_voice_1
[Janitor Voice] ========== VOICE ATTACHMENT COMPLETE ==========

[Janitor Voice] ========== PHASE 3 COMPLETE ==========
Script with Voices: (4) [{…}, {…}, {…}, {…}]
Character Registry: {Jack: {…}, Emily: {…}, Narrator: {…}}
```

---

## Test Suite

### **Running Tests**

Uncomment in `content.js`:
```javascript
// testVoiceCasting(); // Remove the //
```

### **Test Cases (5 Tests)**

1. **Simple Male/Female** - Jack & Emily conversation
2. **Mixed Characters** - Sarah & Tom with narration
3. **Unknown Gender** - Character "Zephyr" (not in datasets)
4. **Unisex Names** - Alex & Jordan (both neutral)
5. **Full Auto Pipeline** - Auto-extract Amanda & Marcus

---

## Name Datasets

### **Statistics:**
- **Male Names:** 57
- **Female Names:** 64
- **Unisex Names:** 16
- **Total Coverage:** 137 common names

### **Extending Datasets:**
To add more names, edit `NAME_DATASETS` in `content.js`:
```javascript
const NAME_DATASETS = {
  male: [..., 'NewMaleName'],
  female: [..., 'NewFemaleName'],
  unisex: [..., 'NewUnisexName']
};
```

---

## Edge Cases

| Case | Handling |
|------|----------|
| Character not in dataset | Gender = "unknown", voice = fallback |
| Unisex name | Gender = "neutral", uses neutral voice pool |
| Multiple males/females | Rotates through voice pool |
| Empty character list | Just Narrator |
| UI extraction fails | Falls back to name heuristic |

---

## What Phase 3 Does

✅ Detects gender for all characters  
✅ Builds character registry  
✅ Assigns voices to characters  
✅ Attaches voice metadata to script  
✅ Prepares system for audio generation  

## What Phase 3 Does NOT Do

❌ Generate audio (Phase 4)  
❌ Call TTS providers (Phase 4)  
❌ Queue or playback (Phase 5)  
❌ Modify existing TTS system  

---

## Integration Status

Currently **standalone** - functions are defined and tested but not integrated into main TTS flow.

**Future Integration (Phase 4):**
```javascript
// In VoiceController.play()
const { script, registry } = parseScriptComplete(text);

for (const block of script) {
  const voiceConfig = mapVoiceToProvider(block.voice, currentProvider);
  await generateTTS(block.text, voiceConfig);
  playAudio();
}
```

---

## Performance

- **Character Registry:** O(n) where n = number of characters
- **Gender Detection:** O(1) name lookup or O(m) UI scan
- **Voice Assignment:** O(n) where n = number of characters
- **Voice Attachment:** O(b) where b = number of blocks
- **Total:** ~5-10ms for typical story (3 characters, 10 blocks)

---

## Next Steps (Phase 4)

### **Map Generic Voices to Real TTS Voices**
```javascript
// Current (Phase 3)
{ voice: "male_voice_1" }

// Future (Phase 4)
{ voice: "Microsoft David - English (United States)" }
// or
{ voice: "ElevenLabs_voice_id_abc123" }
```

### **Multi-Voice Audio Generation**
- Generate TTS for each block with assigned voice
- Handle voice switching between blocks
- Maintain audio quality across transitions

### **Provider-Specific Voice Mapping**
- Web Speech API → browser voices
- ElevenLabs → premium voice library
- Unreal Speech → available voices

---

## Status

✅ **Phase 1: COMPLETE** (Script Parsing)  
✅ **Phase 2: COMPLETE** (Speaker Detection)  
✅ **Phase 3: COMPLETE** (Gender Detection & Voice Casting) ← **YOU ARE HERE**  
⏳ Phase 4: Multi-Voice Audio Generation (Not Started)  
⏳ Phase 5: Cinematic Playback (Not Started)  

---

**Created:** 2026-01-29  
**Last Updated:** 2026-01-29  
**Version:** 1.0.0
