# Cinematic Voice System - Phase 5 Documentation

## Overview
Phase 5 implements the **Streaming Audio Consumer** - the playback system that consumes audio chunks from the queue and plays them sequentially in real-time. Combined with Phase 4's producer, this creates a complete streaming cinematic voice experience.

---

## Architecture: Producer-Consumer Pattern

```
┌──────────────────────────────────────────────┐
│     PHASE 4: AUDIO PRODUCER                  │
│                                              │
│  Generate → Generate → Generate → Generate  │
│      ↓          ↓          ↓          ↓     │
│  ┌──────────────────────────────────────┐   │
│  │      📦 AUDIO QUEUE 📦                │   │
│  │  [chunk1, chunk2, chunk3, chunk4...] │   │
│  └──────────────────────────────────────┘   │
│                    ↓                         │
└────────────────────┼─────────────────────────┘
                     │
┌────────────────────┼─────────────────────────┐
│                    ↓                         │
│     PHASE 5: AUDIO CONSUMER                  │
│                                              │
│  Play → Wait → Play → Wait → Play → Done    │
│   ↓             ↓             ↓              │
│  🔊           🔊           🔊              │
└──────────────────────────────────────────────┘

TIMELINE:
T=0ms:    Producer starts generating chunk 1
T=100ms:  Chunk 1 ready → Consumer starts playing
T=2000ms: Chunk 1 ends → Consumer plays chunk 2
          (Producer still generating chunk 3...)
T=4000ms: Chunk 2 ends → Consumer plays chunk 3
T=6000ms: Chunk 3 ends → All done
```

---

## Core Classes

### **1. AudioConsumer**

**Purpose:** Consumes audio queue and plays chunks sequentially

**Constructor:**
```javascript
const consumer = new AudioConsumer(producer);
```

**Properties:**
```javascript
{
  producer: AudioProducer,      // Reference to producer
  isPlaying: boolean,
  currentIndex: number,         // Current chunk being played
  isStopped: boolean,
  currentAudioSource: AudioBufferSourceNode,
  audioContext: AudioContext,
  
  // Callbacks
  onPlayStart: Function,
  onPlayEnd: Function,
  onChunkStart: Function,
  onChunkEnd: Function,
  onProgress: Function,
  onError: Function
}
```

---

### **2. CinematicVoiceOrchestrator**

**Purpose:** High-level orchestrator that combines all 5 phases

**Constructor:**
```javascript
const orchestrator = new CinematicVoiceOrchestrator('web_speech');
```

**Main Method:**
```javascript
await orchestrator.playCinematic(storyText);
```

---

## AudioConsumer Methods

### **play()**

**Location:** Lines 1535-1554

**Purpose:** Start playback loop

**Flow:**
1. Set `isPlaying = true`
2. Reset `currentIndex = 0`
3. Call `onPlayStart` callback
4. Enter `playbackLoop()`

**Example:**
```javascript
const consumer = new AudioConsumer(producer);
await consumer.play(); // Starts playback, waits until done
```

---

### **playbackLoop()**

**Location:** Lines 1481-1533

**Purpose:** Main consumption loop - the heart of Phase 5

**Algorithm:**
```javascript
while (true) {
  // Check if stopped by user
  if (isStopped) break;
  
  // Check if chunk available
  if (currentIndex < queue.length) {
    // Play chunk
    await playChunk(queue[currentIndex]);
    currentIndex++;
    
  } else {
    // No chunk yet
    
    // Check if producer done
    if (!producer.isGenerating) {
      // All done!
      break;
    }
    
    // Wait for next chunk (poll every 100ms)
    await sleep(100);
  }
}
```

**Key Features:**
- ✅ **Streaming:** Doesn't wait for all chunks
- ✅ **Sequential:** Plays in order
- ✅ **Real-time:** Polls for new chunks
- ✅ **Smart Exit:** Knows when producer is done

---

### **playChunk(queueItem)**

**Location:** Lines 1352-1404

**Purpose:** Play a single audio chunk

**Flow:**
1. Trigger `onChunkStart` callback
2. Check audio type:
   - `web_speech_utterance` → call `playWebSpeech()`
   - `audio_buffer` → call `playAudioBuffer()`
3. Wait for playback to complete
4. Trigger `onChunkEnd` callback
5. On error: log, callback, continue (don't crash)

**Example Output:**
```
[AudioConsumer] Playing chunk 2
[AudioConsumer] Type: dialogue, Speaker: Jack
[AudioConsumer] Text: "What the hell, dude?..."
[AudioConsumer] ✓ Chunk 2 finished
```

---

### **playWebSpeech(utterance)**

**Location:** Lines 1406-1430

**Purpose:** Play using Web Speech API

**Implementation:**
```javascript
return new Promise((resolve, reject) => {
  const synth = window.speechSynthesis;
  
  utterance.onend = () => resolve();
  utterance.onerror = (e) => reject(e);
  
  synth.speak(utterance);
});
```

**Note:** Uses browser's built-in TTS. Can't be interrupted mid-word.

---

### **playAudioBuffer(audioBuffer)**

**Location:** Lines 1432-1463

**Purpose:** Play using Web Audio API

**Implementation:**
```javascript
return new Promise((resolve, reject) => {
  const audioContext = new AudioContext();
  const source = audioContext.createBufferSource();
  
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  
  source.onended = () => resolve();
  
  source.start(0);
});
```

**Note:** Used for ElevenLabs and Unreal Speech. Can be stopped instantly.

---

### **stop()**

**Location:** Lines 1556-1579

**Purpose:** Stop playback immediately

**Actions:**
1. Set `isStopped = true`, `isPlaying = false`
2. Cancel Web Speech if active
3. Stop Web Audio source if active
4. Stop producer (clears queue)

**Example:**
```javascript
consumer.stop(); // Immediate silence
```

---

### **getState()**

**Location:** Lines 1581-1594

**Returns:**
```javascript
{
  isPlaying: boolean,
  currentIndex: number,        // Which chunk playing
  totalGenerated: number,      // Total chunks in queue
  isGenerating: boolean,       // Is producer still working
  isStopped: boolean
}
```

---

## CinematicVoiceOrchestrator

### **playCinematic(rawText, characterList)**

**Location:** Lines 1631-1698

**Purpose:** Complete end-to-end cinematic playback

**Flow:**
```javascript
// PHASE 1+2+3: Parse and prepare
parseScriptComplete(text) 
→ { script: [...], registry: {...} }

// PHASE 4: Create producer, start generation
producer = new AudioProducer()
generationPromise = producer.generateScript(script)

// PHASE 5: Create consumer, start playback
consumer = new AudioConsumer(producer)
await consumer.play()  // ← Starts immediately!

// Wait for generation to finish
await generationPromise
```

**Key Insight:** Playback starts while generation is still running!

---

## Callbacks

### **onPlayStart**

**Triggered:** When playback begins

```javascript
consumer.onPlayStart = () => {
  console.log('Playback started');
  disableMicButton();
};
```

---

### **onPlayEnd**

**Triggered:** When all chunks finished

**Payload:**
```javascript
{ totalPlayed: number }
```

```javascript
consumer.onPlayEnd = (result) => {
  console.log(`Done! Played ${result.totalPlayed} chunks`);
  enableMicButton();
};
```

---

### **onChunkStart**

**Triggered:** Before each chunk plays

**Payload:**
```javascript
{
  index: number,
  text: string,
  speaker: string,
  type: 'narration' | 'dialogue'
}
```

```javascript
consumer.onChunkStart = (chunk) => {
  updateUI(`Playing: ${chunk.speaker} - "${chunk.text.substring(0, 30)}..."`);
};
```

---

### **onChunkEnd**

**Triggered:** After each chunk finishes

**Payload:**
```javascript
{
  index: number,
  text: string
}
```

---

### **onProgress**

**Triggered:** After each chunk (includes generation status)

**Payload:**
```javascript
{
  currentIndex: number,
  totalGenerated: number,
  isGenerating: boolean
}
```

```javascript
consumer.onProgress = (progress) => {
  updateProgress(`${progress.currentIndex}/${progress.totalGenerated}`);
};
```

---

### **onError**

**Triggered:** When chunk playback fails

**Payload:**
```javascript
{
  index: number,
  error: Error,
  chunk: Object
}
```

**Note:** Playback continues with next chunk (non-fatal).

---

## Complete Usage Example

### **Simple Usage:**

```javascript
const orchestrator = new CinematicVoiceOrchestrator('web_speech');

orchestrator.onStatusUpdate = (status) => {
  document.querySelector('#status').textContent = status;
};

const story = 'Jack stood up. "Hello!" Emily smiled. "Hi Jack!"';
await orchestrator.playCinematic(story);
```

---

### **Advanced Usage with All Callbacks:**

```javascript
// Create producer
const producer = new AudioProducer('web_speech');

producer.onProgress = (p) => {
  console.log(`Generating ${p.current}/${p.total}...`);
};

// Parse script
const result = parseScriptComplete(storyText);

// Start generation
const generationPromise = producer.generateScript(result.script);

// Create consumer
const consumer = new AudioConsumer(producer);

consumer.onPlayStart = () => {
  console.log('▶️ Started');
  disableMicButton();
};

consumer.onChunkStart = (chunk) => {
  console.log(`🔊 ${chunk.speaker}: "${chunk.text}"`);
  highlightText(chunk.text);
};

consumer.onChunkEnd = (chunk) => {
  console.log(`✓ Chunk ${chunk.index} done`);
};

consumer.onProgress = (progress) => {
  updateProgressBar(progress.currentIndex, progress.totalGenerated);
};

consumer.onPlayEnd = (result) => {
  console.log(`✅ Done! ${result.totalPlayed} chunks played`);
  enableMicButton();
};

consumer.onError = (error) => {
  console.error(`❌ Chunk ${error.index} failed:`, error.error);
};

// Start playback
await consumer.play();

// Wait for generation to complete
await generationPromise;
```

---

## Real-Time Streaming Timeline

```
Time  | Producer                  | Consumer
------|--------------------------|---------------------------
0ms   | Start generation         | Waiting...
100ms | Chunk 1 ready            | ▶️ START PLAYING chunk 1
200ms | Chunk 2 ready            | Playing chunk 1...
2000ms| Chunk 3 generating...    | ✅ Chunk 1 done
      |                          | ▶️ START PLAYING chunk 2
3000ms| Chunk 3 ready            | Playing chunk 2...
4000ms| All done ✅              | ✅ Chunk 2 done
      |                          | ▶️ START PLAYING chunk 3
6000ms|                          | ✅ Chunk 3 done
      |                          | ✅ PLAYBACK COMPLETE
```

**Result:** Playback starts at 100ms, not 4000ms (after all generation).

---

## State Flow Diagram

```
┌─────────────┐
│   IDLE      │
└──────┬──────┘
       │ play()
       ▼
┌─────────────┐     ┌──────────────┐
│ IS PLAYING  │────→│ WAITING FOR  │
│             │     │ NEXT CHUNK   │
└──────┬──────┘     └──────┬───────┘
       │                   │
       │ chunk available   │
       └───────────────────┘
       │
       ▼
┌─────────────┐
│  PLAYING    │
│   CHUNK     │
└──────┬──────┘
       │
       │ chunk ends
       ▼
     More chunks? ──Yes──→ Back to waiting
       │
       No
       ▼
┌─────────────┐
│  COMPLETE   │
└─────────────┘

stop() can interrupt at any point → Back to IDLE
```

---

## Error Handling

### **Chunk-Level Errors (Non-Fatal):**

```javascript
try {
  await playChunk(chunk);
} catch (error) {
  console.error('Chunk failed:', error);
  onError(error);
  // Continue with next chunk
}
```

**Result:** One bad chunk doesn't ruin entire playback.

### **Stopping During Playback:**

```javascript
// User clicks mic again
consumer.stop();

// Actions:
// 1. Set isStopped = true
// 2. Cancel current audio
// 3. Exit playback loop
// 4. Clear producer queue
```

---

## What Phase 5 Does

✅ Consumes audio queue from producer  
✅ Plays chunks sequentially  
✅ Starts playback immediately (streaming)  
✅ Polls for new chunks in real-time  
✅ Handles both Web Speech and Web Audio API  
✅ Supports instant cancellation  
✅ Tracks playback state  
✅ Provides comprehensive callbacks  
✅ Graceful error handling  
✅ Complete orchestrator for end-to-end flow  

## What Phase 5 Does NOT Do

❌ Generate audio (Phase 4)  
❌ Parse text (Phase 1)  
❌ Detect speakers (Phase 2)  
❌ Assign voices (Phase 3)  

---

## Testing

### **Test Function:**

```javascript
testCinematicPlayback();
```

**Test Story:**
```
Jack stood abruptly, wine sloshing from his glass.
"What the hell, dude? You think this is funny?" 
His voice rose with each word.
Emily flinched at Jack's outburst.
"Maybe it was an animal?" she suggested quietly.
Jack shook his head.
"No way. Someone was watching us."
```

**Expected Behavior:**
- Parse story into 7 blocks
- Detect Jack and Emily as characters
- Assign male voice to Jack, female to Emily
- Generate 7 audio chunks
- Play sequentially with appropriate voices
- Show status updates in console

**To Run:**
```javascript
// Uncomment in content.js:
testCinematicPlayback();
```

---

## Console Output Example

```
[CinematicOrchestrator] ========== STARTING CINEMATIC PLAYBACK ==========
[CinematicOrchestrator] Provider: web_speech
[STATUS] Analyzing story...

[Janitor Voice] parseScript() Input: Jack stood abruptly...
[Janitor Voice] Parsed 7 blocks (3 dialogue, 4 narration)
[Janitor Voice] Final character list (2): ['Jack', 'Emily']

[STATUS] Generating audio...

[AudioProducer] ========== STARTING STREAMING GENERATION ==========
[AudioProducer] Processing block 1: narration
[AudioProducer] ✓ Chunk 1/1 ready. Queue size: 1

[AudioConsumer] ========== STARTING PLAYBACK LOOP ==========
[AudioConsumer] Playing chunk 1
[AudioConsumer] Type: narration, Speaker: Narrator
[AudioConsumer] Speaking with Web Speech API...
[CinematicOrchestrator] Now playing: Narrator- "Jack stood abruptly, wine sloshing..."

[AudioProducer] Processing block 2: dialogue
[AudioProducer] ✓ Chunk 1/1 ready. Queue size: 2

[AudioConsumer] ✓ Chunk 1 finished
[AudioConsumer] Playing chunk 2
[AudioConsumer] Type: dialogue, Speaker: Jack
[CinematicOrchestrator] Now playing: Jack - "What the hell, dude?..."

[AudioProducer] ========== GENERATION COMPLETE ==========

[AudioConsumer] ✓ Chunk 7 finished
[AudioConsumer] All chunks played, producer finished
[AudioConsumer] ========== PLAYBACK COMPLETE ==========

[STATUS] Playback finished
[CinematicOrchestrator] ========== CINEMATIC PLAYBACK COMPLETE ==========
```

---

## Performance

| Metric | Value |
|--------|-------|
| Time to first playback | ~100-200ms |
| Chunk polling interval | 100ms |
| Memory per chunk | ~50-100KB |
| CPU during playback | Low (native APIs) |

---

## Status

✅ **Phase 1:** Script Parsing (COMPLETE)  
✅ **Phase 2:** Speaker Detection (COMPLETE)  
✅ **Phase 3:** Gender Detection & Voice Casting (COMPLETE)  
✅ **Phase 4:** Streaming Audio Producer (COMPLETE)  
✅ **Phase 5:** Streaming Audio Consumer (COMPLETE) ← **YOU ARE HERE**  

🎉 **ALL PHASES COMPLETE!**

---

**Created:** 2026-01-29  
**Last Updated:** 2026-01-29  
**Version:** 1.0.0
